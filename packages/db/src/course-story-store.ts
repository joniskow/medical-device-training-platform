import {createHash,randomUUID} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import type {TenantContext} from '@medical-device/contracts';
import {advanceCourseStory,projectStoryNode,validateCourseStory,courseStoryFaultContext,validCertificationPolicy,type CourseStory,type PolicyActivity} from '@medical-device/simulation-schema';
import {withTenantTransaction} from './tenant-transaction.js';
import {enrollmentStoryFacts} from './certification-eligibility.js';

export const COURSE_STORY_MIGRATION_SQL=`
CREATE TABLE IF NOT EXISTS course_story_positions (
 organization_id text NOT NULL,enrollment_id text NOT NULL,learner_id text NOT NULL,
 release_id text NOT NULL,release_hash text NOT NULL,node_id text NOT NULL,
 revision integer NOT NULL CHECK(revision>=1),updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,enrollment_id)
);
CREATE TABLE IF NOT EXISTS course_story_choices (
 organization_id text NOT NULL,enrollment_id text NOT NULL,request_id text NOT NULL,
 request_hash text NOT NULL,response jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,enrollment_id,request_id)
);
ALTER TABLE course_story_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE course_story_positions FORCE ROW LEVEL SECURITY;
ALTER TABLE course_story_choices ENABLE ROW LEVEL SECURITY;
ALTER TABLE course_story_choices FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON course_story_positions;
CREATE POLICY tenant_isolation ON course_story_positions USING(organization_id=NULLIF(current_setting('app.organization_id',true),'')) WITH CHECK(organization_id=NULLIF(current_setting('app.organization_id',true),''));
DROP POLICY IF EXISTS tenant_isolation ON course_story_choices;
CREATE POLICY tenant_isolation ON course_story_choices USING(organization_id=NULLIF(current_setting('app.organization_id',true),'')) WITH CHECK(organization_id=NULLIF(current_setting('app.organization_id',true),''));
`;
const id=(value:unknown):value is string=>typeof value==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(value);
export interface StoryChoiceRequest {revision:number;choiceId:string;requestId:string}

/** Private store: HTTP account/organization authorization must precede this service. */
export function createCourseStoryStore(pool:Pool){
 async function context(client:PoolClient,tenant:TenantContext,enrollmentId:string){
  if(!tenant.actorId||!id(enrollmentId))throw Error('STORY_NOT_FOUND');
  const result=await client.query(`SELECT r.release_id,r.release_hash,r.manifest FROM enrollments e
   JOIN release_manifests r ON r.organization_id=e.organization_id AND r.course_version_id=e.course_version_id
   WHERE e.organization_id=$1 AND e.learner_id=$2 AND e.enrollment_id=$3 AND e.status IN ('ACTIVE','COMPLETED') AND r.status='PUBLISHED' AND public.lifecycle_release_available(r.release_id)
   FOR UPDATE OF e FOR SHARE OF r`,[tenant.organizationId,tenant.actorId,enrollmentId]);
  if(result.rows.length!==1)throw Error('STORY_NOT_FOUND');
  const release=result.rows[0],content=release.manifest.content;
  const activities:PolicyActivity[]=(content.modules??[]).flatMap((m:any,i:number)=>(m.activities??[]).map((a:any)=>({activityId:a.activityId,moduleId:m.moduleId??`module:${i}`,kind:['multiple_choice','multi_select','ordered_step'].includes(a.type)?'assessment':['simulation','simulation_outcome','fault_troubleshooting','guided_procedure','manipulation','assembly'].includes(a.type)?'simulation':'content',passScore:a.assessment?.passScore??content.simulation?.definition?.scoring?.passScore??0})));
  const policy=content.policy;
  if(!validCertificationPolicy(policy,activities))throw Error('STORY_CONFIGURATION_INVALID');
  const required=activities.filter(a=>policy.requiredActivityIds.includes(a.activityId)||policy.requiredModuleIds.includes(a.moduleId)).map(a=>a.activityId);
  if(!validateCourseStory(content.story,activities.map(a=>a.activityId),required,courseStoryFaultContext(content)).valid)throw Error('STORY_CONFIGURATION_INVALID');
  const story=content.story as CourseStory;
  await client.query(`INSERT INTO course_story_positions(organization_id,enrollment_id,learner_id,release_id,release_hash,node_id,revision)
   VALUES($1,$2,$3,$4,$5,$6,1) ON CONFLICT DO NOTHING`,[tenant.organizationId,enrollmentId,tenant.actorId,release.release_id,release.release_hash,story.startNodeId]);
  const position=(await client.query('SELECT * FROM course_story_positions WHERE organization_id=$1 AND enrollment_id=$2 FOR UPDATE',[tenant.organizationId,enrollmentId])).rows[0];
  if(position.learner_id!==tenant.actorId||position.release_id!==release.release_id||position.release_hash!==release.release_hash)throw Error('STORY_BINDING_CHANGED');
  if(!story.nodes.some(n=>n.nodeId===position.node_id))throw Error('STORY_CONFIGURATION_INVALID');
  return {story,release,position};
 }
 async function move(tenant:TenantContext,enrollmentId:string,request:Omit<StoryChoiceRequest,'choiceId'>&{choiceId?:string},restart=false){
   if(!request||Object.keys(request).some(k=>!(restart?['revision','requestId']:['revision','choiceId','requestId']).includes(k))||!Number.isSafeInteger(request.revision)||request.revision<1||(!restart&&!id(request.choiceId))||!id(request.requestId))throw Error('STORY_REQUEST_INVALID');
   return withTenantTransaction(pool,tenant,async client=>{
    const {story,release,position}=await context(client,tenant,enrollmentId);
    const signature=createHash('sha256').update(JSON.stringify([tenant.actorId,release.release_id,release.release_hash,request.revision,restart?null:request.choiceId])).digest('hex');
    const prior=(await client.query('SELECT request_hash,response FROM course_story_choices WHERE organization_id=$1 AND enrollment_id=$2 AND request_id=$3',[tenant.organizationId,enrollmentId,request.requestId])).rows[0];
    if(prior){if(prior.request_hash!==signature)throw Error('IDEMPOTENCY_KEY_REUSED');return prior.response;}
    if(position.revision!==request.revision)throw Error('STORY_REVISION_CONFLICT');
    const facts=await enrollmentStoryFacts(client,tenant,enrollmentId);
    const current=projectStoryNode(story,position.node_id,facts);
    const transition=restart?{accepted:current.outcome?.kind==='retry',node:projectStoryNode(story,story.startNodeId,facts),consequence:'Mission restarted. Recorded results and attempt rules are unchanged.'}:advanceCourseStory(story,position.node_id,request.choiceId!,facts);
    if(!transition.accepted)throw Error('STORY_CHOICE_NOT_AVAILABLE');
    const response={enrollmentId,releaseId:release.release_id,releaseHash:release.release_hash,revision:position.revision+1,nodeId:transition.node.nodeId,consequence:transition.consequence};
    await client.query('UPDATE course_story_positions SET node_id=$3,revision=revision+1,updated_at=now() WHERE organization_id=$1 AND enrollment_id=$2',[tenant.organizationId,enrollmentId,response.nodeId]);
    await client.query('INSERT INTO course_story_choices(organization_id,enrollment_id,request_id,request_hash,response) VALUES($1,$2,$3,$4,$5::jsonb)',[tenant.organizationId,enrollmentId,request.requestId,signature,JSON.stringify(response)]);
    await client.query(`INSERT INTO audit_events(audit_event_id,organization_id,actor_id,event_type,resource_type,resource_id,details,created_at)
     VALUES($1,$2,$3,'${restart?'STORY_RESTARTED':'STORY_CHOICE_ACCEPTED'}','enrollment',$4,$5::jsonb,now())`,[randomUUID(),tenant.organizationId,tenant.actorId,enrollmentId,JSON.stringify({releaseId:release.release_id,releaseHash:release.release_hash,fromNodeId:position.node_id,toNodeId:response.nodeId,choiceId:request.choiceId,revision:response.revision,requestId:request.requestId,correlationId:tenant.correlationId})]);
    return response;
   });
  }

 return {
  async get(tenant:TenantContext,enrollmentId:string){return withTenantTransaction(pool,tenant,async client=>{
   const {story,release,position}=await context(client,tenant,enrollmentId);
   const facts=await enrollmentStoryFacts(client,tenant,enrollmentId);
   return {enrollmentId,releaseId:release.release_id,releaseHash:release.release_hash,mission:story.mission,revision:position.revision,node:projectStoryNode(story,position.node_id,facts)};
  });},
  choose:(tenant:TenantContext,enrollmentId:string,request:StoryChoiceRequest)=>move(tenant,enrollmentId,request),
  restart:(tenant:TenantContext,enrollmentId:string,request:Omit<StoryChoiceRequest,'choiceId'>)=>move(tenant,enrollmentId,request,true)
 };
}

