import {createPersonalAccountStore} from '../packages/db/dist/index.js';
/** Shared gate for interactive operator tools. Never accepts actor identity from tool arguments. */
export async function requireActiveOperator(authenticator,authorization,pool,expectedSubject){
 const principal=await authenticator.authenticate({headers:{authorization}});
 if(!principal?.roles.includes('operator')||!principal.issuer||!principal.identityTenant||(expectedSubject!==undefined&&principal.subject!==expectedSubject))throw Error('OPERATOR_ACCOUNT_REQUIRED');
 const account=await createPersonalAccountStore(pool).access(principal,'GET');
 if(!account||account.status!=='ACTIVE'||account.userId!==principal.subject)throw Error('OPERATOR_ACCOUNT_REQUIRED');
 return principal;
}
