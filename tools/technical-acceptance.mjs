import {createHash} from 'node:crypto';
import {readFile, realpath, stat} from 'node:fs/promises';
import {dirname, isAbsolute, relative, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.trim().length > 0;
const sha = value => createHash('sha256').update(value).digest('hex');
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const inside = (root, path) => {const rel=relative(root,path);return rel!==''&&!isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('../')&&!rel.startsWith('..\\');};
const time = value => typeof value === 'string' && /T.*Z$/.test(value) ? Date.parse(value) : NaN;

/** Checks evidence integrity and release binding, not the truth of a human attestation.
 * Receipts must be retained and reviewed independently; this tool never creates approvals. */
export async function assessTechnicalAcceptance({policy, manifest, evidenceRoot, expectedRevision, now=Date.now()}) {
  if(policy?.schemaVersion!=='technical-acceptance-policy.v1'||!Array.isArray(policy.gates)||policy.gates.length===0||!Number.isSafeInteger(policy.maximumEvidenceAgeDays)||policy.maximumEvidenceAgeDays<1||!Array.isArray(policy.requiredImageServices)||policy.requiredImageServices.length===0)throw Error('ACCEPTANCE_POLICY_INVALID');
  const ids = new Set();
  for(const gate of policy.gates){if(!text(gate.id)||ids.has(gate.id)||!Array.isArray(gate.tasks)||!gate.tasks.length||!['hosted','physical-device','independent-review'].includes(gate.execution))throw Error('ACCEPTANCE_POLICY_INVALID');ids.add(gate.id);}
  const errors=[];
  const add=(gate,code)=>errors.push({gate,code});
  if(manifest?.schemaVersion!=='technical-acceptance-evidence.v1'||!object(manifest.release)||!Array.isArray(manifest.gates))return {status:'blocked',errors:[{gate:'manifest',code:'EVIDENCE_MANIFEST_REQUIRED'}],deferredLaunchGates:policy.deferredLaunchGates};
  const {release}=manifest;
  if(!/^[a-f0-9]{40}$/.test(release.revision??'')||release.revision!==expectedRevision||!hex(release.lockfileSha256)||!object(release.images)||policy.requiredImageServices.some(service=>!/^.+@sha256:[a-f0-9]{64}$/.test(release.images[service]??'')))add('release','RELEASE_IDENTITY_INVALID');
  try {const url=new URL(release.baseUrl);if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw Error();}catch{add('release','HOSTED_ORIGIN_REQUIRED');}
  if(manifest.gates.some(gate=>!object(gate)||!ids.has(gate.id))||new Set(manifest.gates.map(gate=>gate?.id)).size!==manifest.gates.length)add('manifest','UNKNOWN_OR_DUPLICATE_GATE');
  const root=await realpath(evidenceRoot);
  for(const required of policy.gates){
    const gate=manifest.gates.find(candidate=>candidate?.id===required.id);
    if(!gate){add(required.id,'EVIDENCE_MISSING');continue;}
    if(gate.status!=='passed'||gate.execution!==required.execution||gate.fixturesUsed!==false||!text(gate.executor)||!text(gate.reviewer)||gate.executor===gate.reviewer||!Array.isArray(gate.tasks)||required.tasks.some(task=>!gate.tasks.includes(task)))add(required.id,'INDEPENDENT_REAL_DEPENDENCY_RESULT_REQUIRED');
    if(gate.releaseRevision!==release.revision||gate.imagesSha256!==sha(JSON.stringify(Object.entries(release.images??{}).sort(([a],[b])=>a.localeCompare(b)))))add(required.id,'GATE_RELEASE_BINDING_INVALID');
    const measured=time(gate.observedAt);
    if(!Number.isFinite(measured)||measured>now+60_000||measured<now-policy.maximumEvidenceAgeDays*86400000)add(required.id,'EVIDENCE_STALE_OR_INVALID');
    if(!Array.isArray(gate.artifacts)||!gate.artifacts.length){add(required.id,'ARTIFACTS_REQUIRED');continue;}
    for(const artifact of gate.artifacts){
      try {
        if(!object(artifact)||!text(artifact.path)||isAbsolute(artifact.path)||!hex(artifact.sha256))throw Error();
        const path=await realpath(resolve(root,artifact.path)),info=await stat(path);
        if(!inside(root,path)||!info.isFile()||info.size<1||info.size>32*1024*1024)throw Error();
        if(sha(await readFile(path))!==artifact.sha256)throw Error();
      }catch{add(required.id,'ARTIFACT_MISSING_UNSAFE_OR_HASH_MISMATCH');}
    }
    if(required.id==='runtime-feasibility'){
      const devices=Array.isArray(gate.devices)?gate.devices:[];
      if(!['ios-safari','android-chrome','firefox'].every(id=>devices.some(device=>object(device)&&device.id===id&&device.execution==='physical-device'&&text(device.model)&&text(device.osVersion)&&text(device.browserVersion)&&hex(device.modelSha256)&&hex(device.traceSha256)&&Number.isFinite(device.interactiveMs)&&device.interactiveMs>0&&device.interactiveMs<=5000&&Number.isFinite(device.minimumFps)&&device.minimumFps>=30&&device.contextRecovery===true&&device.equivalentPath===true&&device.mediaDecode===true)))add(required.id,'PHYSICAL_RUNTIME_MEASUREMENTS_REQUIRED');
      if(devices.some(device=>!object(device)||!gate.artifacts.some(artifact=>artifact?.sha256===device.traceSha256)))add(required.id,'PHYSICAL_TRACE_ARTIFACT_REQUIRED');
    }
    if(required.id==='independent-security'){
      if(!Array.isArray(gate.findings)||gate.findings.some(finding=>!object(finding)||!text(finding.id)||!['closed','accepted'].includes(finding.status)||!text(finding.owner)||finding.status==='closed'&&!hex(finding.retestSha256)||finding.status==='accepted'&&(!text(finding.acceptedBy)||!Number.isFinite(time(finding.expiresAt))||time(finding.expiresAt)<=now)))add(required.id,'SECURITY_FINDINGS_UNRESOLVED');
      if(Array.isArray(gate.findings)&&gate.findings.some(finding=>object(finding)&&finding.status==='closed'&&!gate.artifacts.some(artifact=>artifact?.sha256===finding.retestSha256)))add(required.id,'SECURITY_RETEST_ARTIFACT_REQUIRED');
    }
  }
  return {status:errors.length?'blocked':'technically-ready-for-ui-integration',release,errors,deferredLaunchGates:policy.deferredLaunchGates};
}

async function main(){
  const args=process.argv.slice(2),get=name=>args.find(value=>value.startsWith(name+'='))?.slice(name.length+1);
  if(args.some(value=>!['--evidence=','--revision='].some(prefix=>value.startsWith(prefix)))||!get('--evidence')||!get('--revision'))throw Error('Usage: node tools/technical-acceptance.mjs --evidence=path/to/manifest.json --revision=<40-character-tested-commit>');
  const file=resolve(get('--evidence')),policy=JSON.parse(await readFile(new URL('../config/technical-acceptance.json',import.meta.url),'utf8'));
  const result=await assessTechnicalAcceptance({policy,manifest:JSON.parse(await readFile(file,'utf8')),evidenceRoot:dirname(file),expectedRevision:get('--revision')});
  console.log(JSON.stringify(result,null,2));if(result.status==='blocked')process.exitCode=1;
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)main().catch(error=>{console.error(error.message);process.exitCode=1;});