/** Call within the activity transaction. Shared enrollment lock serializes against story choices. */
export async function assertStoryActivityAccess(client:PoolClient,tenant:TenantContext,enrollmentId:string,releaseId:string,activityId:string,runtimeActivity=false){
 const result=await client.query(`SELECT r.release_hash,r.manifest FROM enrollments e
 JOIN release_manifests r ON r.organization_id=e.organization_id AND r.course_version_id=e.course_version_id
 WHERE e.organization_id=$1 AND e.enrollment_id=$2 AND e.learner_id=$3 AND e.status IN ('ACTIVE','COMPLETED') AND r.release_id=$4 AND r.status='PUBLISHED' AND public.lifecycle_release_available(r.release_id)
 FOR SHARE OF e,r`,[tenant.organizationId,enrollmentId,tenant.actorId,releaseId]);
 const release=result.rows[0];if(!release)throw Error('STORY_ACTIVITY_UNAVAILABLE');
 const content=release.manifest.content;if(content.story===undefined)return;
 const activities=(content.modules??[]).flatMap((m:any)=>m.activities??[]);
 if(!validateCourseStory(content.story,activities.map((a:any)=>a.activityId),[],courseStoryFaultContext(content)).valid)throw Error('STORY_ACTIVITY_UNAVAILABLE');
 const story=content.story as CourseStory;
 const matches=runtimeActivity?(content.runtimeBindings?.activities??[]).filter((a:any)=>a.runtimeActivityId===activityId):activities.filter((a:any)=>a.activityId===activityId);
 if(matches.length!==1)throw Error('STORY_ACTIVITY_UNAVAILABLE');
 const publicId=matches[0].activityId;
 const position=(await client.query('SELECT * FROM course_story_positions WHERE organization_id=$1 AND enrollment_id=$2',[tenant.organizationId,enrollmentId])).rows[0];
 if(position&&(position.learner_id!==tenant.actorId||position.release_id!==releaseId||position.release_hash!==release.release_hash))throw Error('STORY_ACTIVITY_UNAVAILABLE');
 const nodeId=position?.node_id??story.startNodeId;
 const node=story.nodes.find(n=>n.nodeId===nodeId);
 if(!node||node.activityId!==publicId)throw Error('STORY_ACTIVITY_UNAVAILABLE');
 const facts=await enrollmentStoryFacts(client,tenant,enrollmentId);
 if(!projectStoryNode(story,nodeId,facts).available)throw Error('STORY_ACTIVITY_UNAVAILABLE');
}
