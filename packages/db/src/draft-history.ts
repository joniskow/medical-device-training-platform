import {createHash} from 'node:crypto';
import type {Pool} from 'pg';
import type {CourseReviewStorePort} from '@medical-device/contracts';
import {withTenantTransaction} from './tenant-transaction.js';

const events=['COURSE_DRAFT_EDITED','COURSE_DRAFT_GENERATED','DRAFT_SIMULATION_CREATED','DRAFT_MODEL_BOUND','DRAFT_MODEL_REPLACED','COURSE_DRAFT_RESTORED'];
const identifier=(value:unknown)=>typeof value==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(value);
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);

/** Restore immutable audit snapshots as new draft revisions; never rewind revision numbers. */
export function draftHistoryOperations(pool:Pool):Pick<CourseReviewStorePort,'listDraftHistory'|'restoreDraftHistory'|'previewDraftHistory'>{
 return {
  async previewDraftHistory(tenant,courseVersionId,eventId,side){
   if(![courseVersionId,eventId].every(identifier)||!['before','after'].includes(side))throw Error('COURSE_DRAFT_INVALID');
   return withTenantTransaction(pool,tenant,async client=>{
    const course=(await client.query('SELECT revision,status,content FROM course_versions WHERE organization_id=$1 AND course_version_id=$2 FOR SHARE',[tenant.organizationId,courseVersionId])).rows[0];
    if(!course)throw Error('COURSE_VERSION_NOT_FOUND');
    const event=(await client.query("SELECT details FROM audit_events WHERE organization_id=$1 AND resource_type='course_version' AND resource_id=$2 AND audit_event_id=$3 AND event_type=ANY($4::text[])",[tenant.organizationId,courseVersionId,eventId,events])).rows[0];
    const snapshot=event?.details?.[side];if(!object(snapshot))throw Error('DRAFT_HISTORY_NOT_FOUND');
    const {_lineage:ignoredLineage,...editable}=snapshot;
    return {revision:course.revision,status:course.status,current:course.content,selected:{...editable,...(course.content._lineage?{_lineage:course.content._lineage}:{})}};
   });
  },
  async listDraftHistory(tenant,courseVersionId,beforeRevision){
   if(!identifier(courseVersionId)||(beforeRevision!==undefined&&(!Number.isSafeInteger(beforeRevision)||beforeRevision<1)))throw Error('COURSE_DRAFT_INVALID');
   return withTenantTransaction(pool,tenant,async client=>{
    if(!(await client.query('SELECT 1 FROM course_versions WHERE organization_id=$1 AND course_version_id=$2',[tenant.organizationId,courseVersionId])).rowCount)throw Error('COURSE_VERSION_NOT_FOUND');
    const rows=(await client.query(`SELECT audit_event_id,event_type,actor_id,created_at,details->'revision' AS revision,details->'nextRevision' AS next_revision FROM audit_events
     WHERE organization_id=$1 AND resource_type='course_version' AND resource_id=$2 AND event_type=ANY($3::text[])
     AND jsonb_typeof(details->'before')='object' AND jsonb_typeof(details->'after')='object' AND jsonb_typeof(details->'nextRevision')='number'
     AND ($4::numeric IS NULL OR (details->>'nextRevision')::numeric<$4) ORDER BY (details->>'nextRevision')::numeric DESC,audit_event_id LIMIT 51`,[tenant.organizationId,courseVersionId,events,beforeRevision??null])).rows;
    const items=rows.slice(0,50).map(row=>({eventId:row.audit_event_id,eventType:row.event_type,actorId:row.actor_id,createdAt:new Date(row.created_at).toISOString(),revision:row.revision,nextRevision:row.next_revision}));
    return {items,...(rows.length>50?{nextBeforeRevision:items[49]!.nextRevision}:{})};
   });
  },
  async restoreDraftHistory({tenant,courseVersionId,revision,eventId,side,reason,idempotencyKey}){
   if(!tenant.actorId||![courseVersionId,eventId,idempotencyKey].every(identifier)||!Number.isSafeInteger(revision)||revision<1||!['before','after'].includes(side)||typeof reason!=='string'||!reason.trim()||reason.length>2000)throw Error('COURSE_DRAFT_INVALID');
   return withTenantTransaction(pool,tenant,async client=>{
    const receipt='draft-restore:'+createHash('sha256').update(JSON.stringify([tenant.organizationId,tenant.actorId,idempotencyKey])).digest('hex');
    const signature=JSON.stringify([courseVersionId,revision,eventId,side,reason]);
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[receipt]);
    const prior=(await client.query('SELECT details FROM audit_events WHERE organization_id=$1 AND audit_event_id=$2',[tenant.organizationId,receipt])).rows[0];
    if(prior){if(prior.details.signature!==signature)throw Error('IDEMPOTENCY_KEY_REUSED');return prior.details.result;}
    const course=(await client.query('SELECT revision,status,content FROM course_versions WHERE organization_id=$1 AND course_version_id=$2 FOR UPDATE',[tenant.organizationId,courseVersionId])).rows[0];
    if(!course)throw Error('COURSE_VERSION_NOT_FOUND');
    if(!['DRAFT','IN_REVIEW'].includes(course.status))throw Error('COURSE_VERSION_IMMUTABLE');
    if(course.revision!==revision)throw Error('COURSE_VERSION_STALE');
    const event=(await client.query(`SELECT details FROM audit_events WHERE organization_id=$1 AND resource_type='course_version' AND resource_id=$2 AND audit_event_id=$3 AND event_type=ANY($4::text[])`,[tenant.organizationId,courseVersionId,eventId,events])).rows[0];
    const snapshot=event?.details?.[side];if(!object(snapshot))throw Error('DRAFT_HISTORY_NOT_FOUND');
    const { _lineage:ignoredLineage,...editable}=snapshot;
    const content={...editable,...(course.content._lineage?{_lineage:course.content._lineage}:{})};
    const result={revision:revision+1};
    await client.query(`UPDATE course_versions SET content=$3::jsonb,revision=revision+1,status='DRAFT',updated_at=now() WHERE organization_id=$1 AND course_version_id=$2`,[tenant.organizationId,courseVersionId,JSON.stringify(content)]);
    await client.query(`INSERT INTO audit_events(audit_event_id,organization_id,actor_id,event_type,resource_type,resource_id,details,created_at) VALUES($1,$2,$3,'COURSE_DRAFT_RESTORED','course_version',$4,$5::jsonb,now())`,[receipt,tenant.organizationId,tenant.actorId,courseVersionId,JSON.stringify({signature,result,eventId,side,reason:reason.trim(),revision,nextRevision:result.revision,before:course.content,after:content})]);
    return result;
   });
  }
 };
}
