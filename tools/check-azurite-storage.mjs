import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import { createAzureBlobStorage } from "../apps/worker/dist/storage/azure-blob-storage.js";

const root = resolve(import.meta.dirname, "..");
const bytes = await readFile(resolve(root, "fixtures/reference/manual/aurora-infusion-controller-manual.pdf"));
const sha256 = createHash("sha256").update(bytes).digest("hex");
const connectionString = "DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;AccountKey=Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==;BlobEndpoint=http://127.0.0.1:10000/devstoreaccount1;";
const storage = createAzureBlobStorage({ connectionString, containerName: "fixture-private", allowHttp: true });
await storage.ensureContainers();

const blobKey = `org_fixture/AIC-001/azurite-${Date.now()}.pdf`;
await storage.putObject({ blobKey, bytes, contentType: "application/pdf" });
const read = await storage.readObject({ blobKey });
assert.equal(read.sha256, sha256);
assert.equal(read.contentType, "application/pdf");
assert.equal(await storage.verifyChecksum({ blobKey, expectedSha256: sha256 }), true);
assert.match(await storage.createUploadUrl({ blobKey, contentType: "application/pdf", expiresInSeconds: 300 }), /sig=/);
assert.match(await storage.createDownloadUrl({ blobKey, expiresInSeconds: 300 }), /sig=/);

await storage.quarantine({ blobKey, reason: "CHECKSUM_MISMATCH" });
assert.equal(await storage.verifyChecksum({ blobKey, expectedSha256: sha256 }), false);
console.log("Azurite Blob storage passed: private write/read, checksum verification, scoped SAS URLs, and quarantine.");
