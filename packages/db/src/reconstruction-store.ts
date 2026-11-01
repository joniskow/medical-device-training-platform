import {createHash,randomUUID} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import type {ReconstructionPayload,ReconstructionRequestInput,ReconstructionSource,ReconstructionSourceReference,TenantContext} from '@medical-device/contracts';
import {withTenantTransaction} from './tenant-transaction.js';
import {createPostgresJobStore,enqueuePostgresJob} from './job-store.js';

const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function validateReconstructionInput(input:ReconstructionRequestInput){
  if(!input||!['single-image','multi-view','video'].includes(input.mode)||!Array.isArray(input.sources)||
    input.sources.length<(input.mode==='multi-view'?20:1)||input.sources.length>(input.mode==='multi-view'?100:1)||
    typeof input.idempotencyKey!=='string'||!input.idempotencyKey.trim()||input.idempotencyKey.length>200||
    input.sources.some(source=>!source||Object.keys(source).some(key=>!['assetVersionId','sourceHash'].includes(key))||typeof source.assetVersionId!=='string'||!source.assetVersionId||source.assetVersionId.length>300||typeof source.sourceHash!=='string'||!/^[a-f0-9]{64}$/.test(source.sourceHash))||
    new Set(input.sources.map(source=>source.assetVersionId)).size!==input.sources.length||new Set(input.sources.map(source=>source.sourceHash)).size!==input.sources.length)throw Error('RECONSTRUCTION_REQUEST_INVALID');
}

async function sourcesInTransaction(client:PoolClient,tenant:TenantContext,references:ReconstructionSourceReference[]):Promise<ReconstructionSource[]>{
  const rows=(await client.query(`SELECT v.*,a.status AS asset_status FROM asset_versions v JOIN assets a ON a.asset_id=v.asset_id AND a.organization_id=v.organization_id
    WHERE v.organization_id=$1 AND v.asset_version_id=ANY($2::text[]) ORDER BY v.asset_version_id FOR SHARE OF v,a`,[tenant.organizationId,references.map(source=>source.assetVersionId)])).rows;
  if(rows.length!==references.length||new Set(rows.map(row=>row.product_id).filter(Boolean)).size>1)throw Error('RECONSTRUCTION_SOURCE_UNAVAILABLE');
  const result=new Map<string,ReconstructionSource>();
  for(const row of rows){
    const reference=references.find(source=>source.assetVersionId===row.asset_version_id)!;
    if(row.state!=='APPROVED'||['QUARANTINED','REJECTED','RETIRED','SUSPENDED'].includes(row.asset_status)||row.sha256!==reference.sourceHash||!row.blob_key.startsWith(tenant.organizationId+'/')||!['image','video'].includes(row.source_type))throw Error('RECONSTRUCTION_SOURCE_UNAVAILABLE');
    const review=(await client.query(`SELECT audit_event_id,details FROM audit_events WHERE organization_id=$1 AND resource_id=$2 AND event_type='SOURCE_REVIEW_DECISION' ORDER BY created_at DESC,audit_event_id DESC LIMIT 1`,[tenant.organizationId,row.asset_version_id])).rows[0];
    const rights=(await client.query(`SELECT attestation_id FROM asset_rights_attestations WHERE organization_id=$1 AND asset_version_id=$2 AND status='ACTIVE' AND derivative_allowed=true ORDER BY created_at DESC,attestation_id DESC LIMIT 1 FOR SHARE`,[tenant.organizationId,row.asset_version_id])).rows[0];
    if(!review||review.details.decision!=='APPROVE'||review.details.sourceHash!==row.sha256||!rights)throw Error('RECONSTRUCTION_SOURCE_UNAVAILABLE');
    const size=Number(row.size_bytes),limit=row.source_type==='video'?128:25;
    if(!Number.isSafeInteger(size)||size<1||size>limit*1024*1024||!(row.source_type==='video'?['video/mp4','video/webm']:['image/png','image/jpeg','image/webp']).includes(row.content_type))throw Error('RECONSTRUCTION_SOURCE_UNSUPPORTED');
    result.set(row.asset_version_id,{assetVersionId:row.asset_version_id,sourceHash:row.sha256,blobKey:row.blob_key,fileName:row.file_name,sourceType:row.source_type,contentType:row.content_type,sizeBytes:size,reviewEventId:review.audit_event_id,rightsAttestationId:rights.attestation_id});
  }
  return references.map(reference=>result.get(reference.assetVersionId)!);
}

