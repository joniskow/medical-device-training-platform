import assert from 'node:assert/strict';
import pg from 'pg';
import {randomUUID} from 'node:crypto';
import {createEmailVerificationStore,EMAIL_CHALLENGE_MIGRATION_SQL} from '../packages/db/dist/email-verification-challenge.js';
import {createEmailVerificationService,verificationIdentityKey} from '../apps/api/dist/email-verification-service.js';
const pool=new pg.Pool({connectionString:process.env.TEST_DATABASE_URL??'postgresql://local_app:local_only_change_me@127.0.0.1:54329/medical_device'});
const identity={subject:randomUUID(),issuer:'https://issuer.example',identityTenant:'tenant'},email=`${randomUUID()}@example.com`;
const key=verificationIdentityKey(identity),store=createEmailVerificationStore(pool);let delivered;
const service=createEmailVerificationService({store,secret:'unit-test-secret-'.repeat(3),sender:{sendVerification:async message=>{delivered=message;}}});
try{
 await pool.query(EMAIL_CHALLENGE_MIGRATION_SQL);
 assert.throws(()=>createEmailVerificationService({store,sender:{},secret:'short'}));
 const challenge=await service.start(identity,email);
 assert.equal(delivered.email,email);assert.match(delivered.code,/^\d{6}$/);
 assert.equal(JSON.stringify(challenge).includes(delivered.code),false);
 await assert.rejects(service.complete({...identity,subject:'wrong'},{challengeId:challenge.challengeId,code:delivered.code}),/UNAVAILABLE/);
 const result=await service.complete(identity,{challengeId:challenge.challengeId,code:delivered.code});assert.equal(result.verifiedEmail,email);
 await assert.rejects(service.complete(identity,{challengeId:challenge.challengeId,code:delivered.code}),/UNAVAILABLE/);
 const principal={...identity,roles:[],authenticationExpiresAt:new Date(Date.now()+60_000).toISOString()};
 const enriched=await service.enrich(principal);assert.equal(enriched.verifiedEmail,email);assert.equal(enriched.verificationExpiresAt,principal.authenticationExpiresAt);
 assert.equal((await service.enrich({...principal,authenticationExpiresAt:undefined})).verifiedEmail,undefined);
 assert.equal((await service.enrich({...principal,verifiedEmail:'signed@example.com'})).verifiedEmail,'signed@example.com');
 await service.revoke(identity);assert.equal(await service.assurance(identity),null);
 console.log('Real PostgreSQL email service: delivery/HMAC/identity/replay/revoke and bounded principal enrichment passed.');
}finally{
 await pool.query('DELETE FROM public.email_verification_challenges WHERE identity_key=$1',[key]);
 await pool.query('DELETE FROM public.email_verification_assurances WHERE identity_key=$1',[key]);
 await pool.query('DELETE FROM public.email_verification_delivery_limits WHERE email_key=md5($1)',[email]);await pool.end();
}
