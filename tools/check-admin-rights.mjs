import assert from 'node:assert/strict';
import {createAssetRightsAttestor,validateAssetRights,handleAdminRights} from '../apps/api/src/admin-rights.ts';

// Exercise the attestation transaction's security and replay decisions. Tenant
// transaction/RLS itself is the shared, separately tested database boundary.
const hash='a'.repeat(64), otherHash='b'.repeat(64), tenant={organizationId:'org:test',actorId:'author:test'};
const assets=new Map([['org:test|photo:test',{asset_version_id:'photo:test',sha256:hash}],['org:test|photo:other',{asset_version_id:'photo:other',sha256:otherHash}]]);
let records=new Map(),audit=[],inactive=false,snapshot;
const client={release(){},async query(sql,params=[]){
  if(sql==='BEGIN'){snapshot={records:structuredClone(records),audit:structuredClone(audit)};return {rows:[],rowCount:0};}
  if(sql==='ROLLBACK'){records=snapshot.records;audit=snapshot.audit;return {rows:[],rowCount:0};}
  if(sql==='COMMIT'||sql.includes('set_config'))return {rows:[],rowCount:0};
  if(sql.startsWith('SELECT v.asset_version_id')){const asset=assets.get(params[0]+'|'+params[1]);return {rows:asset?[asset]:[],rowCount:asset?1:0};}
  if(sql.startsWith('SELECT 1 FROM asset_rights'))return {rows:inactive?[{}]:[],rowCount:inactive?1:0};
  if(sql.startsWith('INSERT INTO asset_rights')){const [id,org,asset,owner,scope,actor]=params;if(records.has(id))return {rows:[],rowCount:0};records.set(id,{attestation_id:id,organization_id:org,asset_version_id:asset,owner_name:owner,use_scope:scope,created_by:actor,status:'ACTIVE',derivative_allowed:true});return {rows:[{attestation_id:id}],rowCount:1};}
  if(sql.startsWith('SELECT * FROM asset_rights')){const row=records.get(params[1]);return {rows:row?.organization_id===params[0]?[row]:[],rowCount:row?1:0};}
  if(sql.startsWith('INSERT INTO audit_events')){audit.push(params);return {rows:[],rowCount:1};}
  throw Error('Unexpected SQL in attestation test: '+sql);
}};
const attest=createAssetRightsAttestor({async connect(){return client;}});
const input={sourceHash:hash,ownerName:'Company',useScope:'Internal training and derivatives',confirmed:true,targetKind:'asset'};
for(const invalid of [{...input,confirmed:false},{...input,organizationId:'org:other'},{...input,actorId:'admin'},{...input,sourceHash:'bad'},{...input,ownerName:''},{...input,targetKind:'anything'},null])assert.throws(()=>validateAssetRights(invalid),/ASSET_RIGHTS_INVALID/);
await assert.rejects(attest({...tenant,actorId:undefined},'photo:test',input,'key'),/INVALID/);
await assert.rejects(attest({...tenant,organizationId:'org:other'},'photo:test',input,'key'),/UNAVAILABLE/);
await assert.rejects(attest(tenant,'photo:test',{...input,sourceHash:otherHash},'key'),/UNAVAILABLE/);
const first=await attest(tenant,'photo:test',input,'one');assert.equal(first.status,'ACTIVE');assert.equal(records.size,1);assert.equal(audit.length,1);
assert.deepEqual(await attest(tenant,'photo:test',input,'one'),first);assert.equal(audit.length,1,'Replay must not duplicate audit events');
await assert.rejects(attest(tenant,'photo:test',{...input,ownerName:'Changed'},'one'),/CONFLICT/);
await assert.rejects(attest(tenant,'photo:other',{...input,sourceHash:otherHash},'one'),/CONFLICT/);
assert.equal(records.size,1);inactive=true;await assert.rejects(attest(tenant,'photo:test',input,'two'),/UNAVAILABLE/);inactive=false;
assert.equal(records.size,1,'Inactive rights cannot be silently restored');
let response;
await handleAdminRights({request:{method:'POST',headers:{'content-type':'application/json'}},response:{writeHead(status){response={status};},end(body){response.body=JSON.parse(body);}},tenant,id:'photo:test',service:{attestRights:attest},readBody:async()=>({...input,confirmed:false}),key:()=> 'http-key'});
assert.equal(response.status,422);assert.equal(response.body.error.code,'ASSET_RIGHTS_INVALID');
console.log('PASS: rights input allowlist, explicit permission, signed actor requirement, company/hash binding, replay deduplication, changed-intent conflict, no withdrawn-rights restoration, transactional audit, and HTTP validation.');