export function createReconstructionStore(pool:Pool){
  const jobs=createPostgresJobStore(pool);
  return {
    async availableSources(tenant:TenantContext,after=''){
      return withTenantTransaction(pool,tenant,async client=>{
        const rows=(await client.query(`SELECT v.asset_version_id AS "assetVersionId",v.sha256 AS "sourceHash",v.file_name AS "fileName",v.source_type AS "sourceType",v.size_bytes::float8 AS "sizeBytes"
          FROM asset_versions v JOIN assets a ON a.asset_id=v.asset_id AND a.organization_id=v.organization_id
          WHERE v.organization_id=$1 AND v.asset_version_id>$2 AND v.source_type IN ('image','video') AND v.state='APPROVED' AND a.status NOT IN ('QUARANTINED','REJECTED','RETIRED','SUSPENDED')
          AND EXISTS(SELECT 1 FROM asset_rights_attestations r WHERE r.organization_id=v.organization_id AND r.asset_version_id=v.asset_version_id AND r.status='ACTIVE' AND r.derivative_allowed=true)
          AND EXISTS(SELECT 1 FROM audit_events e WHERE e.organization_id=v.organization_id AND e.resource_id=v.asset_version_id AND e.event_type='SOURCE_REVIEW_DECISION' AND e.details->>'decision'='APPROVE' AND e.details->>'sourceHash'=v.sha256)
          ORDER BY v.asset_version_id LIMIT 21`,[tenant.organizationId,after])).rows;
        return {items:rows.slice(0,20),...(rows.length>20?{nextCursor:rows[19].assetVersionId}:{})};
      });
    },
    async create(tenant:TenantContext,input:ReconstructionRequestInput){
      validateReconstructionInput(input);
      if(!tenant.actorId)throw Error('RECONSTRUCTION_REQUEST_INVALID');
      const key='reconstruction:'+digest([tenant.organizationId,tenant.actorId,input.idempotencyKey]);
      const signature=digest([tenant.actorId,input.mode,input.sources]);
      return withTenantTransaction(pool,tenant,async client=>{
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[tenant.organizationId+':reconstruction']);
        const prior=(await client.query(`SELECT payload,request_hash FROM processing_jobs WHERE organization_id=$1 AND idempotency_key=$2 AND job_type='reconstruction.generate'`,[tenant.organizationId,key])).rows[0];
        if(prior&&prior.request_hash!==signature)throw Error('IDEMPOTENCY_KEY_REUSED');
        let payload:ReconstructionPayload=prior?.payload;
        if(!prior){
          const active=(await client.query(`SELECT count(*)::int AS count FROM processing_jobs WHERE organization_id=$1 AND job_type='reconstruction.generate' AND state IN ('QUEUED','RUNNING','RETRY_SCHEDULED')`,[tenant.organizationId])).rows[0].count;
          if(active>=2)throw Error('RECONSTRUCTION_LIMIT_REACHED');
          const sources=await sourcesInTransaction(client,tenant,input.sources);
          if(sources.some(source=>source.sourceType!==(input.mode==='video'?'video':'image'))||sources.reduce((sum,source)=>sum+source.sizeBytes,0)>1024*1024*1024)throw Error('RECONSTRUCTION_SOURCE_UNSUPPORTED');
          payload={schemaVersion:'reconstruction-request.v1',mode:input.mode,sources,requestedBy:tenant.actorId!,requestSignature:signature};
        }
        const job=await enqueuePostgresJob(client,{jobId:'job_reconstruct_'+digest(key),jobType:'reconstruction.generate',attempt:1,maxAttempts:2,
          idempotency:{key,requestHash:signature},tenant,payload,timeoutSeconds:3600,codeVersion:'reconstruction-workflow.v1'});
        if(!prior)await client.query(`INSERT INTO audit_events(audit_event_id,organization_id,actor_id,event_type,resource_type,resource_id,details,created_at)
          VALUES($1,$2,$3,'RECONSTRUCTION_REQUESTED','processing_job',$4,$5::jsonb,now())`,['audit:'+randomUUID(),tenant.organizationId,tenant.actorId,job.jobId,JSON.stringify({mode:input.mode,sources:input.sources,signature})]);
        return job;
      });
    },
    async get(tenant:TenantContext,id:string){const job=await jobs.get<ReconstructionPayload>(tenant,id);return job?.jobType==='reconstruction.generate'&&job.payload.schemaVersion==='reconstruction-request.v1'?job:null;},
    async list(tenant:TenantContext,after=''){
      return withTenantTransaction(pool,tenant,async client=>{
        const rows=(await client.query(`SELECT job_id AS "jobId",state,created_at AS "createdAt",payload->>'mode' AS mode FROM processing_jobs
          WHERE organization_id=$1 AND job_type='reconstruction.generate' AND job_id>$2 ORDER BY job_id LIMIT 21`,[tenant.organizationId,after])).rows;
        return {items:rows.slice(0,20),...(rows.length>20?{nextCursor:rows[19].jobId}:{})};
      });
    },
    async assertSourcesCurrent(tenant:TenantContext,payload:ReconstructionPayload){
      validateReconstructionInput({mode:payload.mode,sources:payload.sources.map(({assetVersionId,sourceHash})=>({assetVersionId,sourceHash})),idempotencyKey:'worker'});
      await withTenantTransaction(pool,tenant,async client=>{
        const current=await sourcesInTransaction(client,tenant,payload.sources);
        const snapshot=(source:ReconstructionSource)=>[source.assetVersionId,source.sourceHash,source.blobKey,source.fileName,source.sourceType,source.contentType,source.sizeBytes,source.reviewEventId,source.rightsAttestationId];
        if(digest(current.map(snapshot))!==digest(payload.sources.map(snapshot)))throw Error('RECONSTRUCTION_SOURCE_CHANGED');
      });
    }
  };
}

