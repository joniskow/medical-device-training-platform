import {createHash} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import type {TenantContext} from '@medical-device/contracts';
import {organizationRoleNames,withTenantTransaction} from '@medical-device/db';

const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const validKey=(value:string)=>/^[A-Za-z0-9._:-]{1,128}$/.test(value);
const normalizeEmail=(value:string)=>value.trim().toLowerCase();
const validEmail=(value:string)=>value.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
import type {InvitationKeys} from '@medical-device/db';
export type {InvitationKeys} from '@medical-device/db';
import {invitationDeliveryToken} from '@medical-device/db';
export {invitationDeliveryToken} from '@medical-device/db';
const projection=(row:Record<string,any>)=>({invitationId:row.invitation_id,intendedEmail:row.intended_email,role:row.role,inviterId:row.inviter_id,status:row.effective_status,emailStatus:row.email_status??null,expiresAt:row.expires_at,createdAt:row.created_at});
const columns=`invitation_id,intended_email,role,inviter_id,expires_at,created_at,CASE WHEN status='PENDING' AND expires_at<=clock_timestamp() THEN 'EXPIRED' ELSE status END AS effective_status,(SELECT COALESCE(provider_status,status) FROM email_deliveries d WHERE d.organization_id=organization_invitations.organization_id AND d.email_delivery_id='email:deliver:'||organization_invitations.invitation_id) AS email_status`;
async function authorize(client:PoolClient,tenant:TenantContext){
  const allowed=await client.query(`SELECT 1 FROM organization_memberships m JOIN role_assignments r ON r.organization_id=m.organization_id AND r.subject=m.subject JOIN organizations o ON o.organization_id=m.organization_id WHERE m.organization_id=$1 AND m.subject=$2 AND m.status='ACTIVE' AND o.status='ACTIVE' AND r.role='organization_admin' AND r.scope_type='organization' AND (r.scope_id IS NULL OR r.scope_id=$1)`,[tenant.organizationId,tenant.actorId]);
  if(!allowed.rowCount)throw Error('INVITATION_ADMIN_REQUIRED');
}
export function createInvitationService(pool:Pool,configuration:InvitationKeys){
  if(!Number.isInteger(configuration.expiryHours)||configuration.expiryHours<1||configuration.expiryHours>168)throw Error('INVITATION_CONFIGURATION_INVALID');
  return {
    async preview(tenant:TenantContext,verifiedEmail:string|undefined,input:{invitationId:string;token:string}){
      if(!verifiedEmail||!validEmail(normalizeEmail(verifiedEmail))||!input.invitationId||input.invitationId.length>128||!/^[A-Za-z0-9_-]{43}$/.test(input.token))throw Error('INVITATION_UNAVAILABLE');
      return withTenantTransaction(pool,tenant,async client=>{
        const result=await client.query(`SELECT i.invitation_id,i.role,i.expires_at,o.name FROM organization_invitations i JOIN organizations o ON o.organization_id=i.organization_id
          WHERE i.organization_id=$1 AND i.invitation_id=$2 AND i.token_hash=$3 AND i.intended_email=$4 AND i.status='PENDING' AND i.expires_at>clock_timestamp() AND o.status='ACTIVE'
          AND EXISTS(SELECT 1 FROM organization_memberships m JOIN role_assignments r ON r.organization_id=m.organization_id AND r.subject=m.subject WHERE m.organization_id=i.organization_id AND m.subject=i.inviter_id AND m.status='ACTIVE' AND r.role='organization_admin' AND r.scope_type='organization' AND (r.scope_id IS NULL OR r.scope_id=i.organization_id))
          AND NOT EXISTS(SELECT 1 FROM organization_memberships m WHERE m.organization_id=i.organization_id AND m.subject=$5 AND m.status='SUSPENDED')`,[tenant.organizationId,input.invitationId,hash(input.token),normalizeEmail(verifiedEmail),tenant.actorId]);
        const row=result.rows[0];if(!row)throw Error('INVITATION_UNAVAILABLE');
        return {organizationId:tenant.organizationId,organizationName:row.name,invitationId:row.invitation_id,role:row.role,expiresAt:row.expires_at};
      });
    },
    async create(tenant:TenantContext,input:{email:string;role:string;idempotencyKey:string}){
      const email=normalizeEmail(input.email);
      if(!validEmail(email)||!organizationRoleNames.includes(input.role)||!validKey(input.idempotencyKey))throw Error('INVITATION_REQUEST_INVALID');
      return withTenantTransaction(pool,tenant,async client=>{
        await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`,['member-admin:'+tenant.organizationId]);
        await authorize(client,tenant);
        const id='invitation:'+hash(JSON.stringify([tenant.organizationId,tenant.actorId,input.idempotencyKey]));
        const signature=hash(JSON.stringify([email,input.role]));
        const old=(await client.query(`SELECT ${columns},request_hash FROM organization_invitations WHERE organization_id=$1 AND invitation_id=$2`,[tenant.organizationId,id])).rows[0];
        if(old){if(old.request_hash!==signature)throw Error('IDEMPOTENCY_KEY_REUSED');return projection(old);}
        const token=invitationDeliveryToken(id,configuration.activeKeyId,configuration.keys);
        await client.query(`SELECT public.create_organization_invitation($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[id,tenant.actorId,email,input.role,hash(token),configuration.activeKeyId,signature,configuration.expiryHours,tenant.correlationId]);
        const result=await client.query(`SELECT ${columns} FROM organization_invitations WHERE organization_id=$1 AND invitation_id=$2`,[tenant.organizationId,id]);
        return projection(result.rows[0]);
      });
    },
    async list(tenant:TenantContext,after?:string){
      if(after!==undefined&&(!after||after.length>128))throw Error('INVITATION_REQUEST_INVALID');
      return withTenantTransaction(pool,tenant,async client=>{
        await authorize(client,tenant);
        const result=await client.query(`SELECT ${columns} FROM organization_invitations WHERE organization_id=$1 AND ($2::text IS NULL OR invitation_id>$2) ORDER BY invitation_id LIMIT 51`,[tenant.organizationId,after??null]);
        return {items:result.rows.slice(0,50).map(projection),nextCursor:result.rows.length>50?result.rows[49].invitation_id:null,allowedRoles:organizationRoleNames};
      });
    },
    async revoke(tenant:TenantContext,invitationId:string,reason:string){
      if(!invitationId||invitationId.length>128||!reason.trim()||reason.length>2000)throw Error('INVITATION_REQUEST_INVALID');
      return withTenantTransaction(pool,tenant,async client=>{
        await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`,['member-admin:'+tenant.organizationId]);
        await authorize(client,tenant);
        await client.query(`SELECT public.revoke_organization_invitation($1,$2,$3,$4)`,[invitationId,tenant.actorId,reason.trim(),tenant.correlationId]);
        return projection((await client.query(`SELECT ${columns} FROM organization_invitations WHERE organization_id=$1 AND invitation_id=$2`,[tenant.organizationId,invitationId])).rows[0]);
      });
    },
    // verifiedEmail must come from trusted identity verification, never a request body.
    // HTTP obtains this only from the authenticator's signed verification claims.
    async accept(tenant:TenantContext,verifiedEmail:string|undefined,input:{invitationId:string;token:string;role:string}){
      if(!verifiedEmail||!validEmail(normalizeEmail(verifiedEmail))||!tenant.actorId||tenant.actorId.length>256||!input.invitationId||input.invitationId.length>128||!/^[A-Za-z0-9_-]{43}$/.test(input.token)||!organizationRoleNames.includes(input.role))throw Error('INVITATION_UNAVAILABLE');
      return withTenantTransaction(pool,tenant,async client=>{
        const result=await client.query(`SELECT public.accept_organization_invitation($1,$2,$3,$4,$5,$6) AS accepted`,[input.invitationId,hash(input.token),normalizeEmail(verifiedEmail),tenant.actorId,input.role,tenant.correlationId]);
        if(!result.rows[0].accepted)throw Error('INVITATION_UNAVAILABLE');
        return {organizationId:tenant.organizationId,role:input.role};
      });
    }
  };
}
