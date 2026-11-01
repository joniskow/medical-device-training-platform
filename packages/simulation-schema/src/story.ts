import {selectActivityEvidence,validCertificationPolicy,type PolicyActivity,type PolicyEvidence} from './certification.js';
/** Declarative course stories. Facts must be supplied by the server for the bound release. */
export type StoryCondition =
  | { activityId: string; fact: 'completed' | 'passed'; equals: boolean }
  | { activityId: string; fact: 'score'; minimum: number }
  | { activityId: string; fact: 'attempts'; minimum: number }
  | { activityId:string;fact:'diagnosed'|'resolved';faultId:string;equals:boolean };
export interface StoryChoice { choiceId: string; label: string; consequence: string; nextNodeId: string; conditions: StoryCondition[] }
export interface StoryNode {
  nodeId: string; title: string; purpose: string; activityId?: string;
  prerequisites: StoryCondition[]; choices: StoryChoice[];
  outcome?: { kind: 'success' | 'retry' | 'ended'; message: string };
}
export interface CourseStory {
  schemaVersion: 'course-story.v1'; mission: string; startNodeId: string; nodes: StoryNode[];
}
export interface StoryActivityFact { activityId: string; completed: boolean; passed: boolean; score: number | null; attempts: number; faults?:Array<{faultId:string;diagnosed:boolean;resolved:boolean}> }
export interface StoryFinding { code: string; path: string; message: string }
const record=(v:unknown):v is Record<string,unknown>=>Boolean(v)&&typeof v==='object'&&!Array.isArray(v);
const id=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(v);
const text=(v:unknown,max=4000):v is string=>typeof v==='string'&&v.trim().length>0&&v.length<=max;
const keys=(v:Record<string,unknown>,allowed:string[])=>Object.keys(v).every(k=>allowed.includes(k));

export interface StoryFaultContext {activityId:string;faultIds:readonly string[]}
/** Resolve only explicitly bound simulation activities; text and assessment IDs cannot name faults. */
export function courseStoryFaultContext(value:unknown):StoryFaultContext[]{
 if(!record(value)||!record(value.simulation)||!record(value.simulation.definition)||!Array.isArray(value.simulation.definition.faults)||!Array.isArray(value.modules))return [];
 const simulation=value.simulation;
 const faultIds=(simulation.definition as Record<string,any>).faults.map((f:unknown)=>record(f)?f.faultId:undefined);
 if(faultIds.some((fault:unknown)=>typeof fault!=='string'||!fault.trim())||new Set(faultIds).size!==faultIds.length)return [];
 return value.modules.flatMap(m=>record(m)&&Array.isArray(m.activities)?m.activities.flatMap(a=>record(a)&&typeof a.activityId==='string'&&['simulation','simulation_outcome','fault_troubleshooting','guided_procedure','manipulation','assembly'].includes(String(a.type))&&typeof simulation.simulationDefinitionId==='string'&&a.simulationDefinitionId===simulation.simulationDefinitionId?[{activityId:a.activityId,faultIds}]:[]):[]);
}

