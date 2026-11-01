import { PublicClientApplication } from '@azure/msal-browser';
import {setAccessToken} from './auth-session.js';

export const managedAccountKey='mdt.auth.managed-account';
const pendingKey='mdt.auth.signin-pending';
const epochKey='mdt.auth.epoch';
const logoutKey='mdt.auth.logout-account';
let setup:Promise<{client:PublicClientApplication;scope:string}>|undefined;
async function initialize(){
 if(!setup)setup=(async()=>{
  const response=await fetch('/api/v1/auth/config',{cache:'no-store',credentials:'omit'});
  if(!response.ok)throw Error('Sign-in is not configured. Contact support.');
  const config=await response.json() as {clientId:string;authority:string;apiScope:string;applicationOrigin:string;knownAuthorities:string[]};
  if(config.applicationOrigin!==window.location.origin)throw Error('Open the configured application address to sign in.');
  const client=new PublicClientApplication({auth:{clientId:config.clientId,authority:config.authority,knownAuthorities:config.knownAuthorities,
   redirectUri:`${config.applicationOrigin}/auth/redirect`,postLogoutRedirectUri:`${config.applicationOrigin}/signin`},
   cache:{cacheLocation:'sessionStorage'},system:{loggerOptions:{loggerCallback:()=>{},piiLoggingEnabled:false}}});
  await client.initialize();return {client,scope:config.apiScope};
 })().catch(error=>{setup=undefined;throw error;});
 return setup;
}
export async function beginSignIn(){
 const previousEpoch=sessionStorage.getItem(epochKey);
 const {client,scope}=await initialize();
 if(sessionStorage.getItem(epochKey)!==previousEpoch)throw Error('The session changed. Try signing in again.');
 for(const key of ['mdt.auth.access-token','mdt.auth.organization-id',managedAccountKey])sessionStorage.removeItem(key);
 const epoch=crypto.randomUUID();sessionStorage.setItem(epochKey,epoch);sessionStorage.setItem(pendingKey,epoch);
 try{await client.loginRedirect({scopes:[scope],prompt:'select_account',redirectStartPage:`${location.origin}/signin`});}
 catch{if(sessionStorage.getItem(pendingKey)===epoch)sessionStorage.removeItem(pendingKey);throw Error('Sign-in could not start. Please try again.');}
}
export async function completeSignIn():Promise<boolean>{
 const pending=sessionStorage.getItem(pendingKey);if(!pending)return false;
 try{
  const {client}=await initialize();
  const result=await client.handleRedirectPromise();
  if(!result)return false;
  if(!result.account||!result.accessToken||sessionStorage.getItem(epochKey)!==pending)throw Error('Invalid session.');
  // Server validates the API token, identity realm and account lock before local acceptance.
  const response=await fetch('/api/v1/account',{headers:{authorization:`Bearer ${result.accessToken}`},cache:'no-store',credentials:'omit'});
  if(!response.ok||sessionStorage.getItem(epochKey)!==pending||sessionStorage.getItem(pendingKey)!==pending)throw Error('Invalid session.');
  setAccessToken(result.accessToken);sessionStorage.setItem(managedAccountKey,result.account.homeAccountId);
  client.setActiveAccount(result.account);sessionStorage.removeItem(pendingKey);return true;
 }catch{if(sessionStorage.getItem(pendingKey)===pending)sessionStorage.removeItem(pendingKey);throw Error('Sign-in could not be completed. Try again or contact support.');}
}
export async function providerSignOut(){
 const accountId=sessionStorage.getItem(logoutKey);if(!accountId)return;
 const {client}=await initialize();
 const account=client.getAccount({homeAccountId:accountId});
 // No broad account selection or automatic fallback to another cached user.
 sessionStorage.removeItem(logoutKey);
 try{await client.logoutRedirect({...(account?{account}:{}),postLogoutRedirectUri:`${location.origin}/signin`});}
 catch{sessionStorage.setItem(logoutKey,accountId);throw Error('Local sign-out is complete. Provider sign-out failed; retry below.');}
}

let renewal: {identity:string; promise:Promise<string>}|undefined;
/** Renew only the explicitly selected account. Never prompt during a mutation. */
export async function renewAccessToken():Promise<string>{
 const accountId=sessionStorage.getItem(managedAccountKey),epoch=sessionStorage.getItem(epochKey);
 if(!accountId||!epoch)throw Error('Sign in again to continue.');
 const identity=JSON.stringify([accountId,epoch]);
 if(renewal?.identity===identity)return renewal.promise;
 const current=()=>sessionStorage.getItem(managedAccountKey)===accountId&&sessionStorage.getItem(epochKey)===epoch;
 const promise=(async()=>{
  try{
   const {client,scope}=await initialize();
   if(!current())throw Error('Session changed.');
   const account=client.getAccount({homeAccountId:accountId});
   if(!account)throw Error('Account unavailable.');
   const result=await client.acquireTokenSilent({account,scopes:[scope]});
   if(!current()||result.account?.homeAccountId!==accountId||!result.accessToken)throw Error('Session changed.');
   // Same selected account/epoch: keep organization selection when the bearer rotates.
   sessionStorage.setItem('mdt.auth.access-token',result.accessToken);
   return result.accessToken;
  }catch{throw Error('Your session could not be renewed. Retry, or open Sign in to continue.');}
 })();
 const flight={identity,promise};renewal=flight;
 try{return await promise;}finally{if(renewal===flight)renewal=undefined;}
}
