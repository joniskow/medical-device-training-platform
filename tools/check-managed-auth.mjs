import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from '../apps/web/node_modules/esbuild/lib/main.js';
const dir=await mkdtemp(join(tmpdir(),'managed-auth-'));
const stub=join(dir,'sdk.mjs'),bundle=join(dir,'auth.mjs');
await writeFile(stub,`export class PublicClientApplication {
 constructor(config){globalThis.sdkConfig=config;}
 async initialize(){globalThis.initialized=true;}
 async loginRedirect(request){if(!globalThis.initialized)throw Error('Not initialized');globalThis.loginRequest=request;}
 async handleRedirectPromise(){if(!globalThis.initialized)throw Error('Not initialized');if(globalThis.sdkError)throw Error('secret-provider-diagnostic');return globalThis.authResult;}
 setActiveAccount(account){globalThis.activeAccount=account;}
 getAccount(filter){globalThis.accountFilter=filter;return {homeAccountId:filter.homeAccountId};}
 async acquireTokenSilent(request){globalThis.silentCalls=(globalThis.silentCalls??0)+1;globalThis.silentRequest=request;if(globalThis.silentGate)await globalThis.silentGate;if(globalThis.silentError)throw Error('private-renewal-diagnostic');return globalThis.silentResult;}
 async logoutRedirect(request){globalThis.logoutRequest=request;if(globalThis.logoutError)throw Error('secret-provider-diagnostic');}
}`);
const entry=join(dir,'entry.mjs');await writeFile(entry,`export * from ${JSON.stringify(resolve('apps/web/src/managed-auth.ts'))};export * from ${JSON.stringify(resolve('apps/web/src/auth-session.ts'))};`);
await build({entryPoints:[entry],outfile:bundle,bundle:true,format:'esm',platform:'node',alias:{'@azure/msal-browser':stub},logLevel:'silent'});
const values=new Map();globalThis.sessionStorage={getItem:key=>values.get(key)??null,setItem:(key,v)=>values.set(key,String(v)),removeItem:key=>values.delete(key)};
globalThis.location={origin:'https://training.example',assign:path=>{globalThis.navigation=path;}};
globalThis.window={location};globalThis.document={querySelector:()=>null};
let mode='ok',checkResponse=200;
const publicConfig={clientId:'22222222-2222-2222-2222-222222222222',authority:'https://test.ciamlogin.com/11111111-1111-1111-1111-111111111111',apiScope:'api://22222222-2222-2222-2222-222222222222/access',applicationOrigin:location.origin,knownAuthorities:['test.ciamlogin.com']};
globalThis.fetch=async(url,init)=>{
 if(url==='/api/v1/auth/config')return new Response(JSON.stringify({...publicConfig,...(mode==='origin'?{applicationOrigin:'https://other.example'}:{})}),{status:mode==='disabled'?503:200});
 assert.equal(url,'/api/v1/account');assert.deepEqual(init.headers,{authorization:'Bearer api-token'});assert.equal(init.credentials,'omit');
 if(mode==='late')sessionStorage.setItem('mdt.auth.epoch','signed-out');
 return new Response('{}',{status:checkResponse});
};
let auth=await import(pathToFileURL(bundle)+'?disabled');mode='disabled';await assert.rejects(auth.beginSignIn(),/not configured/);
mode='origin';await assert.rejects(auth.beginSignIn(),/configured application address/);
mode='ok';await auth.beginSignIn();assert.equal(sdkConfig.cache.cacheLocation,'sessionStorage');assert.equal(sdkConfig.auth.redirectUri,location.origin+'/auth/redirect');assert.deepEqual(loginRequest.scopes,[publicConfig.apiScope]);assert.equal(loginRequest.redirectStartPage,location.origin+'/signin');
assert.equal(loginRequest.prompt,'select_account');assert.equal(sdkConfig.system.loggerOptions.piiLoggingEnabled,false);
globalThis.authResult=null;await assert.rejects(auth.completeSignIn(),/could not be completed/);
assert.equal(sessionStorage.getItem('mdt.auth.signin-pending'),null);
await auth.beginSignIn();
globalThis.authResult={account:{homeAccountId:'one'},accessToken:'api-token',idToken:'never-use-id-token'};
checkResponse=403;await assert.rejects(auth.completeSignIn(),/could not be completed/);assert.equal(sessionStorage.getItem('mdt.auth.access-token'),null);
checkResponse=200;await auth.beginSignIn();mode='late';await assert.rejects(auth.completeSignIn());assert.equal(sessionStorage.getItem('mdt.auth.access-token'),null);
mode='ok';await auth.beginSignIn();sessionStorage.setItem('mdt.auth.organization-id','previous-org');assert.equal(await auth.completeSignIn(),true);assert.equal(sessionStorage.getItem('mdt.auth.access-token'),'api-token');assert.equal(sessionStorage.getItem('mdt.auth.managed-account'),'one');assert.equal(sessionStorage.getItem('mdt.auth.organization-id'),null);assert.equal(activeAccount.homeAccountId,'one');assert.equal(await auth.completeSignIn(),false);
await auth.beginSignIn();globalThis.sdkError=true;await assert.rejects(auth.completeSignIn(),error=>!error.message.includes('secret-provider'));globalThis.sdkError=false;
// Exercise the production session module independently, as different page bundles do.
const session=await import('../apps/web/dist/auth-session.js');assert.equal(session.getAccessToken(),undefined);
sessionStorage.setItem('mdt.auth.managed-account','one');sessionStorage.setItem('mdt.auth.access-token','rotated');assert.equal(session.getAccessToken(),'rotated');
session.clearAccessToken();assert.equal(session.getAccessToken(),undefined);assert.equal(navigation,'/signout');assert.equal(sessionStorage.getItem('mdt.auth.managed-account'),null);assert.equal(sessionStorage.getItem('mdt.auth.logout-account'),'one');
globalThis.logoutError=true;await assert.rejects(auth.providerSignOut(),/Provider sign-out failed/);assert.equal(sessionStorage.getItem('mdt.auth.logout-account'),'one');
globalThis.logoutError=false;await auth.providerSignOut();assert.deepEqual(accountFilter,{homeAccountId:'one'});assert.equal(logoutRequest.account.homeAccountId,'one');assert.equal(logoutRequest.postLogoutRedirectUri,location.origin+'/signin');
console.log('Managed auth controlled-SDK checks: configured redirect, API-token validation, callback/sign-out fencing, sanitized errors and pinned logout pass.');

