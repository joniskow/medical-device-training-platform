import {verifiedAccountFixture} from './verified-account-fixture.mjs';
import assert from 'node:assert/strict';
import {randomUUID,generateKeyPairSync,sign} from 'node:crypto';
import {Pool} from 'pg';
import {applyProcessingJobMigration,createPersonalAccountStore} from '../packages/db/dist/index.js';
import {createJobStatusHttpServer} from '../apps/api/dist/job-status-http.js';
import {createEntraRequestAuthenticator} from '../apps/api/dist/entra-authenticator.js';
const pool=new Pool({connectionString:'postgresql://local_app:local_only_change_me@127.0.0.1:54329/medical_device'}),runtime=new Pool({connectionString:'postgresql://local_runtime:local_runtime_only_change_me@127.0.0.1:54329/medical_device'});
const subject='account:'+randomUUID(),other=subject+':other',httpSubject=subject+':http',issuer='https://identity.example.test/tenant/v2.0',identityTenant=randomUUID(),identity={subject,issuer,identityTenant,verifiedEmail:'shared@example.test'};
const fn='public.access_personal_account(text,text,text,text,text,integer,text)';let granted=false;
const verified=verifiedAccountFixture(pool,subject);
try{
 await applyProcessingJobMigration(pool);
 await verified.prepare();
 if(!(await pool.query("SELECT has_function_privilege('local_runtime',$1,'EXECUTE') allowed",[fn])).rows[0].allowed){await pool.query(`GRANT EXECUTE ON FUNCTION ${fn} TO local_runtime`);granted=true;}
 const store=createPersonalAccountStore(runtime),input={displayName:'  Personal learner  ',idempotencyKey:'create'};
 assert.equal(await store.access(identity,'GET'),null);
 const created=await Promise.all([store.access(identity,'CREATE',input),store.access(identity,'CREATE',input)]);assert.deepEqual(created[0],created[1]);assert.equal(created[0].userId,subject);assert.equal(created[0].displayName,'Personal learner');assert.equal(created[0].emailVerified,true);
 assert.equal((await runtime.query('SELECT * FROM organization_memberships WHERE subject=$1',[subject])).rowCount,0);
 await assert.rejects(store.access(identity,'CREATE',{...input,displayName:'Changed'}),/IDEMPOTENCY_KEY_REUSED/);
 const assurance=async user=>(await runtime.query('SELECT public.has_verified_account($1) verified',[user])).rows[0].verified;
 assert.equal(await assurance(subject),false);assert.equal(await assurance('missing:'+subject),false);
 await store.observeVerification(identity,new Date(Date.now()+300000).toISOString());assert.equal(await assurance(subject),true);
 await store.observeVerification({...identity,issuer:'https://wrong.example.test'},new Date(Date.now()+300000).toISOString());assert.equal(await assurance(subject),true,'Foreign identity altered verification');
 await store.observeVerification(identity,new Date(Date.now()-1000).toISOString());assert.equal(await assurance(subject),false);
 await store.observeVerification(identity,new Date(Date.now()+300000).toISOString());
 await store.observeVerification({...identity,verifiedEmail:undefined},new Date(Date.now()+300000).toISOString());assert.equal(await assurance(subject),false);
 const duplicateEmail=await store.access({...identity,subject:other},'CREATE',input);assert.notEqual(duplicateEmail.userId,subject,'Email silently merged accounts');
 await assert.rejects(store.access({...identity,issuer:'https://other.example.test'},'GET'),/ACCOUNT_IDENTITY_CONFLICT/);
 await assert.rejects(store.access({...identity,issuer:'https://other.example.test'},'CREATE',input),/ACCOUNT_IDENTITY_CONFLICT/);
 const update={displayName:'New name',revision:1,idempotencyKey:'update'};
 await store.access(identity,'UPDATE',update);
 await assert.rejects(store.access(identity,'UPDATE',{...update,idempotencyKey:'stale'}),/ACCOUNT_CHANGED/);
 await store.access(identity,'UPDATE',{displayName:'Latest',revision:2,idempotencyKey:'later'});
 assert.equal((await store.access(identity,'UPDATE',update)).displayName,'Latest');
 assert.equal((await store.access({...identity,verifiedEmail:undefined},'GET')).emailVerified,false,'Historical email verification overrode current sign-in');
 const broken={async connect(){const c=await runtime.connect();return {query(sql,args){if(sql==='COMMIT')throw Error('Injected commit');return c.query(sql,args);},release(){c.release();}};}};
 await assert.rejects(createPersonalAccountStore(broken).access(identity,'UPDATE',{displayName:'Rollback',revision:3,idempotencyKey:'rollback'}),/Injected commit/);
 assert.equal((await store.access(identity,'GET')).displayName,'Latest');
 for(const table of ['personal_accounts','external_identities','personal_account_events']){
  await assert.rejects(runtime.query(`SELECT * FROM ${table}`),/permission denied/);
  await assert.rejects(runtime.query(`INSERT INTO ${table} SELECT * FROM ${table} WHERE false`),/permission denied/);
 }
 assert.equal((await pool.query("SELECT count(*)::int n FROM personal_account_events WHERE user_id=$1",[subject])).rows[0].n,3);
 assert.equal((await pool.query("SELECT count(*)::int n FROM pg_proc p,LATERAL aclexplode(p.proacl) a WHERE p.proname IN ('access_personal_account','observe_account_verification','has_verified_account') AND a.grantee=0 AND a.privilege_type='EXECUTE'")).rows[0].n,0);
 const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048}),jwk=publicKey.export({format:'jwk'}),audience='api://account-test';
 const token=(overrides={})=>{const enc=x=>Buffer.from(JSON.stringify(x)).toString('base64url'),now=Math.floor(Date.now()/1000),value=enc({alg:'RS256',kid:'test'})+'.'+enc({iss:issuer,tid:identityTenant,aud:audience,oid:httpSubject,exp:now+300,nbf:now-10,email:'shared@example.test',email_verified:true,...overrides});return value+'.'+sign('RSA-SHA256',Buffer.from(value),privateKey).toString('base64url');};
 const authenticator=createEntraRequestAuthenticator({tenantId:identityTenant,audience,openIdConfigurationUrl:issuer+'/metadata',fetchImpl:async url=>new Response(JSON.stringify(url.endsWith('/metadata')?{issuer,jwks_uri:issuer+'/keys'}:{keys:[{...jwk,kid:'test',alg:'RS256',use:'sig'}]}))});
 const server=createJobStatusHttpServer({statusService:{get:async()=>null,retry:async()=>null},organizationContextResolver:{resolveActiveOrganizations:async()=>assert.fail('Personal profile required organization lookup')},personalAccountStore:store,authenticator});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{
  const url=`http://127.0.0.1:${server.address().port}/api/v1/account`,headers={authorization:'Bearer '+token(),'content-type':'application/json','idempotency-key':'http'};
  assert.equal((await fetch(url)).status,401);
  assert.equal((await fetch(url,{headers:{authorization:'Bearer '+token({iss:'wrong'})}})).status,401);
  const before=await fetch(url,{headers});assert.equal(before.headers.get('cache-control'),'no-store');assert.equal((await before.json()).account,null);
  const post=body=>fetch(url,{method:'POST',headers,body:JSON.stringify(body)}),body={action:'create',displayName:'HTTP learner',confirmed:true};
  for(const extra of [{subject},{issuer:'spoof'},{identityTenant:'spoof'},{emailVerified:true},{verificationExpiresAt:'2099-01-01T00:00:00Z'},{roles:['operator']},{organizationId:'spoof'},{confirmed:false}])assert.equal((await post({...body,...extra})).status,422);
  const response=await post(body);assert.equal(response.status,200);const account=(await response.json()).account;assert.equal(account.userId,httpSubject);assert.equal(account.emailVerified,true);assert.equal(await assurance(httpSubject),true,'Signed verification was not observed');
  assert.equal((await (await fetch(url,{headers:{authorization:'Bearer '+token({oid:subject,email_verified:false})}})).json()).account.displayName,'Latest');
  await fetch(url,{headers:{authorization:'Bearer '+token({email_verified:false})}});assert.equal(await assurance(httpSubject),false);
  await fetch(url,{headers});assert.equal(await assurance(httpSubject),true);
  await pool.query("UPDATE personal_accounts SET status='LOCKED' WHERE user_id=$1",[httpSubject]);
  assert.equal(await assurance(httpSubject),false);
  assert.equal((await fetch(url,{headers})).status,403);
  assert.equal((await fetch(url.replace('/account','/organization-contexts'),{headers})).status,403,'Locked account reached private organization lookup');
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
 console.log('Personal accounts passed: no organization required, signed identity binding, duplicate-email separation, issuer collision denial, concurrent creation, profile revisions/retry/rollback, strict HTTP fields, current verification state and restricted tables.');
}finally{
 try{for(const table of ['personal_account_events','external_identities','personal_accounts'])await pool.query(`DELETE FROM ${table} WHERE user_id=ANY($1::text[])`,[[subject,other,httpSubject]]);}
 finally{if(granted)await pool.query(`REVOKE EXECUTE ON FUNCTION ${fn} FROM local_runtime`);await verified.cleanup();await runtime.end();await pool.end();}
}