/** Bounds validation work to 200 nodes and 20 choices per node. No executable rules. */
export function validateCourseStory(value:unknown,activityIds:readonly string[],requiredActivityIds:readonly string[]=[],faultContext:readonly StoryFaultContext[]=[]):{valid:boolean;findings:StoryFinding[]} {
 const findings:StoryFinding[]=[];
 const fail=(code:string,path:string,message:string)=>findings.push({code,path,message});
 const done=()=>({valid:findings.length===0,findings});
 if(!record(value)||value.schemaVersion!=='course-story.v1'||!keys(value,['schemaVersion','mission','startNodeId','nodes'])||!text(value.mission)||!id(value.startNodeId)||!Array.isArray(value.nodes)||value.nodes.length<1||value.nodes.length>200){fail('STORY_INVALID','story','Provide a mission, starting node and 1�200 structured story nodes.');return done();}
 const activities=new Set(activityIds);
 if(activities.size!==activityIds.length||activityIds.some(a=>!id(a))||requiredActivityIds.some(a=>!activities.has(a)))fail('STORY_ACTIVITY_CONTEXT_INVALID','story','Story activities and certification requirements must have known, unique identifiers.');
 const conditions=(v:unknown,path:string)=>{
  if(!Array.isArray(v)||v.length>200){fail('STORY_CONDITIONS_INVALID',path,'Use at most 200 recorded activity conditions.');return;}
  for(const [i,c] of v.entries()){
   if(!record(c)||!activities.has(String(c.activityId))||!id(c.activityId)){fail('STORY_CONDITION_INVALID',`${path}[${i}]`,'Condition must reference a known activity.');continue;}
   const faultMatches=faultContext.filter(f=>f.activityId===c.activityId);
   const valid=['diagnosed','resolved'].includes(String(c.fact))?keys(c,['activityId','fact','faultId','equals'])&&typeof c.equals==='boolean'&&typeof c.faultId==='string'&&faultMatches.length===1&&faultMatches[0]!.faultIds.filter(f=>f===c.faultId).length===1:['completed','passed'].includes(String(c.fact))?keys(c,['activityId','fact','equals'])&&typeof c.equals==='boolean':c.fact==='score'?keys(c,['activityId','fact','minimum'])&&typeof c.minimum==='number'&&Number.isFinite(c.minimum)&&c.minimum>=0&&c.minimum<=1:c.fact==='attempts'?keys(c,['activityId','fact','minimum'])&&Number.isSafeInteger(c.minimum)&&Number(c.minimum)>=1&&Number(c.minimum)<=100:false;
   if(!valid)fail('STORY_CONDITION_INVALID',`${path}[${i}]`,'Use completion, passing, normalized score, attempts or a known simulation fault; executable conditions are forbidden.');
  }
 };
 const nodes=new Map<string,StoryNode>();
 for(const [i,n] of value.nodes.entries()){
  const path=`story.nodes[${i}]`;
  if(!record(n)||!keys(n,['nodeId','title','purpose','activityId','prerequisites','choices','outcome'])||!id(n.nodeId)||!text(n.title,240)||!text(n.purpose)||!Array.isArray(n.choices)||n.choices.length>20){fail('STORY_NODE_INVALID',path,'Nodes need an identifier, title, purpose and at most 20 choices.');continue;}
  if(nodes.has(n.nodeId))fail('STORY_NODE_DUPLICATE',path,'Node identifiers must be unique.');else nodes.set(n.nodeId,n as unknown as StoryNode);
  if(n.activityId!==undefined&&(!id(n.activityId)||!activities.has(n.activityId)))fail('STORY_ACTIVITY_UNKNOWN',path,'Node activity must exist in the course.');
  conditions(n.prerequisites,`${path}.prerequisites`);
  const choiceIds=new Set<string>();
  for(const [j,c] of n.choices.entries()){
   if(!record(c)||!keys(c,['choiceId','label','consequence','nextNodeId','conditions'])||!id(c.choiceId)||!id(c.nextNodeId)||!text(c.label,240)||!text(c.consequence)){fail('STORY_CHOICE_INVALID',`${path}.choices[${j}]`,'Choices need unique identifiers, visible labels, consequences and a destination.');continue;}
   if(choiceIds.has(c.choiceId))fail('STORY_CHOICE_DUPLICATE',path,'Choice identifiers must be unique within a node.');choiceIds.add(c.choiceId);
   conditions(c.conditions,`${path}.choices[${j}].conditions`);
  }
  if(n.outcome!==undefined&&(!record(n.outcome)||!keys(n.outcome,['kind','message'])||!['success','retry','ended'].includes(String(n.outcome.kind))||!text(n.outcome.message)))fail('STORY_OUTCOME_INVALID',path,'Terminal outcomes need a supported kind and learner-visible message.');
  if((n.choices.length===0)!==(n.outcome!==undefined))fail('STORY_TERMINAL_INVALID',path,'Every terminal node needs an outcome; nonterminal nodes cannot declare one.');
 }
 if(findings.length)return done();
 if(!nodes.has(value.startNodeId)){fail('STORY_START_UNKNOWN','story.startNodeId','Starting node does not exist.');return done();}
 for(const n of nodes.values())for(const c of n.choices)if(!nodes.has(c.nextNodeId))fail('STORY_DESTINATION_UNKNOWN',`story.nodes.${n.nodeId}`,'Choice destination does not exist.');
 if(findings.length)return done();
 const visiting=new Set<string>(),visited=new Set<string>(),order:string[]=[];
 const visit=(nodeId:string)=>{
  if(visiting.has(nodeId)){fail('STORY_CYCLE',`story.nodes.${nodeId}`,'Story paths cannot contain loops.');return;}
  if(visited.has(nodeId))return;
  visiting.add(nodeId);for(const c of nodes.get(nodeId)!.choices)visit(c.nextNodeId);
  visiting.delete(nodeId);visited.add(nodeId);order.push(nodeId);
 };
 visit(value.startNodeId);
 for(const n of nodes.keys())if(!visited.has(n))fail('STORY_UNREACHABLE',`story.nodes.${n}`,'Node is unreachable from the mission start.');
 if(findings.length)return done();
 // Intersection across predecessors proves required activities occur on every success path.
 const guaranteed=new Map<string,Set<string>>([[value.startNodeId,new Set()]]);
 let successes=0;
 for(const nodeId of order.reverse()){
  const n=nodes.get(nodeId)!,seen=new Set(guaranteed.get(nodeId));if(n.activityId)seen.add(n.activityId);
  if(n.outcome?.kind==='success'){
   successes++;for(const a of requiredActivityIds)if(!seen.has(a))fail('STORY_REQUIRED_ACTIVITY_BYPASS',`story.nodes.${nodeId}`,`Successful paths must include required activity ${a}.`);
  }
  for(const c of n.choices){const previous=guaranteed.get(c.nextNodeId);guaranteed.set(c.nextNodeId,previous?new Set([...previous].filter(a=>seen.has(a))):new Set(seen));}
 }
 if(!successes)fail('STORY_SUCCESS_REQUIRED','story','A story needs a reachable success outcome.');
 return done();
}