// Renewal keeps the account/organization boundary, even with concurrent callers.
sessionStorage.setItem('mdt.auth.managed-account','one');sessionStorage.setItem('mdt.auth.epoch','renew-epoch');sessionStorage.setItem('mdt.auth.access-token','old');sessionStorage.setItem('mdt.auth.organization-id','org-one');
globalThis.silentResult={account:{homeAccountId:'one'},accessToken:'renewed',idToken:'not-an-api-token'};
let release;globalThis.silentGate=new Promise(r=>release=r);globalThis.silentCalls=0;
const first=auth.renewAccessToken(),second=auth.renewAccessToken();await new Promise(r=>setTimeout(r,0));assert.equal(silentCalls,1);release();assert.deepEqual(await Promise.all([first,second]),['renewed','renewed']);globalThis.silentGate=undefined;
assert.equal(sessionStorage.getItem('mdt.auth.organization-id'),'org-one');assert.equal(silentRequest.account.homeAccountId,'one');assert.deepEqual(silentRequest.scopes,[publicConfig.apiScope]);
let sent=0;globalThis.fetch=async(url,init)=>{sent++;assert.equal(new Headers(init.headers).get('authorization'),'Bearer renewed');assert.equal(init.credentials,'omit');assert.equal(init.redirect,'error');return new Response('{}',{status:403});};
assert.equal((await auth.authenticatedFetch('/api/v1/test',{method:'POST',headers:{'idempotency-key':'stable'},body:'{}'})).status,403);assert.equal(sent,1,'Request was replayed');
await assert.rejects(auth.authenticatedFetch('https://foreign.example/api/v1/test'));assert.equal(sent,1);
globalThis.silentError=true;await assert.rejects(auth.authenticatedFetch('/api/v1/test'),e=>!e.message.includes('private-renewal'));assert.equal(sent,1);globalThis.silentError=false;
globalThis.silentResult={account:{homeAccountId:'other'},accessToken:'wrong'};await assert.rejects(auth.renewAccessToken());assert.equal(sessionStorage.getItem('mdt.auth.access-token'),'renewed');
globalThis.silentResult={account:{homeAccountId:'one'},accessToken:'late-token'};globalThis.silentGate=new Promise(r=>release=r);
const late=auth.authenticatedFetch('/api/v1/test');await new Promise(r=>setTimeout(r,0));auth.clearAccessToken();release();await assert.rejects(late);globalThis.silentGate=undefined;assert.equal(auth.getAccessToken(),undefined);assert.equal(sent,1);
// A context switch while renewal waits must not send the old operation in the new organization.
sessionStorage.setItem('mdt.auth.managed-account','one');sessionStorage.setItem('mdt.auth.epoch','next');sessionStorage.setItem('mdt.auth.access-token','old');sessionStorage.setItem('mdt.auth.organization-id','org-one');
globalThis.silentGate=new Promise(r=>release=r);const switched=auth.authenticatedFetch('/api/v1/test');await new Promise(r=>setTimeout(r,0));sessionStorage.setItem('mdt.auth.organization-id','org-two');release();await assert.rejects(switched);assert.equal(sent,1);globalThis.silentGate=undefined;
console.log('Silent renewal checks: single flight, exact account/scope, organization preservation, failure privacy, no replay, destination restriction and sign-out/context fencing pass.');
