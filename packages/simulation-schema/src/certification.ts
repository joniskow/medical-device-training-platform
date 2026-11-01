export interface CertificationPolicy {
  schemaVersion: "certification-policy.v1"; policyId: string; version: number;
  requiredActivityIds: string[]; requiredModuleIds: string[];
  requiredEvidence: string[];
  resultSelection: "best" | "latest"; passScore: number;
  maxAttempts: number; cooldownSeconds: number; attemptTtlSeconds: number;
  repeatedFailureReviewAfter: number | null; expirationDays: number | null;
  publicVerification?: {enabled:boolean;issuerName?:string;courseTitle?:string};
}
export interface PolicyActivity { activityId: string; moduleId: string; kind: "assessment" | "simulation" | "content"; passScore: number; faultIds?:readonly string[] }
export interface PolicyEvidence {
  evidenceId: string; activityId: string; releaseId: string; releaseHash: string; policyId: string; policyVersion: number;
  attemptNumber: number; status: "IN_PROGRESS" | "PASSED" | "FAILED" | "EXPIRED" | "INVALIDATED";
  score: number; maxScore: number; endedAt: number;
  faultOutcomes?: {diagnosedFaultIds:unknown;resolvedFaultIds:unknown};
}
const object = (v: unknown): v is Record<string,unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const identifier = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9._:-]{1,128}$/.test(v);
const range = (v: unknown,min:number,max:number) => Number.isSafeInteger(v) && Number(v)>=min && Number(v)<=max;
const ids = (v: unknown): v is string[] => Array.isArray(v) && v.length<=200 && v.every(identifier) && new Set(v).size===v.length;
export function validCertificationPolicy(value: unknown, activities: readonly PolicyActivity[]): value is CertificationPolicy {
  if(object(value)&&value.publicVerification!==undefined){
    const config=value.publicVerification;
    if(!object(config)||typeof config.enabled!=='boolean'||Object.keys(config).some(key=>!['enabled','issuerName','courseTitle'].includes(key)))return false;
    if(config.enabled&&(![config.issuerName,config.courseTitle].every(text=>typeof text==='string'&&text.trim().length>0)||String(config.issuerName).length>160||String(config.courseTitle).length>240))return false;
  }
  if(!object(value) || value.schemaVersion!=="certification-policy.v1" || !identifier(value.policyId) || !range(value.version,1,1000000)
    || !ids(value.requiredActivityIds) || !ids(value.requiredModuleIds) || !["best","latest"].includes(String(value.resultSelection))
    || !Array.isArray(value.requiredEvidence) || value.requiredEvidence.some(kind=>!["assessment.passed","simulation.completed","simulation.equivalent-path","content.completed"].includes(String(kind)))
    || typeof value.passScore!=="number" || !Number.isFinite(value.passScore) || value.passScore<=0 || value.passScore>1
    || !range(value.maxAttempts,1,100) || !range(value.cooldownSeconds,0,604800) || !range(value.attemptTtlSeconds,60,86400)
    || !(value.expirationDays===null || range(value.expirationDays,1,3650))
    || !(value.repeatedFailureReviewAfter===null || range(value.repeatedFailureReviewAfter,1,100))) return false;
  if(!activities.length || new Set(activities.map(a=>a.activityId)).size!==activities.length
    || activities.some(a=>!identifier(a.activityId)||!identifier(a.moduleId)||!["assessment","simulation","content"].includes(a.kind)||!Number.isFinite(a.passScore)||a.passScore<0||a.passScore>1))return false;
  if(value.requiredActivityIds.some(id=>!activities.some(a=>a.activityId===id)) || value.requiredModuleIds.some(id=>!activities.some(a=>a.moduleId===id)))return false;
  const required=activities.filter(a=>(value.requiredActivityIds as string[]).includes(a.activityId)||(value.requiredModuleIds as string[]).includes(a.moduleId));
  if(required.some(a=>a.kind==='assessment')&&!value.requiredEvidence.includes('assessment.passed'))return false;
  if(required.some(a=>a.kind==='simulation')&&(!value.requiredEvidence.includes('simulation.completed')||!value.requiredEvidence.includes('simulation.equivalent-path')))return false;
  if(value.requiredEvidence.includes('assessment.passed')&&!required.some(a=>a.kind==='assessment'))return false;
  if(value.requiredEvidence.includes('simulation.completed')&&!required.some(a=>a.kind==='simulation'))return false;
  return activities.some(a=>(value.requiredActivityIds as string[]).includes(a.activityId)||(value.requiredModuleIds as string[]).includes(a.moduleId))
    && activities.some(a=>a.kind!=="content" && ((value.requiredActivityIds as string[]).includes(a.activityId)||(value.requiredModuleIds as string[]).includes(a.moduleId)));
}

