import type {PoolClient} from 'pg';
import type {TenantContext} from '@medical-device/contracts';
import {validReleaseChange,validCertificationPolicy,type PolicyActivity} from '@medical-device/simulation-schema';

export async function moduleRequalification(client:PoolClient,tenant:TenantContext,releaseId:string,content:Record<string,any>,activities:PolicyActivity[]){
  const change=content.releaseChange,lineage=content._lineage;
  if(change?.decision!=='update_modules')return null;
  if(!validReleaseChange(change,content.modules??[])||!validCertificationPolicy(content.policy,activities)||!lineage?.sourceReleaseId||!lineage.sourceReleaseHash)throw Error('CREDENTIAL_CHANGE_INVALID');
  const source=(await client.query(`SELECT c.credential_id,c.evidence,c.release_id,c.release_hash FROM credentials c
    JOIN course_versions old ON old.organization_id=c.organization_id AND old.course_version_id=c.course_version_id
    JOIN course_versions current ON current.organization_id=old.organization_id AND current.course_id=old.course_id AND current.revision>old.revision
    JOIN release_manifests r ON r.organization_id=current.organization_id AND r.course_version_id=current.course_version_id
    WHERE c.organization_id=$1 AND c.learner_id=$2 AND c.release_id=$3 AND c.release_hash=$4 AND r.release_id=$5
      AND c.status='ACTIVE' AND (c.expires_at IS NULL OR c.expires_at>now()) AND c.evidence->'evaluation'->>'eligible'='true'
    ORDER BY c.issued_at DESC,c.credential_id LIMIT 1`,[tenant.organizationId,tenant.actorId,lineage.sourceReleaseId,lineage.sourceReleaseHash,releaseId])).rows[0];
  if(!source)return null;
  const selected=activities.filter(a=>change.updateModuleIds.includes(a.moduleId));
  const requiredEvidence=[...(selected.some(a=>a.kind==='assessment')?['assessment.passed']:[]),...(selected.some(a=>a.kind==='simulation')?['simulation.completed','simulation.equivalent-path']:[]),...(selected.some(a=>a.kind==='content')?['content.completed']:[])];
  const policy={...content.policy,requiredActivityIds:[],requiredModuleIds:change.updateModuleIds,requiredEvidence};
  if(!validCertificationPolicy(policy,activities)||!Array.isArray(source.evidence?.evaluation?.evidenceIds))throw Error('CREDENTIAL_CHANGE_INVALID');
  return {policy,sourceCredentialId:source.credential_id,sourceReleaseId:source.release_id,sourceReleaseHash:source.release_hash,
    sourceEvidenceIds:source.evidence.evaluation.evidenceIds as string[],
    sourceCredentialIds:[...new Set([source.credential_id,...(source.evidence?.evaluation?.requalification?.sourceCredentialIds??[])])] as string[],
    updateModuleIds:change.updateModuleIds,decision:change};
}
