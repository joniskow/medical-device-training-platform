import { createHash, randomUUID } from "node:crypto";
import {
  BlobServiceClient,
  BlobSASPermissions,
  SASProtocol,
  generateBlobSASQueryParameters,
  StorageSharedKeyCredential
} from "@azure/storage-blob";
import type { TokenCredential } from "@azure/core-auth";
import type { PrivateObjectStoragePort } from "@medical-device/contracts";
import {createSourceMeteredStorage,type StorageUsageSink} from './metered-storage.js';
export {createSourceMeteredStorage,type StorageUsageSink} from './metered-storage.js';
export * from "./release-artifacts.js";

export interface AzureBlobStorageOptions {
  connectionString?: string;
  accountUrl?: string;
  credential?: TokenCredential;
  containerName: string;
  quarantineContainerName?: string;
  allowHttp?: boolean;
  maxReadBytes?: number;
  onUsage?:StorageUsageSink;
}

function connectionSetting(connectionString: string, name: string): string {
  const match = connectionString.match(new RegExp(`${name}=([^;]+)`));
  if (!match?.[1]) throw new Error(`Missing ${name} in Azure Storage connection string`);
  return match[1];
}

function safeBlobKey(blobKey: string): string {
  if (!blobKey || blobKey.length > 1024 || blobKey.startsWith("/") || blobKey.includes("..") || /[\\\0\r\n]/.test(blobKey)) {
    throw new Error("BLOB_KEY_INVALID");
  }
  return blobKey;
}