/** Shared deterministic selection for certification and story facts; input evidence is already release scoped. */
export function selectActivityEvidence(evidence:readonly PolicyEvidence[],activityId:string,resultSelection:'best'|'latest',now:number) {
  const attempts=evidence.filter(e=>e.activityId===activityId).sort((a,b)=>b.attemptNumber-a.attemptNumber||a.evidenceId.localeCompare(b.evidenceId));
    const malformed=attempts.some(e=>!identifier(e.evidenceId)||!range(e.attemptNumber,1,2147483647)||!["IN_PROGRESS","PASSED","FAILED","EXPIRED","INVALIDATED"].includes(e.status)||!Number.isFinite(e.endedAt)
      || !Number.isFinite(e.score)||!Number.isFinite(e.maxScore)||e.score<0||e.maxScore<0||e.score>e.maxScore||(["PASSED","FAILED"].includes(e.status)&&(e.maxScore<=0||e.endedAt>now)))
      || new Set(attempts.map(e=>e.attemptNumber)).size!==attempts.length;
    const completed=attempts.filter(e=>["PASSED","FAILED"].includes(e.status));
    const selected=resultSelection==="latest"?attempts[0]:[...completed].sort((a,b)=>b.score/b.maxScore-a.score/a.maxScore||b.attemptNumber-a.attemptNumber)[0];
  return {attempts,completed,selected,malformed};
}

/** Pure evaluation of trusted server evidence; time is supplied for deterministic replay. */
export function evaluateCertification(input: {policy: unknown; activities: readonly PolicyActivity[]; evidence: readonly PolicyEvidence[]; releaseId:string; releaseHash:string; now:number; reviewedThrough?:Readonly<Record<string,number>>; resetThrough?:Readonly<Record<string,number>>}) {
  const {policy,activities,releaseId,releaseHash,now}=input;
  if(!validCertificationPolicy(policy,activities) || !identifier(releaseId) || !/^[a-f0-9]{64}$/.test(releaseHash) || !Number.isFinite(now))
    return {eligible:false,configurationValid:false,missing:["POLICY_CONFIGURATION_REQUIRED"],activities:[],evidenceIds:[]};
  const required=activities.filter(a=>policy.requiredActivityIds.includes(a.activityId)||policy.requiredModuleIds.includes(a.moduleId));
  const evidence=input.evidence.filter(e=>e.releaseId===releaseId && e.releaseHash===releaseHash && e.policyId===policy.policyId && e.policyVersion===policy.version);
  const evidenceIds:string[]=[];const missing:string[]=[];let totalScore=0,totalMax=0;
  const results=required.map(activity=>{
    const {attempts,completed,selected,malformed}=selectActivityEvidence(evidence,activity.activityId,policy.resultSelection,now);
    const passed=!malformed && selected?.status==="PASSED" && selected.score/selected.maxScore>=activity.passScore;
    const resetValue=input.resetThrough?.[activity.activityId]??0;
    const latestAttemptNumber=attempts[0]?.attemptNumber??0;
    const reset=Number.isSafeInteger(resetValue)&&resetValue>=0&&resetValue<=latestAttemptNumber?resetValue:0;
    const reviewed=Math.max(input.reviewedThrough?.[activity.activityId]??0,reset);
    const failures=completed.filter(e=>e.status==="FAILED" && e.attemptNumber>(Number.isSafeInteger(reviewed)&&reviewed>0?reviewed:0)).length;
    const reviewRequired=policy.repeatedFailureReviewAfter!==null && failures>=policy.repeatedFailureReviewAfter;
    const latest=attempts[0];const retryAt=latest?latest.endedAt+policy.cooldownSeconds*1000:now;
    const attemptsUsed=latestAttemptNumber-reset;
    const canReset=activity.kind!=='content'&&!passed&&!malformed&&attemptsUsed>0&&latest?.status!=='IN_PROGRESS';
    const retryBlockedReasons:string[]=[];
    if(passed)retryBlockedReasons.push('ALREADY_PASSED');
    if(malformed)retryBlockedReasons.push('EVIDENCE_INVALID');
    if(reviewRequired)retryBlockedReasons.push('REVIEW_REQUIRED');
    if(attemptsUsed>=policy.maxAttempts)retryBlockedReasons.push('ATTEMPT_LIMIT');
    if(latest?.status==='IN_PROGRESS')retryBlockedReasons.push('ATTEMPT_IN_PROGRESS');
    else if(now<retryAt)retryBlockedReasons.push('COOLDOWN');
    const retryEligible=retryBlockedReasons.length===0;
    if(!passed)missing.push(`ACTIVITY_REQUIRED:${activity.activityId}`);
    if(reviewRequired)missing.push(`REVIEW_REQUIRED:${activity.activityId}`);
    if(malformed)missing.push(`EVIDENCE_INVALID:${activity.activityId}`);
    if(passed && selected){evidenceIds.push(selected.evidenceId);if(activity.kind!=="content"){totalScore+=selected.score;totalMax+=selected.maxScore;}}
    return {activityId:activity.activityId,passed:Boolean(passed),reviewRequired,retryEligible,retryBlockedReasons,retryAt:retryEligible?now:retryAt,attemptsUsed,latestAttemptNumber,canReset,maxAttempts:policy.maxAttempts,...(selected && !malformed?{score:selected.score,maxScore:selected.maxScore}:{})};
  });
  const score=totalMax>0?totalScore/totalMax:0;
  if(!missing.length && score<policy.passScore)missing.push("OVERALL_SCORE_REQUIRED");
  return {eligible:missing.length===0 && totalMax>0,configurationValid:true,missing,activities:results,evidenceIds,score};
}
