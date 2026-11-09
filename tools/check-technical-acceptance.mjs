import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {assessTechnicalAcceptance} from './technical-acceptance.mjs';

const policy=JSON.parse(await readFile(new URL('../config/technical-acceptance.json',import.meta.url),'utf8'));
assert.deepEqual(policy.gates.flatMap(gate=>gate.tasks).sort(),Array.from({length:36},(_,index)=>`TC-${String(index+1).padStart(2,'0')}`).sort(),'Every TC requirement must be gated exactly once');
const root=await mkdtemp(join(tmpdir(),'technical-acceptance-'));
try{
 const bytes=Buffer.from('Controlled gate evaluator test receipt. This is not real hosted evidence.');
 await writeFile(join(root,'receipt.txt'),bytes);
 const hash=createHash('sha256').update(bytes).digest('hex'),revision='a'.repeat(40),now=Date.parse('2026-11-07T12:00:00Z');
 const release={revision,lockfileSha256:hash,images:Object.fromEntries(policy.requiredImageServices.map(service=>[service,`registry.test/${service}@sha256:${hash}`])),baseUrl:'https://staging.example.test'};
 const imagesSha256=createHash('sha256').update(JSON.stringify(Object.entries(release.images).sort(([a],[b])=>a.localeCompare(b)))).digest('hex');
 const manifest={schemaVersion:'technical-acceptance-evidence.v1',release,gates:policy.gates.map(gate=>({...gate,status:'passed',fixturesUsed:false,executor:'implementer',reviewer:'independent-reviewer',observedAt:'2026-11-07T11:00:00Z',releaseRevision:revision,imagesSha256,artifacts:[{path:'receipt.txt',sha256:hash}],...(gate.id==='independent-security'?{findings:[]}:{}),...(gate.id==='runtime-feasibility'?{devices:['ios-safari','android-chrome','firefox'].map(id=>({id,execution:'physical-device',model:'test-only',osVersion:'1',browserVersion:'1',modelSha256:hash,traceSha256:hash,interactiveMs:4200,minimumFps:31,contextRecovery:true,equivalentPath:true,mediaDecode:true}))}:{})}))};
 const run=(value=manifest,extra={})=>assessTechnicalAcceptance({policy,manifest:value,evidenceRoot:root,expectedRevision:revision,now,...extra});
 assert.equal((await run()).status,'technically-ready-for-ui-integration');
 assert.equal((await run(undefined,{expectedRevision:'b'.repeat(40)})).status,'blocked');
 assert.equal((await run({})).status,'blocked');
 for(const mutate of [m=>m.gates.pop(),m=>m.gates.push(m.gates[0]),m=>m.gates[0].fixturesUsed=true,m=>m.gates[0].reviewer=m.gates[0].executor,m=>m.gates[0].observedAt='2025-01-01T00:00:00Z',m=>m.gates[0].artifacts[0].path='../outside.txt',m=>m.gates[0].artifacts[0].sha256='0'.repeat(64),m=>m.gates.find(g=>g.id==='runtime-feasibility').devices[0].execution='emulation',m=>m.gates.find(g=>g.id==='runtime-feasibility').devices[0].minimumFps=29,m=>m.gates.find(g=>g.id==='independent-security').findings=[{id:'SEC-1',status:'open'}],m=>m.gates.find(g=>g.id==='independent-security').findings=[{id:'SEC-1',status:'accepted',owner:'operator',acceptedBy:'owner',expiresAt:'2025-01-01T00:00:00Z'}]]){
  const altered=structuredClone(manifest);mutate(altered);assert.equal((await run(altered)).status,'blocked');
 }
 for(const malformed of [null,{},'invalid']){
  const altered=structuredClone(manifest);altered.gates.push(malformed);assert.equal((await run(altered)).status,'blocked');
  const badDevices=structuredClone(manifest);badDevices.gates.find(gate=>gate.id==='runtime-feasibility').devices=malformed;assert.equal((await run(badDevices)).status,'blocked');
  const badFindings=structuredClone(manifest);badFindings.gates.find(gate=>gate.id==='independent-security').findings=malformed;assert.equal((await run(badFindings)).status,'blocked');
 }
 console.log('Technical acceptance gate adversarial checks passed. Controlled evaluator fixtures prove fail-closed validation only; no hosted, security or physical-device acceptance is claimed.');
}finally{await rm(root,{recursive:true,force:true});}