export function createAzureBlobStorage(options: AzureBlobStorageOptions): PrivateObjectStoragePort & {
  ensureContainers(): Promise<void>;
  deleteObject(input:{blobKey:string}):Promise<void>;
  putObject(input: { blobKey: string; bytes: Uint8Array; contentType: string }): Promise<void>;
} {
  const sharedKeyCredential = options.connectionString
    ? new StorageSharedKeyCredential(
      connectionSetting(options.connectionString, "AccountName"),
      connectionSetting(options.connectionString, "AccountKey")
    )
    : undefined;
  const service = sharedKeyCredential
    ? new BlobServiceClient(connectionSetting(options.connectionString!, "BlobEndpoint"), sharedKeyCredential)
    : options.accountUrl && options.credential
      ? new BlobServiceClient(options.accountUrl, options.credential)
      : (() => { throw new Error("AZURE_BLOB_CREDENTIAL_REQUIRED"); })();
  const accountName = sharedKeyCredential
    ? connectionSetting(options.connectionString!, "AccountName")
    : new URL(options.accountUrl!).hostname.split(".")[0];
  const containerName = options.containerName;
  const quarantineContainerName = options.quarantineContainerName ?? `${containerName}-quarantine`;
  const container = service.getContainerClient(containerName);
  const quarantineContainer = service.getContainerClient(quarantineContainerName);
  const maxReadBytes = options.maxReadBytes ?? 128 * 1024 * 1024;
  let delegationKeyPromise: ReturnType<BlobServiceClient["getUserDelegationKey"]> | undefined;
  let delegationKeyExpiresAt = 0;

  const blob = (blobKey: string) => container.getBlockBlobClient(safeBlobKey(blobKey));
  const sasUrl = async (blobKey: string, permissions: string, expiresInSeconds: number): Promise<string> => {
    const normalizedKey = safeBlobKey(blobKey);
    const startsOn = new Date(Date.now() - 15 * 60_000);
    const expiresOn = new Date(Date.now() + expiresInSeconds * 1000);
    const common = {
      containerName,
      blobName: normalizedKey,
      permissions: BlobSASPermissions.parse(permissions),
      startsOn,
      expiresOn,
      protocol: options.allowHttp ? SASProtocol.HttpsAndHttp : SASProtocol.Https
    };
    if (sharedKeyCredential) return `${blob(normalizedKey).url}?${generateBlobSASQueryParameters(common, sharedKeyCredential).toString()}`;
    if (!delegationKeyPromise || delegationKeyExpiresAt <= Date.now() + 60_000) {
      delegationKeyExpiresAt = expiresOn.getTime();
      delegationKeyPromise = service.getUserDelegationKey(startsOn, expiresOn).catch((error) => {
        delegationKeyPromise = undefined;
        delegationKeyExpiresAt = 0;
        throw error;
      });
    }
    const delegationKey = await delegationKeyPromise;
    const sas = generateBlobSASQueryParameters(common, delegationKey, accountName).toString();
    return `${blob(normalizedKey).url}?${sas}`;
  };

  const storage:PrivateObjectStoragePort & {ensureContainers():Promise<void>;deleteObject(input:{blobKey:string}):Promise<void>;putObject(input:{blobKey:string;bytes:Uint8Array;contentType:string}):Promise<void>} = {
    async ensureContainers() {
      await container.createIfNotExists();
      await quarantineContainer.createIfNotExists();
    },
    async createUploadUrl({ blobKey, expiresInSeconds }) {
      return sasUrl(blobKey, "cw", expiresInSeconds);
    },
    async createDownloadUrl({ blobKey, expiresInSeconds }) {
      return sasUrl(blobKey, "r", expiresInSeconds);
    },
    async getObjectProperties({ blobKey }) {
      const properties = await blob(blobKey).getProperties();
      return {
        contentType: properties.contentType ?? "application/octet-stream",
        contentLength: properties.contentLength ?? 0,
        metadata: properties.metadata ?? {}
      };
    },
    async putObjectStream({ blobKey, chunks, contentType }) {
      const target = blob(blobKey);
      const prefix = randomUUID();
      const ids: string[] = [];
      const block = Buffer.alloc(4 * 1024 * 1024);
      let used = 0;
      const stage = async () => {
        const id = Buffer.from(`${prefix}:${String(ids.length).padStart(6, '0')}`).toString('base64');
        await target.stageBlock(id, block.subarray(0, used), used);
        ids.push(id); used = 0;
      };
      for await (const chunk of chunks) {
        for (let offset = 0; offset < chunk.byteLength;) {
          const length = Math.min(block.length - used, chunk.byteLength - offset);
          block.set(chunk.subarray(offset, offset + length), used);
          used += length; offset += length;
          if (used === block.length) await stage();
        }
      }
      if (used) await stage();
      // A failed/aborted/invalid stream never commits its staged blocks.
      await target.commitBlockList(ids, { blobHTTPHeaders: { blobContentType: contentType } });
    },
    async putObject({ blobKey, bytes, contentType }) {
      if (bytes.byteLength > maxReadBytes) throw new Error("BLOB_SIZE_LIMIT_EXCEEDED");
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      await blob(blobKey).uploadData(bytes, {
        blobHTTPHeaders: { blobContentType: contentType },
        metadata: { sha256 }
      });
    },
    async readObject({ blobKey, maxBytes }) {
      const client = blob(blobKey);
      const properties = await client.getProperties();
      const contentLength = properties.contentLength ?? 0;
      const limit = Math.min(maxBytes ?? maxReadBytes, maxReadBytes);
      if (!Number.isSafeInteger(contentLength) || contentLength < 0 || contentLength > limit) throw new Error("BLOB_SIZE_LIMIT_EXCEEDED");
      if(!properties.etag)throw new Error('BLOB_ETAG_REQUIRED');
      const bytes = contentLength===0?Buffer.alloc(0):await client.downloadToBuffer(0,contentLength,{conditions:{ifMatch:properties.etag}});
      if (bytes.byteLength > limit) throw new Error("BLOB_SIZE_LIMIT_EXCEEDED");
      return {
        bytes: Uint8Array.from(bytes),
        contentType: properties.contentType ?? "application/octet-stream",
        sha256: createHash("sha256").update(bytes).digest("hex")
      };
    },
    async verifyChecksum({ blobKey, expectedSha256, maxBytes }) {
      try {
        const object = await this.readObject({ blobKey, maxBytes });
        return object.sha256 === expectedSha256;
      } catch (error) {
        if (error && typeof error === "object" && "statusCode" in error && error.statusCode === 404) return false;
        throw error;
      }
    },
    async deleteObject({blobKey}) {
      await blob(safeBlobKey(blobKey)).deleteIfExists({deleteSnapshots:'include'});
    },
    async quarantine({ blobKey, reason }) {
      const normalizedKey = safeBlobKey(blobKey);
      const source = blob(normalizedKey);
      if (!(await source.exists())) return;
      const object = await this.readObject({ blobKey: normalizedKey });
      const safeReason = reason.toLowerCase().replace(/[^a-z0-9_-]+/g, "_").slice(0, 64) || "unknown";
      const targetKey = `${safeReason}/${normalizedKey}`;
      await quarantineContainer.getBlockBlobClient(targetKey).uploadData(object.bytes, {
        blobHTTPHeaders: { blobContentType: object.contentType },
        metadata: { sha256: object.sha256, quarantineReason: safeReason }
      });
      await source.deleteIfExists();
    }
  };
  return options.onUsage?createSourceMeteredStorage(storage,options.onUsage):storage;
}
