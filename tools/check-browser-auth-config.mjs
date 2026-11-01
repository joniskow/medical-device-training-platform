import assert from 'node:assert/strict';
import {readBrowserAuthConfig} from '../apps/api/dist/browser-auth-config.js';
import {createJobStatusHttpServer} from '../apps/api/dist/job-status-http.js';
const tenant='11111111-1111-1111-1111-111111111111';
const client='22222222-2222-2222-2222-222222222222';
const env={BROWSER_AUTH_ENABLED:'true',ENTRA_TENANT_ID:tenant,BROWSER_AUTH_CLIENT_ID:client,BROWSER_AUTH_AUTHORITY:`https://example.ciamlogin.com/${tenant}`,BROWSER_AUTH_API_SCOPE:`api://${client}/user_impersonation`,APPLICATION_ORIGIN:'https://training.example',CLIENT_SECRET:'must-not-be-public'};
assert.equal(readBrowserAuthConfig({}),undefined);
assert.equal(readBrowserAuthConfig({...env,BROWSER_AUTH_ENABLED:'false'}),undefined);
const config=readBrowserAuthConfig(env);
assert.deepEqual(config.knownAuthorities,['example.ciamlogin.com',`${tenant}.ciamlogin.com`]);
assert.equal(readBrowserAuthConfig({...env,BROWSER_AUTH_AUTHORITY:`https://login.microsoftonline.com/${tenant}/`}).authority,`https://login.microsoftonline.com/${tenant}`);
assert.equal(readBrowserAuthConfig({...env,APPLICATION_ORIGIN:'http://localhost:8080'}).applicationOrigin,'http://localhost:8080');
for(const [key,value] of [
 ['BROWSER_AUTH_ENABLED','yes'],['BROWSER_AUTH_CLIENT_ID','bad'],['ENTRA_TENANT_ID','common'],
 ['BROWSER_AUTH_AUTHORITY',`https://example.ciamlogin.com.evil.example/${tenant}`],
 ['BROWSER_AUTH_AUTHORITY',`https://user:secret@example.ciamlogin.com/${tenant}`],
 ['BROWSER_AUTH_AUTHORITY',`https://example.ciamlogin.com/${client}`],
 ['BROWSER_AUTH_AUTHORITY',`https://example.ciamlogin.com/${tenant}?redirect=evil`],
 ['BROWSER_AUTH_AUTHORITY',`http://example.ciamlogin.com/${tenant}`],
 ['APPLICATION_ORIGIN','https://training.example/path'],['APPLICATION_ORIGIN','http://training.example'],
 ['APPLICATION_ORIGIN','https://training.example/#evil'],['BROWSER_AUTH_API_SCOPE',`api://${client}/read openid`],
 ['BROWSER_AUTH_API_SCOPE','https://graph.microsoft.com/User.Read']
]) assert.throws(()=>readBrowserAuthConfig({...env,[key]:value}),undefined,key);
for(const configured of [false,true]){
 const server=createJobStatusHttpServer({staticRoot:'apps/web/dist',browserAuthConfig:configured?{...config,secret:'must-not-be-public'}:undefined,
 authenticator:{authenticate:async()=>{throw new Error('Public config must precede authentication');}},
 organizationContextResolver:{resolveActiveOrganizations:async()=>[]},statusService:{get:async()=>null,retry:async()=>null}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const url=`http://127.0.0.1:${server.address().port}/api/v1/auth/config`;
  const response=await fetch(url);assert.equal(response.status,configured?200:503);
  assert.equal(response.headers.get('cache-control'),'no-store');
  const body=await response.json();if(configured)assert.deepEqual(body,config);
  assert.equal(JSON.stringify(body).includes('must-not-be-public'),false);
  assert.equal((await fetch(url,{method:'POST'})).status,405);
  for(const route of ['/signin','/signout','/auth/redirect','/auth/redirect.js','/author/signin.js']){
   const page=await fetch(new URL(route,url));assert.equal(page.status,200,route);
   assert.equal(page.headers.has('cross-origin-opener-policy'),false);
   const csp=page.headers.get('content-security-policy');assert.ok(csp.includes("script-src 'self'"));
   if(configured)assert.ok(csp.includes('https://example.ciamlogin.com'));
   if(route==='/auth/redirect'){
    assert.equal(page.headers.get('x-frame-options'),'SAMEORIGIN');
    if(configured)assert.ok(csp.includes("frame-ancestors 'self'"));
    assert.ok((await page.text()).includes('/auth/redirect.js'));
   }
  }
 }finally{await new Promise(resolve=>server.close(resolve));}
}
console.log('Browser auth configuration: validated authority/origin/scope, disabled mode, public allowlist and HTTP methods pass.');
