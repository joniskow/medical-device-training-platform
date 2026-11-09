import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createTrainingClient, prepareModelAction } from '../packages/api-client/dist/index.js';

/** Prepared staging content only. Upload, AI generation and source/model approval are separate prerequisites. */
export function validateCertificationScenario(config, allowLoopback=false) {
 const fail=()=>{throw Error('CERTIFICATION_SCENARIO_INVALID');};
 if(!config||config.schemaVersion!=='prepared-certification-acceptance.v1')fail();
 let base;try{base=new URL(config.baseUrl);}catch{fail();}
 if(base.username||base.password||base.search||base.hash||base.pathname!=='/'||(base.protocol!=='https:'&&!(allowLoopback&&base.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(base.hostname))))fail();
 const id=value=>typeof value==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(value);
 if(!id(config.organizationId)||!id(config.courseVersionId)||!Array.isArray(config.reviewTargets)||!config.reviewTargets.length||config.reviewTargets.some(t=>!id(t.targetId)||!['COURSE','AI_DRAFT','SOURCE','MODEL','SIMULATION','ASSESSMENT','POLICY','VIDEO_LESSON'].includes(t.targetType)))fail();
 if(!['COURSE','AI_DRAFT','MODEL','SIMULATION','ASSESSMENT','POLICY'].every(type=>config.reviewTargets.some(target=>target.targetType===type)))fail();
 if(!Array.isArray(config.activities)||!config.activities.length||config.activities.some(a=>!Number.isSafeInteger(a.moduleIndex)||a.moduleIndex<0||!Number.isSafeInteger(a.activityIndex)||a.activityIndex<0||!['reading','model','assessment'].includes(a.kind)||a.kind==='model'&&(!Array.isArray(a.actions)||!a.actions.length)||a.kind==='assessment'&&(!Array.isArray(a.answers)||!a.answers.length)))fail();
 if(!['reading','model','assessment'].every(kind=>config.activities.some(a=>a.kind===kind)))fail();
 if(new Set(config.activities.map(a=>`${a.moduleIndex}:${a.activityIndex}`)).size!==config.activities.length)fail();
 return config;
}

