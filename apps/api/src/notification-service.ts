import type { Pool } from 'pg';
import type { TenantContext } from '@medical-device/contracts';
import { withTenantTransaction } from '@medical-device/db';
export function createNotificationService(pool:Pool){return {
  async list(tenant:TenantContext,after?:string){
    if(!tenant.actorId||(after!==undefined&&!/^[A-Za-z0-9._:-]{1,128}$/.test(after)))throw Error('NOTIFICATION_REQUEST_INVALID');
    return withTenantTransaction(pool,tenant,async client=>{
      const rows=(await client.query(`SELECT n.notification_id,n.notification_type,n.payload,n.created_at,n.read_at,
        CASE WHEN c.status='ACTIVE' AND c.expires_at<=now() THEN 'EXPIRED' ELSE c.status END AS credential_status
        FROM notifications n LEFT JOIN credentials c ON n.notification_type='CREDENTIAL_LIFECYCLE' AND c.organization_id=n.organization_id AND c.learner_id=n.recipient_id AND c.credential_id=n.payload->>'credentialId'
        WHERE n.organization_id=$1 AND n.recipient_id=$2 AND n.notification_type IN ('COURSE_CHANGE','COURSE_RETRAINING_ASSIGNMENT','CREDENTIAL_LIFECYCLE') AND ($3::text IS NULL OR n.notification_id>$3) ORDER BY n.notification_id LIMIT 51`,[tenant.organizationId,tenant.actorId,after??null])).rows;
      return {items:rows.slice(0,50).map(row=>({notificationId:row.notification_id,title:row.payload.title,message:row.payload.message,
        ...(row.notification_type==='CREDENTIAL_LIFECYCLE'?{kind:'credential',lifecycleEvent:row.payload.lifecycleEvent,occurredAt:row.payload.occurredAt,currentStatus:row.credential_status??'UNAVAILABLE'}:
          {releaseNotes:row.payload.releaseNotes,effectiveAt:row.payload.effectiveAt,decision:row.payload.decision,...(typeof row.payload.enrollmentId==='string'?{enrollmentId:row.payload.enrollmentId}:{})}),
        createdAt:new Date(row.created_at).toISOString(),read:row.read_at!==null})),nextCursor:rows.length>50?rows[49].notification_id:null};
    });
  },
  async markRead(tenant:TenantContext,id:string){return withTenantTransaction(pool,tenant,async client=>{
    const row=await client.query(`UPDATE notifications SET read_at=COALESCE(read_at,now()) WHERE organization_id=$1 AND recipient_id=$2 AND notification_id=$3 RETURNING notification_id`,[tenant.organizationId,tenant.actorId,id]);
    if(!row.rowCount)throw Error('NOTIFICATION_NOT_FOUND');return {notificationId:id,read:true};
  });}
};}
