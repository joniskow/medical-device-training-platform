import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const output = JSON.parse(await readFile("output/fixture-import/aic-001-document-extraction.json", "utf8"));
assert.equal(output.schemaVersion, "document-extraction.v1");
assert.equal(output.fixtureId, "AIC-001");
assert.ok(output.pageCount >= 1);
assert.ok(output.chunks.length >= 1);
for (const chunk of output.chunks) {
  assert.equal(chunk.citation.assetVersionId, output.inputAssetVersionId);
  assert.ok(Number.isInteger(chunk.citation.page) && chunk.citation.page >= 1);
  assert.ok(chunk.text.length > 0);
}
console.log(`Document extraction artifact passed: ${output.pageCount} pages, ${output.chunks.length} cited chunks.`);