export async function runPreparedCertification(config,{tokens,fetch:transport=fetch,allowLoopback=false,onStep=()=>{}}) {
 validateCertificationScenario(config,allowLoopback);
 for(const role of ['author','reviewer','learner'])if(typeof tokens?.[role]!=='string'||!tokens[role].trim())throw Error('CERTIFICATION_REAL_ACCESS_TOKENS_REQUIRED');
 if(new Set(Object.values(tokens)).size!==3)throw Error('CERTIFICATION_DISTINCT_IDENTITIES_REQUIRED');
 const clients=Object.fromEntries(['author','reviewer','learner'].map(role=>[role,createTrainingClient({baseUrl:config.baseUrl,getContext:()=>({identity:role,organizationId:config.organizationId}),getAccessToken:()=>tokens[role],fetch:request=>transport(request,{signal:AbortSignal.any([request.signal,AbortSignal.timeout(30000)])})})]));
 const {author,reviewer,learner}=clients;
 const accounts=await Promise.all([author.getAccount(),reviewer.getAccount(),learner.getAccount()]);
 if(accounts.some(result=>!result.account||result.account.status!=='ACTIVE')||new Set(accounts.map(result=>result.account.userId)).size!==3||accounts[2].account.emailVerified!==true)throw Error('CERTIFICATION_DISTINCT_ACTIVE_VERIFIED_ACCOUNTS_REQUIRED');
 onStep('distinct-active-identities');
 const snapshot=await author.getCourseVersion(config.courseVersionId);
 if(snapshot.courseVersion.courseVersionId!==config.courseVersionId||snapshot.courseVersion.content.schemaVersion!=='course-draft.v1')throw Error('CERTIFICATION_DRAFT_BINDING_INVALID');
 const revision=snapshot.courseVersion.revision;
 const prefix=`certification:${randomUUID()}`;
 for(const [index,target] of config.reviewTargets.entries())await reviewer.reviewCourseVersion(config.courseVersionId,{...target,revision,decision:'APPROVE',rationale:'Controlled staging certification acceptance rehearsal; qualified content approval is recorded separately.'},`${prefix}:review:${index}`);
 onStep('independent-review');
 const release=await reviewer.publishCourseVersion(config.courseVersionId,`${prefix}:publish`);
 assert.equal(release.courseVersionId,config.courseVersionId);
 onStep('immutable-publication');
 const enrollment=await author.assignEnrollment(accounts[2].account.userId,release.releaseId);
 const enrolled=await learner.getEnrollment(enrollment.enrollmentId);
 assert.equal(enrolled.releaseId,release.releaseId);
 onStep('organization-assignment');
 for(const [index,instruction] of config.activities.entries()){
  const activity=enrolled.content.modules[instruction.moduleIndex]?.activities[instruction.activityIndex];
  if(!activity)throw Error('CERTIFICATION_ACTIVITY_BINDING_INVALID');
  if(instruction.kind==='reading')await learner.acknowledgeActivity(enrollment.enrollmentId,activity.activityId);
  if(instruction.kind==='model'){
   let session=await learner.startActivity(enrollment.enrollmentId,activity.activityId),state=session.state;
   for(const requirement of instruction.actions){
    const action=prepareModelAction(session,state,{source:'KEYBOARD',...requirement});
    const [first,replay]=await Promise.all([learner.submitAction(session.sessionId,action),learner.submitAction(session.sessionId,action)]);
    assert.equal(first.status,'accepted');assert.deepEqual(replay,first,'Concurrent identical model actions must replay without duplicate effects');
    state=first.state;
   }
   assert.equal(state.completed,true,'Required model procedure/fault sequence did not complete');
   assert.equal((await learner.resume(session,state.nextSequence)).state.completed,true);
  }
  if(instruction.kind==='assessment'){
   const attempt=await learner.startAssessment(enrollment.enrollmentId,release.releaseId,activity.activityId,`${prefix}:assessment:${index}`);
   assert(!JSON.stringify(attempt).includes('correctOptionIds'),'Private answer identities leaked');
   const [first,replay]=await Promise.all([learner.submitAssessment(attempt.sessionId,instruction.answers),learner.submitAssessment(attempt.sessionId,instruction.answers)]);
   assert.equal(first.result?.passed,true);assert.deepEqual(replay,first);
  }
  onStep(`required-${instruction.kind}-${index}`);
 }
 const [issued,replayed]=await Promise.all([learner.issueCredential(enrollment.enrollmentId),learner.issueCredential(enrollment.enrollmentId)]);
 assert.equal(issued.credentialId,replayed.credentialId);assert.equal(issued.status,'ACTIVE');
 let matches=[],after;const cursors=new Set();
 do{const page=await learner.listCredentials(after);matches.push(...page.items.filter(item=>item.releaseId===release.releaseId));after=page.nextCursor??undefined;if(after){if(cursors.has(after)||cursors.size>=100)throw Error('CERTIFICATION_CREDENTIAL_PAGINATION_INVALID');cursors.add(after);}}while(after);
 assert.equal(matches.length,1,'The release must have exactly one credential for the learner');
 assert.equal(issued.verificationAllowed,true,'The rehearsal policy must permit public verification');
 if(!issued.verificationEnabled)await learner.setCredentialSharing(issued.credentialId,true,issued.sharingRevision,`${prefix}:sharing`);
 const verified=await learner.verifyCredential(issued.publicId);
 assert.equal(verified.status,'ACTIVE');
 assert.deepEqual(Object.keys(verified).sort(),['courseTitle','expiresAt','intendedUse','issuedAt','issuerName','status','verifiedAt'].sort());
 onStep('exactly-once-credential-public-verification');
 return {scope:'prepared-draft-to-credential',identityMode:'externally-supplied-access-tokens',courseVersionId:config.courseVersionId,revision,releaseHash:release.releaseHash,completedActivityCount:config.activities.length};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const [scenarioPath,evidencePath]=process.argv.slice(2);
 if(!scenarioPath||!evidencePath)throw Error('Usage: node tools/run-prepared-certification-acceptance.mjs <private-scenario.json> <evidence.json>');
 const bytes=await readFile(scenarioPath),config=JSON.parse(bytes),steps=[];
 const evidence={schemaVersion:'certification-acceptance-evidence.v1',startedAt:new Date().toISOString(),scenarioSha256:createHash('sha256').update(bytes).digest('hex'),steps,status:'FAILED',excluded:['source-upload-and-approval','actual-ai-generation','candidate-self-enrollment','real-blob-and-service-bus-evidence','qualified-content-acceptance']};
 try{Object.assign(evidence,await runPreparedCertification(config,{tokens:{author:process.env.CERTIFICATION_AUTHOR_TOKEN,reviewer:process.env.CERTIFICATION_REVIEWER_TOKEN,learner:process.env.CERTIFICATION_LEARNER_TOKEN},onStep:step=>steps.push({step,completedAt:new Date().toISOString()})}),{status:'PASSED'});}
 catch(error){evidence.failureCode=typeof error.code==='string'?error.code:error.name==='AssertionError'?'CERTIFICATION_ASSERTION_FAILED':['CERTIFICATION_SCENARIO_INVALID','CERTIFICATION_REAL_ACCESS_TOKENS_REQUIRED','CERTIFICATION_DISTINCT_IDENTITIES_REQUIRED','CERTIFICATION_DISTINCT_ACTIVE_VERIFIED_ACCOUNTS_REQUIRED','CERTIFICATION_DRAFT_BINDING_INVALID','CERTIFICATION_ACTIVITY_BINDING_INVALID'].includes(error.message)?error.message:'CERTIFICATION_ACCEPTANCE_FAILED';process.exitCode=1;}
 finally{evidence.finishedAt=new Date().toISOString();await writeFile(evidencePath,JSON.stringify(evidence,null,2)+'\n',{mode:0o600});console.log(`Prepared certification acceptance: ${evidence.status}. Evidence excludes secrets, answers, public credential handles and response bodies.`);}
}
