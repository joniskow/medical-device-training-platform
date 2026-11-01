import {createHash} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import type {TenantContext} from '@medical-device/contracts';
import {withTenantTransaction,organizationRoleNames} from '@medical-device/db';
const roles=organizationRoleNames;
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const memberQuery=`SELECT m.membership_id,m.subject,m.status,m.updated_at::text AS membership_revision,COALESCE((SELECT jsonb_agg(jsonb_build_object('role',r.role,'id',r.role_assignment_id,'updatedAt',r.updated_at) ORDER BY r.role,r.role_assignment_id) FROM role_assignments r WHERE r.organization_id=m.organization_id AND r.subject=m.subject AND r.scope_type='organization' AND (r.scope_id IS NULL OR r.scope_id=m.organization_id)),'[]'::jsonb) AS role_rows FROM organization_memberships m WHERE m.organization_id=$1`;
const currentRoles=(row:Record<string,any>)=>{const assigned=[...new Set<string>(row.role_rows.map((r:Record<string,any>)=>r.role).filter((r:string)=>roles.includes(r)))];return assigned.length?assigned:['learner'];};
const revision=(row:Record<string,any>)=>hash([row.membership_id,row.status,row.membership_revision,row.role_rows]);
const project=(row:Record<string,any>)=>({subject:row.subject,status:row.status,roles:currentRoles(row),revision:revision(row)});
async function authorize(client:PoolClient,tenant:TenantContext,operator:boolean){
  const actor=(await client.query(memberQuery+' AND m.subject=$2',[tenant.organizationId,tenant.actorId])).rows[0];
  if(!actor||actor.status!=='ACTIVE'||(!operator&&!currentRoles(actor).includes('organization_admin')))throw Error('MEMBER_ADMIN_REQUIRED');
}
export function createMemberService(pool:Pool){return {
  async setStatus(tenant:TenantContext,subject:string,request:{status:string;reason:string;revision:string;idempotencyKey:string},operator=false){
    if(!subject||subject.length>256||!['ACTIVE','SUSPENDED','REMOVED'].includes(request.status)||typeof request.reason!=='string'||!request.reason.trim()||request.reason.length>2000||!/^[a-f0-9]{64}$/.test(request.revision)||!/^[A-Za-z0-9._:-]{1,128}$/.test(request.idempotencyKey))throw Error('MEMBER_REQUEST_INVALID');
    return withTenantTransaction(pool,tenant,async client=>{
      await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`,['member-admin:'+tenant.organizationId]);
      await authorize(client,tenant,operator);
      const id='member-status:'+hash([tenant.organizationId,tenant.actorId,request.idempotencyKey]),signature=hash([subject,request.status,request.reason.trim(),request.revision]);
      const prior=(await client.query(`SELECT details FROM audit_events WHERE organization_id=$1 AND audit_event_id=$2`,[tenant.organizationId,id])).rows[0];
      if(prior&&prior.details.signature!==signature)throw Error('IDEMPOTENCY_KEY_REUSED');
      const member=(await client.query(memberQuery+' AND m.subject=$2',[tenant.organizationId,subject])).rows[0];
      if(!member)throw Error('MEMBER_NOT_FOUND');
      if(prior)return project(member);
      if(revision(member)!==request.revision||member.status===request.status)throw Error('MEMBER_CHANGED');
      if(member.status==='REMOVED'&&request.status!=='ACTIVE')throw Error('MEMBER_CHANGED');
      if(request.status==='ACTIVE'&&!(await client.query('SELECT public.has_verified_account($1) AS verified',[subject])).rows[0].verified)throw Error('MEMBER_VERIFIED_ACCOUNT_REQUIRED');
      const changed=await client.query(`SELECT public.set_tenant_membership_status($1,$2,$3,$4) AS changed`,[subject,request.status,member.status,member.membership_revision]);
      if(!changed.rows[0].changed)throw Error('MEMBER_CHANGED');
      let removedAssignments:unknown[]=[];
      if(request.status==='REMOVED')removedAssignments=(await client.query(`DELETE FROM role_assignments WHERE organization_id=$1 AND subject=$2 RETURNING role,scope_type,scope_id`,[tenant.organizationId,subject])).rows;
      await client.query(`INSERT INTO audit_events(audit_event_id,organization_id,actor_id,event_type,resource_type,resource_id,details,created_at) VALUES($1,$2,$3,'MEMBER_STATUS_CHANGED','membership',$4,$5::jsonb,now())`,[id,tenant.organizationId,tenant.actorId,member.membership_id,JSON.stringify({signature,subject,previousStatus:member.status,status:request.status,removedAssignments,reason:request.reason.trim(),correlationId:tenant.correlationId})]);
      return project((await client.query(memberQuery+' AND m.subject=$2',[tenant.organizationId,subject])).rows[0]);
    });
  },
  async list(tenant:TenantContext,after?:string,operator=false){
    if(after!==undefined&&(!after||after.length>256))throw Error('MEMBER_REQUEST_INVALID');
    return withTenantTransaction(pool,tenant,async client=>{
      await authorize(client,tenant,operator);
      const rows=(await client.query(memberQuery+' AND ($2::text IS NULL OR m.subject>$2) ORDER BY m.subject LIMIT 51',[tenant.organizationId,after??null])).rows;
      return {items:rows.slice(0,50).map(project),nextCursor:rows.length>50?rows[49].subject:null,allowedRoles:roles};
    });
  },
  async setRoles(tenant:TenantContext,subject:string,request:{roles:string[];reason:string;revision:string;idempotencyKey:string},operator=false){
    if(!subject||subject.length>256||!Array.isArray(request.roles)||!request.roles.length||request.roles.length>roles.length||new Set(request.roles).size!==request.roles.length||request.roles.some(role=>!roles.includes(role))||typeof request.reason!=='string'||!request.reason.trim()||request.reason.length>2000||!/^[a-f0-9]{64}$/.test(request.revision)||!/^[A-Za-z0-9._:-]{1,128}$/.test(request.idempotencyKey))throw Error('MEMBER_REQUEST_INVALID');
    return withTenantTransaction(pool,tenant,async client=>{
      await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`,['member-admin:'+tenant.organizationId]);
      await authorize(client,tenant,operator);
      const id='member-roles:'+hash([tenant.organizationId,tenant.actorId,request.idempotencyKey]),signature=hash([subject,[...request.roles].sort(),request.reason.trim(),request.revision]);
      const prior=(await client.query(`SELECT details FROM audit_events WHERE organization_id=$1 AND audit_event_id=$2`,[tenant.organizationId,id])).rows[0];
      if(prior&&prior.details.signature!==signature)throw Error('IDEMPOTENCY_KEY_REUSED');
      const member=(await client.query(memberQuery+' AND m.subject=$2',[tenant.organizationId,subject])).rows[0];
      if(!member)throw Error('MEMBER_NOT_FOUND');
      if(prior)return project(member);
      if(member.status!=='ACTIVE')throw Error('MEMBER_INACTIVE');
      if(revision(member)!==request.revision)throw Error('MEMBER_CHANGED');
      if(currentRoles(member).includes('organization_admin')&&!request.roles.includes('organization_admin')){
        const other=await client.query(`SELECT 1 FROM organization_memberships m JOIN role_assignments r ON r.organization_id=m.organization_id AND r.subject=m.subject WHERE m.organization_id=$1 AND m.subject<>$2 AND m.status='ACTIVE' AND r.role='organization_admin' AND r.scope_type='organization' AND (r.scope_id IS NULL OR r.scope_id=m.organization_id) LIMIT 1`,[tenant.organizationId,subject]);
        if(!other.rowCount)throw Error('LAST_ORGANIZATION_ADMIN');
      }
      await client.query(`DELETE FROM role_assignments WHERE organization_id=$1 AND subject=$2 AND scope_type='organization' AND (scope_id IS NULL OR scope_id=$1)`,[tenant.organizationId,subject]);
      for(const role of request.roles)await client.query(`INSERT INTO role_assignments(role_assignment_id,organization_id,subject,role,scope_type,scope_id,created_at,updated_at) VALUES($1,$2,$3,$4,'organization',$2,now(),now())`,['role:'+hash([tenant.organizationId,subject,role]),tenant.organizationId,subject,role]);
      await client.query(`INSERT INTO audit_events(audit_event_id,organization_id,actor_id,event_type,resource_type,resource_id,details,created_at) VALUES($1,$2,$3,'MEMBER_ROLES_CHANGED','membership',$4,$5::jsonb,now())`,[id,tenant.organizationId,tenant.actorId,member.membership_id,JSON.stringify({signature,subject,previousRoles:currentRoles(member),roles:[...request.roles].sort(),reason:request.reason.trim(),correlationId:tenant.correlationId})]);
      return project((await client.query(memberQuery+' AND m.subject=$2',[tenant.organizationId,subject])).rows[0]);
    });
  }
};}
