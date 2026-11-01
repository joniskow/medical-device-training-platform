import { createHash,randomBytes,randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { TenantContext } from "@medical-device/contracts";
import { withTenantTransaction } from "./tenant-transaction.js";
import { enrollmentEligibility } from "./certification-eligibility.js";
import {prepareCredentialSupersession,applyCredentialSupersession} from './credential-supersession.js';
import {revokeDependentCredentials} from './credential-dependencies.js';

export interface CredentialService {
  issue(tenant:TenantContext,enrollmentId:string):Promise<unknown>;
  list(tenant:TenantContext,after?:string,learnerId?:string):Promise<unknown>;
  changeStatus(tenant:TenantContext,credentialId:string,request:{action:"revoke"|"supersede";reason:string;replacementId?:string;idempotencyKey:string}):Promise<unknown>;
  setSharing(tenant:TenantContext,credentialId:string,request:{enabled:boolean;revision:number;idempotencyKey:string}):Promise<unknown>;
}
const identifier=(value:unknown)=>typeof value==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(value);
function projection(row:Record<string,any>) {
  return {credentialId:row.credential_id,publicId:row.public_id,issuerId:row.organization_id,courseVersionId:row.course_version_id,
    releaseId:row.release_id,policyVersion:row.policy_version,title:row.evidence?.title??'Training credential',
    status:row.status==='ACTIVE'&&row.expired?'EXPIRED':row.status,
    supersededBy:row.superseded_by??null,
    verificationAllowed:row.evidence?.policy?.publicVerification?.enabled===true,
    verificationEnabled:row.evidence?.policy?.publicVerification?.enabled===true&&row.sharing_enabled===true,
    sharingRevision:row.sharing_revision??0,
    issuedAt:new Date(row.issued_at).toISOString(),expiresAt:row.expires_at?new Date(row.expires_at).toISOString():null,
    intendedUse:'Organization-issued product-training credential. Not professional licensure, accreditation, or regulatory approval.'};
}
export async function issueCredentialInTransaction(client:PoolClient,tenant:TenantContext,enrollmentId:string,automatic=false) {
        const bound=await client.query(`SELECT r.release_id,r.release_hash,r.course_version_id,r.manifest,v.course_id FROM enrollments e JOIN release_manifests r ON r.organization_id=e.organization_id AND r.course_version_id=e.course_version_id JOIN course_versions v ON v.organization_id=r.organization_id AND v.course_version_id=r.course_version_id
          WHERE e.organization_id=$1 AND e.enrollment_id=$2 AND e.learner_id=$3 AND e.status='ACTIVE' AND r.status='PUBLISHED' FOR UPDATE OF e FOR SHARE OF r`,[tenant.organizationId,enrollmentId,tenant.actorId]);
        const release=bound.rows[0];if(!release)throw new Error('CREDENTIAL_NOT_FOUND');
        const policy=release.manifest?.content?.policy;
        if(automatic && policy?.schemaVersion!=='certification-policy.v1')return null;
        const qualificationId='initial';
        // Serialize qualification across course versions so delayed historical issuance cannot race supersession.
        await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`,[JSON.stringify(['course-credential',tenant.organizationId,tenant.actorId,release.course_id])]);
        // Serialize duplicate enrollments for the same learner/release as well as same-enrollment retries.
        await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`,[JSON.stringify([tenant.organizationId,tenant.actorId,release.release_id,policy?.version,qualificationId])]);
        const prior=await client.query(`SELECT *,expires_at<=now() AS expired FROM credentials WHERE organization_id=$1 AND learner_id=$2 AND release_id=$3 AND policy_version=$4 AND qualification_id=$5`,[tenant.organizationId,tenant.actorId,release.release_id,policy?.version??null,qualificationId]);
        if(prior.rows[0])return projection(prior.rows[0]);
        const successor=await client.query(`SELECT credential_id FROM credentials WHERE organization_id=$1 AND learner_id=$2 AND evidence->'supersession'->>'sourceReleaseId'=$3 LIMIT 1`,[tenant.organizationId,tenant.actorId,release.release_id]);
        if(successor.rowCount){if(automatic)return null;throw Error('CREDENTIAL_RELEASE_SUPERSEDED');}
        await client.query(`SELECT session_id FROM assessment_sessions WHERE organization_id=$1 AND enrollment_id=$2 AND learner_id=$3 AND release_id=$4 FOR SHARE`,[tenant.organizationId,enrollmentId,tenant.actorId,release.release_id]);
        await client.query(`SELECT simulation_attempt_id FROM simulation_attempts WHERE organization_id=$1 AND enrollment_id=$2 AND learner_id=$3 AND release_id=$4 FOR SHARE`,[tenant.organizationId,enrollmentId,tenant.actorId,release.release_id]);
        const eligibility=await enrollmentEligibility(client,tenant,enrollmentId,release.release_id,release.release_hash,release.manifest.content??{});
        if(!eligibility.eligible){if(automatic)return null;throw new Error('CREDENTIAL_REQUIREMENTS_NOT_MET');}
        if(!(await client.query('SELECT public.has_verified_account($1) AS verified',[tenant.actorId])).rows[0].verified){if(automatic)return null;throw Error('CREDENTIAL_EMAIL_VERIFICATION_REQUIRED');}
        const supersession=await prepareCredentialSupersession(client,tenant,release);
        if(supersession?.deferred){
          if(!automatic)throw Error('CREDENTIAL_CHANGE_NOT_EFFECTIVE');
          const key=`credential.qualify:${enrollmentId}:${release.release_id}`;
          // Existing events need no update: avoid taking their row lock while holding enrollment locks.
          const queued=await client.query(`SELECT 1 FROM outbox_events WHERE organization_id=$1 AND deduplication_key=$2`,[tenant.organizationId,key]);
          if(!queued.rowCount)await client.query(`INSERT INTO outbox_events(outbox_event_id,organization_id,event_type,deduplication_key,payload,state,available_at,created_at,updated_at)
            VALUES($1,$2,'credential.qualify',$3,$4::jsonb,'PENDING',$5,now(),now())`,[randomUUID(),tenant.organizationId,key,JSON.stringify({enrollmentId,learnerId:tenant.actorId,releaseId:release.release_id,releaseHash:release.release_hash}),release.manifest.content.releaseChange.effectiveAt]);
          return null;
        }
        const credentialId=`credential:${randomUUID()}`,publicId=randomBytes(32).toString('base64url');
        const evidence={schemaVersion:'credential-evidence.v1',enrollmentId,qualificationId,title:release.manifest.content.title,releaseHash:release.release_hash,policy,
          product:release.manifest.content.product??null,reviewDecisions:release.manifest.reviewDecisions??[],evaluation:eligibility,
          ...(supersession&&release.manifest.content.releaseChange.decision==='supersede_on_completion'?{supersession:{sourceReleaseId:supersession.sourceReleaseId,sourceReleaseHash:supersession.sourceReleaseHash,previousCredentialIds:supersession.credentials.map(c=>c.credential_id),decision:release.manifest.content.releaseChange}}:{})};
        const sharingEnabled=(await client.query('SELECT public.default_credential_sharing($1,$2) AS enabled',[tenant.actorId,enrollmentId])).rows[0].enabled;
        const inserted=await client.query(`INSERT INTO credentials(credential_id,organization_id,learner_id,course_version_id,public_id,status,issued_at,expires_at,created_at,updated_at,release_id,release_hash,policy_id,policy_version,qualification_id,public_id_hash,evidence,sharing_enabled)
          VALUES($1,$2,$3,$4,$5,'ACTIVE',now(),CASE WHEN $6::integer IS NULL THEN NULL ELSE now()+$6*interval '1 day' END,now(),now(),$7,$8,$9,$10,$11,$12,$13::jsonb,$14) RETURNING *,false AS expired`,
          [credentialId,tenant.organizationId,tenant.actorId,release.course_version_id,publicId,policy.expirationDays,release.release_id,release.release_hash,policy.policyId,policy.version,qualificationId,createHash('sha256').update(publicId).digest('hex'),JSON.stringify(evidence),sharingEnabled]);
        await client.query(`INSERT INTO credential_events(credential_event_id,organization_id,credential_id,event_type,details,created_at) VALUES($1,$2,$3,'ISSUED',$4::jsonb,now())`,[`credential-event:${randomUUID()}`,tenant.organizationId,credentialId,JSON.stringify({releaseId:release.release_id,releaseHash:release.release_hash,evidenceIds:eligibility.evidenceIds})]);
        if(policy.publicVerification?.enabled===true){
          await client.query(`INSERT INTO credential_verifications(public_id_hash,public_fields,status,issued_at,expires_at,sharing_enabled) VALUES($1,$2::jsonb,'ACTIVE',$3,$4,$5)`,[inserted.rows[0].public_id_hash,JSON.stringify({issuerName:policy.publicVerification.issuerName.trim(),courseTitle:policy.publicVerification.courseTitle.trim()}),inserted.rows[0].issued_at,inserted.rows[0].expires_at,sharingEnabled]);
        }
        await client.query(`INSERT INTO audit_events(audit_event_id,organization_id,actor_id,event_type,resource_type,resource_id,details,created_at) VALUES($1,$2,$3,'CREDENTIAL_ISSUED','credential',$4,$5::jsonb,now())`,[`audit:${randomUUID()}`,tenant.organizationId,tenant.actorId,credentialId,JSON.stringify({releaseId:release.release_id,enrollmentId,policyVersion:policy.version})]);
        await client.query(`INSERT INTO outbox_events(outbox_event_id,organization_id,event_type,deduplication_key,payload,state,available_at,created_at,updated_at)
          VALUES($1,$2,'credential.issued',$3,$4::jsonb,'PENDING',now(),now(),now())`,[`outbox:${randomUUID()}`,tenant.organizationId,`credential.issued:${credentialId}`,JSON.stringify({credentialId,learnerId:tenant.actorId,releaseId:release.release_id,notificationRequested:true})]);
        if(inserted.rows[0].expires_at)await client.query(`INSERT INTO outbox_events(outbox_event_id,organization_id,event_type,deduplication_key,payload,state,available_at,created_at,updated_at)
          SELECT $1,$2,'credential.expire',$1,$3::jsonb,'PENDING',expires_at,now(),now() FROM credentials WHERE organization_id=$2 AND credential_id=$4`,['expiration:'+credentialId,tenant.organizationId,JSON.stringify({credentialId,learnerId:tenant.actorId}),credentialId]);
        if(supersession)await applyCredentialSupersession(client,tenant,credentialId,release.release_id,supersession);
        return projection(inserted.rows[0]);
}

