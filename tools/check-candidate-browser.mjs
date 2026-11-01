import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';

const exercise=String.raw`
const wait=()=>new Promise(r=>setTimeout(r,60)),q=s=>document.querySelector(s),check=(v,m)=>{if(!v)throw Error(m)};
const scenario=new URLSearchParams(location.search).get('scenario');
const course={publicId:'11111111-1111-1111-1111-111111111111',revision:3,title:'<img src=x> Device',issuerName:'Example issuer',audience:'Candidates',productScope:'Device',prerequisites:'None',issuerStatement:'Product training',intendedUse:'Not licensure',accessibilityPath:'Text and keyboard',estimatedMinutes:30,costDesignation:'free-in-MVP',enrollmentNotice:{version:'candidate-notice.v2',text:'Review this notice. <img src=x> Sharing is separate.'}};
const result={organizationId:'issuer:test',enrollmentId:'enrollment:test'};
let outcome='interrupted',calls=[],releasePending;
const submit=()=>{q('#enrollment-consent').checked=true;q('form').requestSubmit();};
window.fetch=async(url,init={})=>{
 if(url.startsWith('/api/v1/catalog')){check(init.credentials==='omit'&&!init.headers,'Public catalog sent credentials');return new Response(JSON.stringify(course));}
 const headers=new Headers(init.headers);check(headers.get('authorization')==='Bearer test','Missing bearer');check(!headers.has('x-organization-id')&&init.credentials==='omit','Candidate request supplied issuer/cookies');
 if(url.startsWith('/api/v1/my-candidate-enrollments')){
  if(outcome==='pending')return new Promise(r=>releasePending=r);
  if(outcome==='fail')return new Response('{}',{status:503});
  return new Response(JSON.stringify({items:[{...result,title:course.title,issuerName:course.issuerName}],nextCursor:url.includes('after=')?null:'next'}));
 }
 check(url==='/api/v1/candidate-enrollments','Unexpected request');calls.push({key:headers.get('idempotency-key'),body:JSON.parse(init.body)});
 check(JSON.stringify(calls.at(-1).body)===JSON.stringify({publicId:course.publicId,revision:3,noticeVersion:'candidate-notice.v2',confirmed:true}),'Enrollment supplied wrong authority fields');
 if(outcome==='interrupted')throw Error('Interrupted response');
 if(outcome==='pending')return new Promise(r=>releasePending=r);
 return new Response(JSON.stringify(result),{status:outcome==='stale'?409:200});
};
try{
 const auth=await import('/auth-session.js');
 auth.rememberCandidateCourse(course.publicId);check(auth.pendingCandidateCourseUrl()==='/catalog?course='+course.publicId,'Return course absent');
 for(const value of [{publicId:'https://evil.invalid',createdAt:Date.now()},{publicId:course.publicId,createdAt:Date.now()-1800001},{publicId:course.publicId,createdAt:Date.now()+10000}]){sessionStorage.setItem('mdt.auth.return-course',JSON.stringify(value));check(!auth.pendingCandidateCourseUrl(),'Unsafe/expired return accepted');}
 auth.clearAccessToken();auth.rememberCandidateCourse('https://evil.invalid');check(!auth.pendingCandidateCourseUrl(),'Arbitrary return URL accepted');
 if(scenario==='training'){
  await import('/candidate-training.js');await wait();check(q('#message').textContent.includes('Sign in'),'Anonymous training not denied');
  auth.setAccessToken('test');outcome='success';q('#reload').click();await wait();check(q('#courses').children.length===1&&!q('#courses img'),'Unsafe training');
  q('#more').click();await wait();check(q('#courses').children.length===2&&q('#more').hidden,'Training paging failed');
  outcome='fail';q('#reload').click();await wait();check(!q('#courses').children.length&&q('#message').textContent.includes('could not'),'Training error retained old courses');
  outcome='pending';q('#reload').click();await wait();q('#sign-out').click();releasePending(new Response(JSON.stringify({items:[result]})));await wait();check(!q('#courses').children.length&&q('#message').textContent==='Signed out.','Late training response restored content');
  auth.setAccessToken('test');outcome='success';q('#reload').click();await wait();auth.setAccessToken('different');q('#courses button').click();check(!q('#courses').children.length,'Changed identity kept private list');
  auth.setAccessToken('test');q('#reload').click();await wait();sessionStorage.setItem('candidate.navigation','training');q('#courses button').click();
 }else{
  auth.setAccessToken('test');history.replaceState({},'', '?course='+course.publicId);await import('/catalog.js');await wait();
  check(!q('#enrollment-consent').checked&&q('#enrollment-consent').required,'Consent default/required incorrect');check(!q('#courses img'),'Unsafe disclosure');
  q('form').requestSubmit();await wait();check(calls.length===0,'Unchecked consent submitted');
  submit();await wait();check(calls.length===1&&!q('form button').disabled,'Interrupted enrollment not retryable');
  outcome='stale';submit();await wait();check(calls.length===2&&calls[0].key===calls[1].key&&calls[0].key,'Retry key changed');check(!q('#enrollment-consent').checked&&q('#enrollment-consent').disabled,'Stale disclosure retained consent');
  q('#reload').click();await wait();check(!q('#enrollment-consent').checked&&!q('#enrollment-consent').disabled,'Refresh did not require new consent');
  outcome='pending';submit();await wait();check(calls[2].key!==calls[1].key,'Fresh review reused old request');auth.rememberCandidateCourse(course.publicId);q('#sign-out').click();releasePending(new Response(JSON.stringify(result)));await wait();check(!q('#courses').children.length&&!auth.pendingCandidateCourseUrl(),'Sign-out retained enrollment/return state');
  auth.setAccessToken('test');q('#reload').click();await wait();outcome='success';submit();await wait();check(q('form').textContent.includes('Sharing and discovery remain separate'),'Enrollment success missing');
  check(document.documentElement.scrollWidth<=innerWidth,'Horizontal overflow');sessionStorage.setItem('candidate.navigation','enrollment');q('form button').click();
 }
}catch(error){document.body.dataset.testResult='FAIL';document.body.append(String(error));}
`;
const destination=String.raw`try{if(location.search!=='?enrollment=enrollment%3Atest'||sessionStorage.getItem('mdt.auth.organization-id')!=='issuer:test'||!sessionStorage.getItem('candidate.navigation'))throw Error('Incorrect enrollment route/issuer');document.body.dataset.testResult='PASS';}catch(error){document.body.dataset.testResult='FAIL';document.body.append(String(error));}`;
const server=createServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://localhost');
 if(url.pathname==='/exercise.js'||url.pathname==='/destination.js'){res.setHeader('content-type','text/javascript');res.end(url.pathname==='/exercise.js'?exercise:destination);return;}
 if(url.pathname==='/learner/courses'){res.setHeader('content-type','text/html');res.end('<body><script src="/destination.js"></script></body>');return;}
 if(url.pathname==='/'){const name=url.searchParams.get('scenario')==='training'?'candidate-training':'catalog';res.setHeader('content-type','text/html');res.end((await readFile('apps/web/dist/'+name+'.html','utf8')).replace(/<script[^>]*src="[^"]+"[^>]*><\/script>/g,'')+'<script type="module" src="/exercise.js"></script>');return;}
 if(['/catalog.js','/candidate-training.js','/auth-session.js'].includes(url.pathname)){res.setHeader('content-type','text/javascript');res.end(await readFile('apps/web/dist'+url.pathname));return;}
 res.writeHead(404).end();
}catch{res.writeHead(500).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
try{
 for(const scenario of ['enrollment','training']){
  const profile=await mkdtemp(join(tmpdir(),'mdt-candidate-'));
  const child=spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',['--headless=new','--window-size=320,800',`--user-data-dir=${profile}`,'--dump-dom','--virtual-time-budget=7000',`http://127.0.0.1:${server.address().port}/?scenario=${scenario}`],{windowsHide:true});
  let output='';child.stdout.on('data',x=>output+=x);child.stderr.resume();const timer=setTimeout(()=>child.kill(),30000);
  try{await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});}finally{clearTimeout(timer);}
  assert.match(output,/data-test-result="PASS"/,scenario+': '+output.slice(-2500));
 }
 console.log('Candidate Chrome passed: explicit consent, stable retry, stale disclosure, return validation, sign-out fencing, private training paging and issuer-bound navigation.');
}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
