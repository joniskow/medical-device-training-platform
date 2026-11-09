import assert from 'node:assert/strict';
import pg from 'pg';
import {randomUUID} from 'node:crypto';
import {EMAIL_CHALLENGE_MIGRATION_SQL,createEmailVerificationStore} from '../packages/db/dist/email-verification-challenge.js';
const pool=new pg.Pool({connectionString:process.env.TEST_DATABASE_URL??'postgresql://local_app:local_only_change_me@127.0.0.1:54329/medical_device'});
const identity='a'.repeat(64),other='b'.repeat(64),hash='c'.repeat(64),id=randomUUID();
try{
 await pool.query(EMAIL_CHALLENGE_MIGRATION_SQL);
 await pool.query("DELETE FROM public.email_verification_delivery_limits WHERE email_key IN (md5('owner@example.com'),md5('second@example.com'))");
 await pool.query('DELETE FROM public.email_verification_challenges WHERE identity_key IN ($1,$2)',[identity,other]);
 await pool.query('DELETE FROM public.email_verification_assurances WHERE identity_key IN ($1,$2)',[identity,other]);
 const store=createEmailVerificationStore(pool);
 assert.equal(await store.issue(identity,id,'owner@example.com',hash),true);
 assert.equal(await store.issue(identity,randomUUID(),'owner@example.com',hash),false);
 assert.equal(await store.consume(other,id,hash),null);
 assert.equal((await pool.query('SELECT * FROM public.consume_email_verification($1,$2,NULL)',[identity,id])).rowCount,0);
 assert.equal(await store.consume(identity,id,'d'.repeat(64)),null);
 const races=await Promise.all([store.consume(identity,id,hash),store.consume(identity,id,hash)]);
 assert.equal(races.filter(Boolean).length,1);
 assert.equal((await store.get(identity)).verifiedEmail,'owner@example.com');
 assert.equal(await store.consume(identity,id,hash),null);
 await pool.query("UPDATE public.email_verification_challenges SET issued_at=now()-interval '2 minutes' WHERE identity_key=$1",[identity]);
 const second=randomUUID();assert.equal(await store.issue(identity,second,'second@example.com',hash),true);
 for(let attempt=0;attempt<5;attempt++)assert.equal(await store.consume(identity,second,'d'.repeat(64)),null);
 assert.equal(await store.consume(identity,second,hash),null);
 await pool.query("UPDATE public.email_verification_challenges SET attempts=0,expires_at=now()-interval '1 minute' WHERE identity_key=$1",[identity]);
 assert.equal(await store.consume(identity,second,hash),null);
 console.log('PostgreSQL email verification: identity binding, resend limit, failed attempts, expiry, atomic consumption/replay checks passed.');
}finally{
 await pool.query('DELETE FROM public.email_verification_challenges WHERE identity_key IN ($1,$2)',[identity,other]);
 await pool.query('DELETE FROM public.email_verification_assurances WHERE identity_key IN ($1,$2)',[identity,other]);
 await pool.query("DELETE FROM public.email_verification_delivery_limits WHERE email_key IN (md5('owner@example.com'),md5('second@example.com'))");
 await pool.end();
}
