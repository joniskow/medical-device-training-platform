import assert from "node:assert/strict";
import { createDeterministicAssetScanner } from "../apps/worker/dist/asset-scanner.js";
import { createInMemoryObjectStorage } from "../tests/doubles/deterministic-adapters.mjs";

const storage = createInMemoryObjectStorage();
const scanner = createDeterministicAssetScanner();
const cleanRequest = {
  inputAssetVersionId: "assetv_scan_clean",
  sourceType: "pdf",
  blobKey: "org_scan_test/clean.pdf",
  sha256: "unused"
};
await storage.putObject({ blobKey: cleanRequest.blobKey, bytes: Buffer.from("%PDF-1.7\nfixture"), contentType: "application/pdf" });
assert.deepEqual(await scanner.scan({ request: cleanRequest, storage }), { status: "CLEAN", reasons: [] });

const malwareRequest = { ...cleanRequest, inputAssetVersionId: "assetv_scan_malware", blobKey: "org_scan_test/malware.pdf" };
await storage.putObject({ blobKey: malwareRequest.blobKey, bytes: Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.from("X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*")]), contentType: "application/pdf" });
const malware = await scanner.scan({ request: malwareRequest, storage });
assert.equal(malware.status, "QUARANTINE");
assert.deepEqual(malware.reasons, ["MALWARE_SIGNATURE_EICAR"]);

const invalidRequest = { ...cleanRequest, inputAssetVersionId: "assetv_scan_invalid", blobKey: "org_scan_test/invalid.pdf" };
await storage.putObject({ blobKey: invalidRequest.blobKey, bytes: Buffer.from("not a pdf"), contentType: "application/pdf" });
const invalid = await scanner.scan({ request: invalidRequest, storage });
assert.equal(invalid.status, "QUARANTINE");
assert.deepEqual(invalid.reasons, ["CONTENT_SIGNATURE_MISMATCH"]);

console.log("Asset scanner passed: clean PDF, malware signature quarantine, and content-signature quarantine.");