export function createPostgresCredentialService(pool:Pool):CredentialService {
  return {
    async setSharing(tenant,credentialId,request){
      if(!tenant.actorId||!identifier(credentialId)||!identifier(request.idempotencyKey)||typeof request.enabled!=='boolean'||!Number.isSafeInteger(request.revision)||request.revision<0)throw new Error('CREDENTIAL_REQUEST_INVALID');
      return withTenantTransaction(pool,tenant,async client=>{
        const hash=createHash('sha256').update(JSON.stringify(['sharing',tenant.actorId,credentialId,request.enabled,request.revision])).digest('hex');
        await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`,[JSON.stringify([tenant.organizationId,request.idempotencyKey])]);
        const prior=await client.query(`SELECT request_hash FROM credential_events WHERE organization_id=$1 AND idempotency_key=$2`,[tenant.organizationId,request.idempotencyKey]);
        if(prior.rows[0]&&prior.rows[0].request_hash!==hash)throw new Error('IDEMPOTENCY_KEY_REUSED');
        const found=await client.query(`SELECT *,expires_at<=now() AS expired FROM credentials WHERE organization_id=$1 AND learner_id=$2 AND credential_id=$3 FOR UPDATE`,[tenant.organizationId,tenant.actorId,credentialId]);
        const row=found.rows[0];if(!row)throw new Error('CREDENTIAL_NOT_FOUND');
        if(prior.rows[0])return projection(row);
        if(row.sharing_revision!==request.revision)throw new Error('CREDENTIAL_SHARING_CONFLICT');
        if(row.evidence?.policy?.publicVerification?.enabled!==true)throw new Error('CREDENTIAL_SHARING_NOT_ALLOWED');
        const changed=await client.query(`UPDATE credentials SET sharing_enabled=$3,sharing_revision=sharing_revision+1,updated_at=now() WHERE organization_id=$1 AND credential_id=$2 RETURNING *,expires_at<=now() AS expired`,[tenant.organizationId,credentialId,request.enabled]);
        await client.query(`UPDATE credential_verifications SET sharing_enabled=$2 WHERE public_id_hash=$1`,[row.public_id_hash,request.enabled]);
        const details=JSON.stringify({enabled:request.enabled,revision:changed.rows[0].sharing_revision,actorId:tenant.actorId});
        await client.query(`INSERT INTO credential_events(credential_event_id,organization_id,credential_id,event_type,details,created_at,idempotency_key,request_hash) VALUES($1,$2,$3,'SHARING_CHANGED',$4::jsonb,now(),$5,$6)`,[`credential-event:${randomUUID()}`,tenant.organizationId,credentialId,details,request.idempotencyKey,hash]);
        await client.query(`INSERT INTO audit_events(audit_event_id,organization_id,actor_id,event_type,resource_type,resource_id,details,created_at) VALUES($1,$2,$3,'CREDENTIAL_SHARING_CHANGED','credential',$4,$5::jsonb,now())`,[`audit:${randomUUID()}`,tenant.organizationId,tenant.actorId,credentialId,details]);
        return projection(changed.rows[0]);
      });
    },
    async issue(tenant,enrollmentId) {
      if(!tenant.actorId||!identifier(enrollmentId))throw new Error('CREDENTIAL_REQUEST_INVALID');
      return withTenantTransaction(pool,tenant,async client=>{
        return issueCredentialInTransaction(client,tenant,enrollmentId);
      });
    },
    async changeStatus(tenant,credentialId,request){
      if(!tenant.actorId||!identifier(credentialId)||!identifier(request.idempotencyKey)||!['revoke','supersede'].includes(request.action)
        ||typeof request.reason!=='string'||!request.reason.trim()||request.reason.trim().length>2000
        ||(request.action==='supersede'&&(!identifier(request.replacementId)||request.replacementId===credentialId))
        ||(request.action==='revoke'&&request.replacementId!==undefined))throw new Error('CREDENTIAL_REQUEST_INVALID');
      return withTenantTransaction(pool,tenant,async client=>{
        const reason=request.reason.trim();
        const requestHash=createHash('sha256').update(JSON.stringify([tenant.actorId,credentialId,request.action,reason,request.replacementId??null])).digest('hex');
        await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`,[JSON.stringify([tenant.organizationId,request.idempotencyKey])]);
        const prior=await client.query(`SELECT request_hash FROM credential_events WHERE organization_id=$1 AND idempotency_key=$2`,[tenant.organizationId,request.idempotencyKey]);
        if(prior.rows[0]&&prior.rows[0].request_hash!==requestHash)throw new Error('IDEMPOTENCY_KEY_REUSED');
        const scope=(await client.query(`SELECT c.learner_id,v.course_id FROM credentials c JOIN course_versions v ON v.organization_id=c.organization_id AND v.course_version_id=c.course_version_id WHERE c.organization_id=$1 AND c.credential_id=$2`,[tenant.organizationId,credentialId])).rows[0];
        if(!scope)throw Error('CREDENTIAL_NOT_FOUND');
        await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`,[JSON.stringify(['course-credential',tenant.organizationId,scope.learner_id,scope.course_id])]);
        const rows=await client.query(`SELECT c.*,v.course_id,v.revision AS course_revision,c.expires_at<=now() AS expired FROM credentials c JOIN course_versions v ON v.organization_id=c.organization_id AND v.course_version_id=c.course_version_id
          WHERE c.organization_id=$1 AND c.credential_id=ANY($2::text[]) ORDER BY c.credential_id FOR UPDATE OF c`,[tenant.organizationId,[credentialId,...(request.replacementId?[request.replacementId]:[])]]);
        const credential=rows.rows.find(row=>row.credential_id===credentialId);if(!credential)throw new Error('CREDENTIAL_NOT_FOUND');
        if(prior.rows[0])return projection(credential);
        if(credential.status==='REVOKED')throw new Error('CREDENTIAL_ALREADY_REVOKED');
        if(request.action==='supersede'){
          if(credential.status==='SUPERSEDED')throw new Error('CREDENTIAL_ALREADY_SUPERSEDED');
          const replacement=rows.rows.find(row=>row.credential_id===request.replacementId);
          if(!replacement||replacement.learner_id!==credential.learner_id||replacement.course_id!==credential.course_id
            ||replacement.course_version_id===credential.course_version_id||replacement.status!=='ACTIVE'||replacement.expired
            ||replacement.course_revision<=credential.course_revision
            ||!replacement.release_id||!replacement.evidence?.evaluation?.eligible
            ||new Date(replacement.issued_at).getTime()<new Date(credential.issued_at).getTime())throw new Error('CREDENTIAL_REPLACEMENT_INVALID');
        }
        const status=request.action==='revoke'?'REVOKED':'SUPERSEDED';
        const changed=await client.query(`UPDATE credentials SET status=$3,superseded_by=CASE WHEN $3='SUPERSEDED' THEN $4 ELSE superseded_by END,updated_at=now() WHERE organization_id=$1 AND credential_id=$2 RETURNING *,expires_at<=now() AS expired`,[tenant.organizationId,credentialId,status,request.replacementId??null]);
        const details=JSON.stringify({reason,previousStatus:credential.status,status,replacementId:request.replacementId??null,actorId:tenant.actorId});
        await client.query(`UPDATE credential_verifications SET status=$2 WHERE public_id_hash=$1`,[credential.public_id_hash,status]);
        await client.query(`INSERT INTO credential_events(credential_event_id,organization_id,credential_id,event_type,details,created_at,idempotency_key,request_hash) VALUES($1,$2,$3,$4,$5::jsonb,now(),$6,$7)`,[`credential-event:${randomUUID()}`,tenant.organizationId,credentialId,status,details,request.idempotencyKey,requestHash]);
        await client.query(`INSERT INTO audit_events(audit_event_id,organization_id,actor_id,event_type,resource_type,resource_id,details,created_at) VALUES($1,$2,$3,$4,'credential',$5,$6::jsonb,now())`,[`audit:${randomUUID()}`,tenant.organizationId,tenant.actorId,`CREDENTIAL_${status}`,credentialId,details]);
        await client.query(`INSERT INTO outbox_events(outbox_event_id,organization_id,event_type,deduplication_key,payload,state,available_at,created_at,updated_at) VALUES($1,$2,$3,$4,$5::jsonb,'PENDING',now(),now(),now())`,[`outbox:${randomUUID()}`,tenant.organizationId,`credential.${request.action==='revoke'?'revoked':'superseded'}`,`credential.${status}:${credentialId}`,JSON.stringify({credentialId,learnerId:credential.learner_id,status,replacementId:request.replacementId??null,notificationRequested:true})]);
        if(request.action==='revoke')await revokeDependentCredentials(client,tenant,credential.learner_id,credentialId,reason);
        return projection(changed.rows[0]);
      });
    },
    async list(tenant,after,learnerId){
      if(!tenant.actorId||(after!==undefined&&!identifier(after))||(learnerId!==undefined&&(!learnerId.trim()||learnerId.length>256)))throw new Error('CREDENTIAL_REQUEST_INVALID');
      return withTenantTransaction(pool,tenant,async client=>{
        const result=await client.query(`SELECT c.*,v.course_id,c.expires_at<=now() AS expired FROM credentials c JOIN course_versions v ON v.organization_id=c.organization_id AND v.course_version_id=c.course_version_id WHERE c.organization_id=$1 AND c.learner_id=$2 AND ($3::text IS NULL OR c.credential_id>$3) ORDER BY c.credential_id LIMIT 51`,[tenant.organizationId,learnerId??tenant.actorId,after??null]);
        const rows=result.rows.slice(0,50);return {items:rows.map(row=>({...projection(row),courseId:row.course_id})),nextCursor:result.rows.length>50?rows[49].credential_id:null};
      });
    }
  };
}
