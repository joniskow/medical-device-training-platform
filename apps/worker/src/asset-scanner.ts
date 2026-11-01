import type { AssetProcessingRequest, AssetScanResult, PrivateObjectStoragePort } from "@medical-device/contracts";

const EICAR = Buffer.from("X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*", "ascii");

function startsWith(bytes: Uint8Array, signature: Uint8Array): boolean {
  return signature.every((value, index) => bytes[index] === value);
}

function hasEicar(bytes: Uint8Array): boolean {
  outer: for (let offset = 0; offset <= bytes.length - EICAR.length; offset += 1) {
    for (let index = 0; index < EICAR.length; index += 1) {
      if (bytes[offset + index] !== EICAR[index]) continue outer;
    }
    return true;
  }
  return false;
}

function hasExpectedMagic(sourceType: AssetProcessingRequest["sourceType"], bytes: Uint8Array): boolean {
  if (sourceType === "pdf") return startsWith(bytes, Buffer.from("%PDF-", "ascii"));
  if (sourceType === "image") {
    return startsWith(bytes, Uint8Array.from([0x89, 0x50, 0x4e, 0x47]))
      || startsWith(bytes, Uint8Array.from([0xff, 0xd8, 0xff]))
      || (bytes.length >= 12 && Buffer.from(bytes.slice(8, 12)).toString("ascii") === "WEBP");
  }
  if (sourceType === "glb") return startsWith(bytes, Buffer.from("glTF", "ascii"));
  if (sourceType === "gltf") {
    try {
      const parsed = JSON.parse(Buffer.from(bytes).toString("utf8")) as { asset?: unknown };
      return Boolean(parsed && typeof parsed === "object" && parsed.asset);
    } catch {
      return false;
    }
  }
  return bytes.length > 0;
}

export function createDeterministicAssetScanner(): {
  scan(input: { request: AssetProcessingRequest; storage: PrivateObjectStoragePort }): Promise<AssetScanResult>;
} {
  return {
    async scan({ request, storage }) {
      const object = await storage.readObject({ blobKey: request.blobKey, maxBytes: request.sizeBytes });
      const reasons: string[] = [];
      if (request.sizeBytes !== undefined && object.bytes.byteLength !== request.sizeBytes) reasons.push("CONTENT_SIZE_MISMATCH");
      if (request.contentType && object.contentType.toLowerCase() !== request.contentType.toLowerCase()) reasons.push("CONTENT_TYPE_MISMATCH");
      if (hasEicar(object.bytes)) reasons.push("MALWARE_SIGNATURE_EICAR");
      if (!hasExpectedMagic(request.sourceType, object.bytes)) reasons.push("CONTENT_SIGNATURE_MISMATCH");
      return { status: reasons.length === 0 ? "CLEAN" : "QUARANTINE", reasons };
    }
  };
}