/** Validates the candidate/report link against server records, not author assertions. */
export async function attestReconstructionPreparation(client:PoolClient,tenant:TenantContext,preparation:any){
  if(!preparation?.reconstructionJobId)return undefined;
  if(typeof preparation.reconstructionJobId!=='string'||!/^job_reconstruct_[a-f0-9]{64}$/.test(preparation.reconstructionJobId))throw Error('RECONSTRUCTION_LINEAGE_INVALID');
  const row=(await client.query(`SELECT payload,outcome,state FROM processing_jobs WHERE organization_id=$1 AND job_id=$2 AND job_type='reconstruction.generate' FOR SHARE`,[tenant.organizationId,preparation.reconstructionJobId])).rows[0];
  const artifacts=row?.outcome?.details?.artifacts;
  if(!row||row.state!=='SUCCEEDED'||row.outcome?.status!=='REVIEW_REQUIRED'||artifacts?.candidate?.sha256!==preparation.sourceHash||artifacts?.quality?.sha256!==preparation.qualityReportHash||
    JSON.stringify(row.outcome.details.sourceImageHashes)!==JSON.stringify(preparation.sourceImageHashes)||row.outcome.details.sourceVideoHash!==preparation.sourceVideoHash)throw Error('RECONSTRUCTION_LINEAGE_INVALID');
  const payload=row.payload as ReconstructionPayload;
  if(payload.mode==='single-image'&&(preparation.reconstruction?.method!=='single-image-generative-hypothesis'||preparation.reconstruction.hiddenGeometryVerified!==false||preparation.reconstruction.deviceDetailsVerified!==false||preparation.reconstruction.surfaceErrorMeasured!==false))throw Error('RECONSTRUCTION_LINEAGE_INVALID');
  const current=await sourcesInTransaction(client,tenant,payload.sources);
  if(digest(current.map(source=>[source.assetVersionId,source.sourceHash,source.reviewEventId,source.rightsAttestationId]))!==digest(payload.sources.map(source=>[source.assetVersionId,source.sourceHash,source.reviewEventId,source.rightsAttestationId])))throw Error('RECONSTRUCTION_SOURCE_CHANGED');
  return {jobId:preparation.reconstructionJobId,mode:payload.mode,requestSignature:payload.requestSignature,sources:payload.sources.map(({assetVersionId,sourceHash,reviewEventId,rightsAttestationId})=>({assetVersionId,sourceHash,reviewEventId,rightsAttestationId})),verifiedAtImport:true};
}
