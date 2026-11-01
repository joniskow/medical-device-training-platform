import assert from 'node:assert/strict';
import {randomUUID,generateKeyPairSync,sign} from 'node:crypto';
import {Pool} from 'pg';
import {applyProcessingJobMigration,createPersonalAccountStore,createAccountSecurityStore,createPostgresOrganizationMembershipStore} from '../packages/db/dist/index.js';
import {createEntraRequestAuthenticator} from '../apps/api/dist/entra-authenticator.js';
import {requireActiveOperator} from './operator-account.mjs';
const pool=new Pool({connectionString:'postgresql://local_app:local_only_change_me@127.0.0.1:54329/medical_device'}),runtime=new Pool({connectionString:'postgresql://local_runtime:local_runtime_only_change_me@127.0.0.1:54329/medical_device'});
const operator='security:'+randomUUID(),target=operator+':target',unregistered=operator+':missing',issuer='https://identity.example.test/tenant/v2.0',identityTenant=randomUUID(),executions=[];let org;
const functions=['public.access_personal_account(text,text,text,text,text,integer,text)','public.administer_personal_account(text,text,text,integer,text,text,text)'];
try{
 await applyProcessingJobMigration(pool);
 for(const fn of functions)if(!(await pool.query("SELECT has_function_privilege('local_runtime',$1,'EXECUTE') allowed",[fn])).rows[0].allowed){await pool.query(`GRANT EXECUTE ON FUNCTION ${fn} TO local_runtime`);executions.push(fn);}
 const accounts=createPersonalAccountStore(runtime);
 for(const subject of [operator,target])await accounts.access({subject,issuer,identityTenant},'CREATE',{displayName:subject===operator?'Operator':'Private profile',idempotencyKey:'create'});
 org=(await createPostgresOrganizationMembershipStore(pool).createOrganization(target,'Preserved organization','fixture','test')).organizationId;
 const membershipBefore=(await pool.query('SELECT row_to_json(m) value FROM organization_memberships m WHERE organization_id=$1',[org])).rows;
 const identityBefore=(await pool.query('SELECT row_to_json(i) value FROM external_identities i WHERE user_id=$1',[target])).rows;
 const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048}),jwk=publicKey.export({format:'jwk'}),audience='api://security-test';
 const token=(overrides={})=>{const enc=x=>Buffer.from(JSON.stringify(x)).toString('base64url'),now=Math.floor(Date.now()/1000),value=enc({alg:'RS256',kid:'test'})+'.'+enc({iss:issuer,tid:identityTenant,aud:audience,oid:operator,roles:['operator'],exp:now+300,nbf:now-10,...overrides});return 'Bearer '+value+'.'+sign('RSA-SHA256',Buffer.from(value),privateKey).toString('base64url');};
 const authenticator=createEntraRequestAuthenticator({tenantId:identityTenant,audience,openIdConfigurationUrl:issuer+'/metadata',fetchImpl:async url=>new Response(JSON.stringify(url.endsWith('/metadata')?{issuer,jwks_uri:issuer+'/keys'}:{keys:[{...jwk,kid:'test',alg:'RS256',use:'sig'}]}))});
 const authorization=token(),authorize=async()=>(await requireActiveOperator(authenticator,authorization,runtime,operator)).subject;
 for(const bad of [token({roles:['organization_admin']}),token({exp:0}),token({oid:unregistered}),token({iss:'wrong'})])await assert.rejects(requireActiveOperator(authenticator,bad,runtime),/OPERATOR_ACCOUNT_REQUIRED/);
 await assert.rejects(requireActiveOperator(authenticator,authorization,runtime,'another'),/OPERATOR_ACCOUNT_REQUIRED/);
 const store=createAccountSecurityStore(runtime,authorize),request={status:'LOCKED',revision:1,idempotencyKey:'lock',reason:'Security investigation',confirmed:true};
 assert.deepEqual(await store.inspect(target),{userId:target,status:'ACTIVE',revision:1});
 await assert.rejects(store.setStatus(target,{...request,confirmed:false}),/SECURITY_INVALID/);
 await assert.rejects(store.setStatus(operator,request),/SECURITY_INVALID/);
 await assert.rejects(store.inspect(unregistered),/SECURITY_NOT_FOUND/);
 const broken={async connect(){const c=await runtime.connect();return {query(sql,args){if(sql==='COMMIT')throw Error('Injected commit');return c.query(sql,args);},release(){c.release();}};}};
 await assert.rejects(createAccountSecurityStore(broken,authorize).setStatus(target,request),/Injected commit/);
 assert.equal((await store.inspect(target)).revision,1);
 const results=await Promise.all([store.setStatus(target,request),store.setStatus(target,request)]);assert.deepEqual(results[0],results[1]);assert.equal(results[0].status,'LOCKED');assert.equal(results[0].revision,2);
 await assert.rejects(accounts.access({subject:target,issuer,identityTenant},'GET'),/ACCOUNT_LOCKED/);
 await assert.rejects(requireActiveOperator(authenticator,token({oid:target}),runtime),/ACCOUNT_LOCKED/);
 await assert.rejects(store.setStatus(target,{...request,reason:'Changed'}),/IDEMPOTENCY_KEY_REUSED/);
 await assert.rejects(store.setStatus(target,{...request,idempotencyKey:'stale'}),/SECURITY_CHANGED/);
 await store.setStatus(target,{...request,status:'ACTIVE',revision:2,idempotencyKey:'unlock',reason:'Incident resolved'});
 assert.equal((await store.setStatus(target,request)).status,'ACTIVE','Old lock replay undid unlock');
 assert.equal((await accounts.access({subject:target,issuer,identityTenant},'GET')).displayName,'Private profile');
 assert.deepEqual((await pool.query('SELECT row_to_json(m) value FROM organization_memberships m WHERE organization_id=$1',[org])).rows,membershipBefore);
 assert.deepEqual((await pool.query('SELECT row_to_json(i) value FROM external_identities i WHERE user_id=$1',[target])).rows,identityBefore);
 assert.equal((await pool.query("SELECT count(*)::int n FROM personal_account_events WHERE user_id=$1 AND event_type='ACCOUNT_STATUS_CHANGED'",[target])).rows[0].n,2);
 const otherOperator=createAccountSecurityStore(runtime,async()=>(await requireActiveOperator(authenticator,token({oid:target}),runtime)).subject);
 const reciprocal=await Promise.allSettled([store.setStatus(target,{...request,revision:3,idempotencyKey:'reciprocal-a'}),otherOperator.setStatus(operator,{...request,idempotencyKey:'reciprocal-b'})]);
 assert.equal(reciprocal.filter(r=>r.status==='fulfilled').length,1,'Concurrent operators both authorized after one was locked');
 assert.ok(reciprocal.some(r=>r.status==='rejected'&&/ACCOUNT_LOCKED|OPERATOR_UNAVAILABLE/.test(r.reason.message)));
 // Simulate authority changing after the signed gate: SQL must reject the stale operator.
 await pool.query("UPDATE personal_accounts SET status='LOCKED' WHERE user_id=$1",[operator]);
 await assert.rejects(createAccountSecurityStore(runtime,async()=>operator).setStatus(target,{...request,revision:3,idempotencyKey:'stale-operator'}),/OPERATOR_UNAVAILABLE/);
 await assert.rejects(store.inspect(target),/ACCOUNT_LOCKED/);
 await assert.rejects(runtime.query("UPDATE personal_accounts SET status='ACTIVE' WHERE false"),/permission denied/);
 assert.equal((await pool.query("SELECT count(*)::int n FROM pg_proc p,LATERAL aclexplode(p.proacl) a WHERE p.proname='administer_personal_account' AND a.grantee=0 AND a.privilege_type='EXECUTE'")).rows[0].n,0);
 console.log('Account security passed: signed operator role/account gate, expiry/identity denial, self-change and confirmation denial, atomic audited lock/unlock, concurrent retry, rollback, stale revision/operator denial, non-reverting replay and preserved memberships/identities.');
}finally{
 try{if(org)for(const table of ['audit_events','role_assignments','organization_memberships','organizations'])await pool.query(`DELETE FROM ${table} WHERE organization_id=$1`,[org]);for(const table of ['personal_account_events','external_identities','personal_accounts'])await pool.query(`DELETE FROM ${table} WHERE user_id=ANY($1::text[])`,[[operator,target]]);}
 finally{for(const fn of executions)await pool.query(`REVOKE EXECUTE ON FUNCTION ${fn} FROM local_runtime`);await runtime.end();await pool.end();}
}
