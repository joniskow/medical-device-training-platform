import assert from 'node:assert/strict';
import {createRetentionTrackedStorage} from '../packages/db/dist/retention-resources.js';

const org = 'org:cache', course = 'course:version:1', asset = 'asset:manual';
const blobKey = `${org}/derived/lesson-speech/${encodeURIComponent(course)}/hash.json`;
let resource, suppressed = false, includeCitation = true, stored;
const query = async (sql, args) => {
  const result = rows => ({rows, rowCount: rows.length});
  if (sql.startsWith('SELECT v.asset_version_id FROM course_versions')) {
    assert.deepEqual(args, [org, course]);
    assert.ok(sql.includes('public.lifecycle_json_has_id(c.content,v.asset_version_id)'));
    return result(includeCitation ? [{asset_version_id: asset}] : []);
  }
  if (sql.startsWith('SELECT asset_version_id FROM asset_versions WHERE organization_id=$1 AND asset_version_id=ANY')) return result(args[1].map(asset_version_id => ({asset_version_id})));
  if (sql.startsWith('SELECT asset_version_id FROM asset_versions WHERE organization_id=$1 AND blob_key')) return result([]);
  if (sql.startsWith('SELECT * FROM retention_blob_resources')) return result(resource ? [resource] : []);
  if (sql.startsWith('SELECT state,asset_version_ids FROM retention_blob_resources')) return result(resource ? [resource] : []);
  if (sql.startsWith('SELECT resource_kind FROM retention_blob_resources')) return result([resource]);
  if (sql.startsWith('INSERT INTO retention_blob_resources')) {
    resource = {resource_kind: args[3], state: 'ACTIVE', asset_version_ids: [...new Set([...(resource?.asset_version_ids ?? []), ...args[4]])]};
    return result([]);
  }
  if (sql.includes('public.lifecycle_asset_suppressed')) {
    assert.ok(args[1].includes(asset), 'persisted cache ancestry must survive removed course citation');
    return result(suppressed ? [{blocked: true}] : []);
  }
  return result([]);
};
const pool = {async connect() {return {query, release() {}};}};
const receipts = {async connect() {return {async query() {return {rows: [], rowCount: 0};}, release() {}};}};
const raw = {async putObject(object) {stored = object;}, async readObject() {return stored;}};
const storage = createRetentionTrackedStorage(pool, raw, {receiptPool: receipts});
await storage.putObject({blobKey, bytes: Buffer.from('private speech cache'), contentType: 'application/json'});
assert.equal(resource.resource_kind, 'LESSON_RENDER');
assert.deepEqual(resource.asset_version_ids, [asset]);
includeCitation = false;
await storage.readObject({blobKey});
suppressed = true;
await assert.rejects(storage.readObject({blobKey}), /RETENTION_RESOURCE_SUPPRESSED/);
await assert.rejects(storage.putObject({blobKey, bytes: Buffer.from('replacement'), contentType: 'application/json'}), /RETENTION_RESOURCE_SUPPRESSED/);
resource.state = 'TOMBSTONED';
await assert.rejects(storage.readObject({blobKey}), /RETENTION_RESOURCE_TOMBSTONED/);
await assert.rejects(storage.putObject({blobKey, bytes: Buffer.from('resurrection'), contentType: 'application/json'}), /RETENTION_RESOURCE_TOMBSTONED/);
console.log('lesson speech retention control-flow checks passed (database/storage doubles)');
