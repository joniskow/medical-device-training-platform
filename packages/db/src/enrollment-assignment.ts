import {createHash,randomUUID} from "node:crypto";
import type {PoolClient} from "pg";
import type {TenantContext} from "@medical-device/contracts";

export async function assignEnrollmentInTransaction(client:PoolClient,tenant:TenantContext,learnerId:string,releaseId:string){
        const release = await client.query(`SELECT course_version_id FROM release_manifests WHERE organization_id=$1 AND release_id=$2 AND status='PUBLISHED' FOR SHARE`, [tenant.organizationId,releaseId]);
        if (!release.rows[0]) throw new Error("ENROLLMENT_NOT_FOUND");
        const member = await client.query(`SELECT membership_id FROM organization_memberships WHERE organization_id=$1 AND subject=$2 AND status='ACTIVE'`,[tenant.organizationId,learnerId]);
        if (!member.rowCount) throw new Error("ENROLLMENT_MEMBER_REQUIRED");
        const versionId = release.rows[0].course_version_id;
        const digest = createHash("sha256").update(JSON.stringify([tenant.organizationId,learnerId,versionId])).digest("hex");
        // Serialize assignments for this learner/version, including retries and existing legacy enrollments.
        await client.query(`SELECT pg_advisory_xact_lock(hashtextextended(jsonb_build_array($1::text,$2::text,$3::text)::text,0))`,[tenant.organizationId,learnerId,versionId]);
        const prior = await client.query(`SELECT enrollment_id,status FROM enrollments WHERE organization_id=$1 AND learner_id=$2 AND course_version_id=$3 ORDER BY created_at,enrollment_id FOR UPDATE`,[tenant.organizationId,learnerId,versionId]);
        if (prior.rows.length) {
          const active = prior.rows.find(row => row.status === "ACTIVE");
          if (!active) throw new Error("ENROLLMENT_INACTIVE");
          return { enrollmentId: active.enrollment_id, releaseId, learnerId, status: active.status };
        }
        const enrollmentId = `enrollment:${digest}`;
        await client.query(`INSERT INTO enrollments(enrollment_id,organization_id,learner_id,course_version_id,status,created_at,updated_at) VALUES($1,$2,$3,$4,'ACTIVE',now(),now())`,[enrollmentId,tenant.organizationId,learnerId,versionId]);
        await client.query(`INSERT INTO audit_events(audit_event_id,organization_id,actor_id,event_type,resource_type,resource_id,details,created_at) VALUES($1,$2,$3,'ENROLLMENT_ASSIGNED','enrollment',$4,$5::jsonb,now())`,[randomUUID(),tenant.organizationId,tenant.actorId,enrollmentId,JSON.stringify({learnerId,releaseId,courseVersionId:versionId})]);
        return { enrollmentId, releaseId, learnerId, status: "ACTIVE" };
}
