import {createPersonalAccountStore,observeAccountVerification} from '../packages/db/dist/index.js';
/** Synthetic local test support. Refuses to overwrite any pre-existing account. */
export function verifiedAccountFixture(pool,fixtureId){
 const identities=new Map(),granted=[];
 return {
  async prepare(){for(const fn of ['public.default_credential_sharing(text,text)','public.has_verified_account(text)','public.observe_account_verification(text,text,text,timestamptz)'])if(!(await pool.query("SELECT has_function_privilege('local_runtime',$1,'EXECUTE') allowed",[fn])).rows[0].allowed){await pool.query(`GRANT EXECUTE ON FUNCTION ${fn} TO local_runtime`);granted.push(fn);}},
  async seed(subject){
   if(identities.has(subject))return;
   if((await pool.query('SELECT 1 FROM personal_accounts WHERE user_id=$1',[subject])).rowCount)throw Error('FIXTURE_ACCOUNT_ALREADY_EXISTS:'+subject);
   const identity={subject,issuer:'https://fixture.example.test/'+encodeURIComponent(fixtureId),identityTenant:fixtureId,verifiedEmail:'synthetic@example.test'};
   await createPersonalAccountStore(pool).access(identity,'CREATE',{displayName:'Synthetic learner',idempotencyKey:'fixture'});identities.set(subject,identity);
   await observeAccountVerification(pool,identity,new Date(Date.now()+3600000).toISOString());
  },
  async verify(subject,verified=true){const identity=identities.get(subject);if(!identity)throw Error('FIXTURE_ACCOUNT_MISSING');await observeAccountVerification(pool,{...identity,verifiedEmail:verified?identity.verifiedEmail:undefined},new Date(Date.now()+3600000).toISOString());},
  async cleanup(){try{for(const table of ['personal_account_events','external_identities','personal_accounts'])await pool.query(`DELETE FROM ${table} WHERE user_id=ANY($1::text[])`,[[...identities.keys()]]);}finally{for(const fn of granted)await pool.query(`REVOKE EXECUTE ON FUNCTION ${fn} FROM local_runtime`);}}
 };
}
