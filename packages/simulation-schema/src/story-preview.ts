import {validateCourseStory,projectStoryNode,advanceCourseStory,type CourseStory,type StoryActivityFact} from './story.js';
import type {PolicyActivity} from './certification.js';
export interface StoryPathCase {nodeIds:string[];choiceIds:string[];facts:StoryActivityFact[];status:'success'|'retry'|'ended'|'blocked';reason?:string}
export interface StoryPathReport {valid:boolean;complete:boolean;totalScenarios:number;scenariosChecked:number;statesChecked:number;cases:StoryPathCase[];unreachedNodes:string[];unreachedChoices:Array<{nodeId:string;choiceId:string}>}
/** Representative completed-result scenarios, not an assessment/model reachability or certification proof. */
export function previewCourseStory(story:CourseStory,activities:readonly PolicyActivity[],required:string[],maxAttempts=3):StoryPathReport {
 const report:StoryPathReport={valid:false,complete:false,totalScenarios:0,scenariosChecked:0,statesChecked:0,cases:[],unreachedNodes:[],unreachedChoices:[]};
 if(!Number.isSafeInteger(maxAttempts)||maxAttempts<1||maxAttempts>100||activities.some(a=>!Number.isFinite(a.passScore)||a.passScore<0||a.passScore>1)||!validateCourseStory(story,activities.map(a=>a.activityId),required,activities.filter(a=>a.kind==='simulation'&&a.faultIds).map(a=>({activityId:a.activityId,faultIds:a.faultIds!}))).valid)return report;
 report.valid=true;
 const conditions=story.nodes.flatMap(n=>[...n.prerequisites,...n.choices.flatMap(c=>c.conditions)]);
 const used=activities.filter(a=>story.nodes.some(n=>n.activityId===a.activityId));
 let scenarios:Array<Record<string,StoryActivityFact>>=[{}],total=1;
 for(const activity of used){
  const refs=conditions.filter(c=>c.activityId===activity.activityId);
  // >= comparisons change truth only at the threshold. Zero represents the lowest interval.
  const scores=[...new Set([0,1,activity.passScore,...refs.flatMap(c=>c.fact==='score'?[c.minimum]:[])])].sort((a,b)=>a-b);
  const counts=[...new Set([1,...refs.flatMap(c=>c.fact==='attempts'&&c.minimum<=maxAttempts?[c.minimum]:[])])].sort((a,b)=>a-b);
  const outcomes:StoryActivityFact[]=activity.kind==='content'?[{activityId:activity.activityId,completed:true,passed:true,score:1,attempts:1}]:counts.flatMap(attempts=>scores.flatMap(score=>[
   {activityId:activity.activityId,completed:true,passed:false,score,attempts},
   ...(score>=activity.passScore?[{activityId:activity.activityId,completed:true,passed:true,score,attempts}]:[])
  ]));
  const faultIds=[...new Set(refs.flatMap(c=>c.fact==='diagnosed'||c.fact==='resolved'?[c.faultId]:[]))];
  let histories:Array<NonNullable<StoryActivityFact['faults']>>=[[]],historyCount=1;
  for(const faultId of faultIds){
   historyCount=Math.min(Number.MAX_SAFE_INTEGER,historyCount*3);
   const nextHistory:Array<NonNullable<StoryActivityFact['faults']>>=[];
   historyLoop:for(const history of histories)for(const [diagnosed,resolved] of [[false,false],[true,false],[true,true]]){nextHistory.push([...history,{faultId,diagnosed:diagnosed!,resolved:resolved!}]);if(nextHistory.length>=128)break historyLoop;}
   histories=nextHistory;
  }
  // Missing historical evidence is distinct from a recorded negative outcome.
  const variants:Array<StoryActivityFact['faults']>=faultIds.length?[undefined,...histories].slice(0,128):[undefined];
  if(faultIds.length)historyCount=Math.min(Number.MAX_SAFE_INTEGER,historyCount+1);
  total=Math.min(Number.MAX_SAFE_INTEGER,total*outcomes.length*historyCount);
  const next:Array<Record<string,StoryActivityFact>>=[];
  outer:for(const scenario of scenarios)for(const outcome of outcomes)for(const faults of variants){next.push({...scenario,[activity.activityId]:{...outcome,...(faults?{faults}:{})}});if(next.length>=128)break outer;}
  scenarios=next;
 }
 report.totalScenarios=total;
 const visited=new Set<string>(),edges=new Set<string>();let truncated=total>scenarios.length;
 const empty=activities.map(a=>({activityId:a.activityId,completed:false,passed:false,score:null,attempts:0} as StoryActivityFact));
 const edge=(nodeId:string,choiceId:string)=>JSON.stringify([nodeId,choiceId]);
 outer:for(const scenario of scenarios){
  if(report.statesChecked>=4096||report.cases.length>=128){truncated=true;break;}
  const pending=[{nodeId:story.startNodeId,facts:empty,nodeIds:[] as string[],choiceIds:[] as string[]}];
  report.scenariosChecked++;
  while(pending.length){
   if(report.statesChecked>=4096||report.cases.length>=128){truncated=true;break outer;}
   const state=pending.pop()!;report.statesChecked++;visited.add(state.nodeId);
   const path=[...state.nodeIds,state.nodeId],definition=story.nodes.find(n=>n.nodeId===state.nodeId)!;
   let facts=state.facts,projection=projectStoryNode(story,state.nodeId,facts);
   if(projection.available&&definition.activityId){facts=facts.map(f=>f.activityId===definition.activityId?scenario[f.activityId]??f:f);projection=projectStoryNode(story,state.nodeId,facts);}
   const enabled=projection.choices.filter(c=>c.enabled);
   if(projection.outcome||!enabled.length){
    report.cases.push({nodeIds:path,choiceIds:state.choiceIds,facts,status:projection.outcome?.kind??'blocked',...(!projection.outcome?{reason:projection.available?'No choice is enabled after the representative activity result.':'Node prerequisites are not met before the activity can start.'}:{})});continue;
   }
   for(const choice of enabled){
    const next=advanceCourseStory(story,state.nodeId,choice.choiceId,facts);if(!next.accepted)continue;
    edges.add(edge(state.nodeId,choice.choiceId));pending.push({nodeId:next.node.nodeId,facts,nodeIds:path,choiceIds:[...state.choiceIds,choice.choiceId]});
   }
  }
 }
 report.complete=!truncated;
 report.unreachedNodes=story.nodes.filter(n=>!visited.has(n.nodeId)).map(n=>n.nodeId);
 report.unreachedChoices=story.nodes.flatMap(n=>n.choices.filter(c=>!edges.has(edge(n.nodeId,c.choiceId))).map(c=>({nodeId:n.nodeId,choiceId:c.choiceId})));
 return report;
}
