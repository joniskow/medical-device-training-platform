import type { Pool } from "pg";
import {createHash} from 'node:crypto';
import {withTenantTransaction} from './tenant-transaction.js';
export const organizationRoleNames:readonly string[]=['learner','author','reviewer','publisher','organization_admin','employer'];
const allowedRoles=organizationRoleNames;

export interface OrganizationMembershipStore {
  createOrganization(subject:string,name:string,key:string,correlationId:string):Promise<{organizationId:string;name:string}>;
  listOrganizationContexts(subject:string):Promise<readonly {organizationId:string;name?:string}[]>;
  resolveActiveOrganizations(subject: string): Promise<readonly string[]>;
  resolveOrganizationRoles(subject:string,organizationId:string):Promise<readonly string[]>;
  selectOrganization(subject:string,organizationId:string,key:string,correlationId:string):Promise<void>;
}

export async function seedActiveOrganizationMembership(pool: Pool, input: { subject: string; organizationId: string; membershipId?: string;roles?:string[] }): Promise<void> {
  const subject = input.subject.trim();
  const organizationId = input.organizationId.trim();
  if (!subject || subject.length > 256) throw new Error("MEMBERSHIP_SUBJECT_INVALID");
  if (!organizationId || organizationId.length > 128) throw new Error("MEMBERSHIP_ORGANIZATION_INVALID");
  if(input.roles&&(!input.roles.length||input.roles.some(role=>!allowedRoles.includes(role))))throw Error('MEMBERSHIP_ROLES_INVALID');
  await withTenantTransaction(pool,{organizationId,actorId:subject,correlationId:'membership-seed'},async client=>{
    await client.query(`INSERT INTO organization_memberships(membership_id,subject,organization_id,status,created_at,updated_at) VALUES($1,$2,$3,'ACTIVE',now(),now()) ON CONFLICT(subject,organization_id) DO UPDATE SET status='ACTIVE',updated_at=now()`,[input.membershipId?.trim()||`membership:${subject}:${organizationId}`,subject,organizationId]);
    if(input.roles){
      await client.query(`DELETE FROM role_assignments WHERE organization_id=$1 AND subject=$2 AND scope_type='organization' AND (scope_id IS NULL OR scope_id=$1)`,[organizationId,subject]);
      for(const role of new Set(input.roles))await client.query(`INSERT INTO role_assignments(role_assignment_id,organization_id,subject,role,scope_type,scope_id,created_at,updated_at) VALUES($1,$2,$3,$4,'organization',$2,now(),now())`,['role:'+createHash('sha256').update(JSON.stringify([organizationId,subject,role])).digest('hex'),organizationId,subject,role]);
    }
  });
}

/**
 * Reads authorization membership from the application control plane.
 * This lookup establishes the one organization context used by tenant-scoped operations.
 */
export function createPostgresOrganizationMembershipStore(pool: Pool): OrganizationMembershipStore {
  async function listOrganizationContexts(subject:string){
    if(!subject.trim()||subject.length>256)return [];
    const candidates=await pool.query<{organization_id:string}>(`SELECT organization_id FROM organization_memberships WHERE subject=$1 AND status='ACTIVE' ORDER BY organization_id`,[subject]);
    const items:{organizationId:string;name?:string}[]=[];
    for(const row of candidates.rows){
      const organizationId=row.organization_id;
      const result=await withTenantTransaction(pool,{organizationId,actorId:subject,correlationId:'organization-list'},client=>client.query(`SELECT name,status FROM organizations WHERE organization_id=$1`,[organizationId]));
      // Seeded pilot tenants predate organization profiles.
      if(!result.rowCount||result.rows[0].status==='ACTIVE')items.push({organizationId,...(result.rowCount?{name:result.rows[0].name}:{})});
    }
    return items;
  }
  return {
    listOrganizationContexts,
    async createOrganization(subject,name,key,correlationId){
      if(!subject.trim()||subject.length>256||!name.trim()||name.trim().length>160||!/^[A-Za-z0-9._:-]{1,128}$/.test(key))throw Error('ORGANIZATION_REQUEST_INVALID');
      const client=await pool.connect();
      try{
        await client.query('BEGIN');
        const result=await client.query(`SELECT public.create_training_organization($1,$2,$3,$4) AS organization`,[subject,name.trim(),key,correlationId]);
        await client.query('COMMIT');
        return result.rows[0].organization;
      }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
    },
    async resolveOrganizationRoles(subject,organizationId){
      return withTenantTransaction(pool,{organizationId,actorId:subject,correlationId:'membership-authorization'},async client=>{
        const member=await client.query(`SELECT 1 FROM organization_memberships WHERE subject=$1 AND organization_id=$2 AND status='ACTIVE'`,[subject,organizationId]);
        if(!member.rowCount)return [];
        if((await client.query(`SELECT 1 FROM organizations WHERE organization_id=$1 AND status<>'ACTIVE'`,[organizationId])).rowCount)return [];
        const roles=(await client.query(`SELECT role FROM role_assignments WHERE subject=$1 AND organization_id=$2 AND scope_type='organization' AND (scope_id IS NULL OR scope_id=$2) ORDER BY role`,[subject,organizationId])).rows.map(row=>row.role).filter(role=>allowedRoles.includes(role));
        return roles.length?roles:['learner'];
      });
    },
    async selectOrganization(subject,organizationId,key,correlationId){
      if(!/^[A-Za-z0-9._:-]{1,128}$/.test(key))throw Error('ORGANIZATION_SELECTION_INVALID');
      await withTenantTransaction(pool,{organizationId,actorId:subject,correlationId},async client=>{
        const member=await client.query(`SELECT 1 FROM organization_memberships WHERE subject=$1 AND organization_id=$2 AND status='ACTIVE'`,[subject,organizationId]);
        if(!member.rowCount)throw Error('ORGANIZATION_MEMBERSHIP_REQUIRED');
        if((await client.query(`SELECT 1 FROM organizations WHERE organization_id=$1 AND status<>'ACTIVE'`,[organizationId])).rowCount)throw Error('ORGANIZATION_MEMBERSHIP_REQUIRED');
        const eventId='organization-selection:'+createHash('sha256').update(JSON.stringify([subject,organizationId,key])).digest('hex');
        await client.query(`INSERT INTO audit_events(audit_event_id,organization_id,actor_id,event_type,resource_type,resource_id,details,created_at) VALUES($1,$2,$3,'ORGANIZATION_CONTEXT_SELECTED','organization',$2,$4::jsonb,now()) ON CONFLICT(audit_event_id) DO NOTHING`,[eventId,organizationId,subject,JSON.stringify({correlationId})]);
      });
    },
    async resolveActiveOrganizations(subject: string) {
      return (await listOrganizationContexts(subject)).map(row=>row.organizationId);
    }
  };
}