/** Missing/invalid evidence never satisfies a condition, including a negative condition. */
export function storyConditionMatches(condition:StoryCondition,facts:readonly StoryActivityFact[]):boolean {
 const matches=facts.filter(f=>f.activityId===condition.activityId);if(matches.length!==1)return false;
 const fact=matches[0]!;
 if(condition.fact==='diagnosed'||condition.fact==='resolved'){
  if(fact.completed!==true||!Array.isArray(fact.faults))return false;
  const outcomes=fact.faults.filter(f=>f.faultId===condition.faultId);if(outcomes.length!==1)return false;
  const outcome=outcomes[0]!;return typeof outcome.diagnosed==='boolean'&&typeof outcome.resolved==='boolean'&&(!outcome.resolved||outcome.diagnosed)&&outcome[condition.fact]===condition.equals;
 }
 if(condition.fact==='completed'||condition.fact==='passed')return typeof fact[condition.fact]==='boolean'&&fact[condition.fact]===condition.equals;
 if(condition.fact==='score')return typeof fact.score==='number'&&Number.isFinite(fact.score)&&fact.score>=0&&fact.score<=1&&fact.score>=condition.minimum;
 return condition.fact==='attempts'&&Number.isSafeInteger(fact.attempts)&&fact.attempts>=condition.minimum;
}

/** Projection only: story success is not certification evidence and never awards a credential. */
export function projectStoryNode(story:CourseStory,nodeId:string,facts:readonly StoryActivityFact[]) {
 const node=story.nodes.find(n=>n.nodeId===nodeId);if(!node)throw Error('STORY_NODE_UNKNOWN');
 const available=node.prerequisites.every(c=>storyConditionMatches(c,facts));
 const activityDone=!node.activityId||facts.filter(f=>f.activityId===node.activityId&&f.completed===true).length===1&&facts.filter(f=>f.activityId===node.activityId).length===1;
 return {nodeId:node.nodeId,title:node.title,purpose:node.purpose,activityId:node.activityId,available,
  outcome:available&&activityDone?node.outcome:undefined,
  choices:node.choices.map(c=>({choiceId:c.choiceId,label:c.label,consequence:c.consequence,nextNodeId:c.nextNodeId,enabled:available&&activityDone&&c.conditions.every(condition=>storyConditionMatches(condition,facts))&&story.nodes.find(n=>n.nodeId===c.nextNodeId)!.prerequisites.every(condition=>storyConditionMatches(condition,facts))}))};
}

/** Caller supplies persisted currentNodeId and release-scoped facts, never values from the request body. */
export function advanceCourseStory(story:CourseStory,currentNodeId:string,choiceId:string,facts:readonly StoryActivityFact[]) {
 const current=projectStoryNode(story,currentNodeId,facts);
 const choice=current.choices.find(c=>c.choiceId===choiceId);
 if(!choice?.enabled)return {accepted:false as const,node:current};
 return {accepted:true as const,consequence:choice.consequence,node:projectStoryNode(story,choice.nextNodeId,facts)};
}


/** Project release/policy-bound server evidence; optional activities are included for practice branches. */
export function projectCourseStoryFacts(input:{policy:unknown;activities:readonly PolicyActivity[];evidence:readonly PolicyEvidence[];releaseId:string;releaseHash:string;now:number}):StoryActivityFact[] {
 const {policy,activities,releaseId,releaseHash,now}=input;
 if(!validCertificationPolicy(policy,activities)||!id(releaseId)||!/^[a-f0-9]{64}$/.test(releaseHash)||!Number.isFinite(now))return [];
 const scoped=input.evidence.filter(e=>e.releaseId===releaseId&&e.releaseHash===releaseHash&&e.policyId===policy.policyId&&e.policyVersion===policy.version);
 return activities.flatMap(activity=>{
  const {attempts,selected,malformed}=selectActivityEvidence(scoped,activity.activityId,policy.resultSelection,now);
  if(malformed)return []; // Corrupt/ambiguous evidence cannot satisfy negative branches either.
  const completed=Boolean(selected&&['PASSED','FAILED'].includes(selected.status));
  let faults:StoryActivityFact['faults'];
  const known=activity.faultIds,history=selected?.faultOutcomes;
  const validList=(value:unknown):value is string[]=>Array.isArray(value)&&new Set(value).size===value.length&&value.every(v=>typeof v==='string'&&known?.includes(v));
  if(completed&&activity.kind==='simulation'&&Array.isArray(known)&&known.length>0&&new Set(known).size===known.length&&known.every(v=>typeof v==='string'&&!!v.trim())&&history&&validList(history.diagnosedFaultIds)&&validList(history.resolvedFaultIds)&&history.resolvedFaultIds.every(v=>(history.diagnosedFaultIds as string[]).includes(v))){
   faults=known.map(faultId=>({faultId,diagnosed:(history.diagnosedFaultIds as string[]).includes(faultId),resolved:(history.resolvedFaultIds as string[]).includes(faultId)}));
  }
  return [{activityId:activity.activityId,...(faults?{faults}:{}),completed,passed:completed&&selected!.status==='PASSED'&&selected!.score/selected!.maxScore>=activity.passScore,
   score:completed?selected!.score/selected!.maxScore:null,attempts:attempts[0]?.attemptNumber??0}];
 });
}
