import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile,mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
const exercise=`
sessionStorage.setItem('mdt.auth.access-token','test');
sessionStorage.setItem('mdt.auth.organization-id','org:test');
const submissions=[];let delay=false;const resetKeys=[];let resetDone=false;const invalidationKeys=[];let invalidated=false;const reviewKeys=[];let reviewed=false;
const lifecycleKeys=[];let superseded=false;window.confirm=()=>true;
const recoveryKeys=[];let recovered=false;
window.fetch=async(url,init={})=>{
 if(url.startsWith('/api/')&&init.headers['x-organization-id']!=='org:test')throw Error('Selected organization was not forwarded');
 if(url.startsWith('/api/v1/course-changes/'))return new Response(JSON.stringify({title:'Updated training',totalAffected:2,change:{effectiveAt:'2026-11-01T00:00:00.000Z',learnerMessage:'Complete the updated course',decision:'full_retake'},jobs:[{kind:'assignments',state:'PUBLISHED',processed:1,skipped:1}],items:url.includes('after=')?[{learnerId:'removed',membershipActive:false,targetEnrollmentStatus:null,previousCredentialCount:1}]:[{learnerId:'learner',membershipActive:true,targetEnrollmentStatus:'ACTIVE',previousCredentialCount:1}],nextCursor:url.includes('after=')?null:'learner'}));
 if(delay)await new Promise(r=>setTimeout(r,150));
 if(url.startsWith('/api/v1/course-change-jobs/')&&url.endsWith('/retry')){recoveryKeys.push(init.headers['idempotency-key']);const body=JSON.parse(init.body);check(Object.keys(body).sort().join(',')==='reason,retryToken','Recovery supplied authority fields');recovered=true;if(recoveryKeys.length===1)throw Error('Recovery response interrupted');return new Response(JSON.stringify({state:'PENDING'}));}
 if(url.startsWith('/api/v1/course-change-jobs'))return new Response(JSON.stringify({items:recovered?[]:[{jobId:url.includes('after=')?'job:2':'job:1',kind:'<img src=x> course.change.notify',attempts:5,errorCode:'DELIVERY_FAILED',processed:50,skipped:1,retryToken:'a'.repeat(64)}],nextCursor:recovered||url.includes('after=')?null:'job:1'}));
 if(url.startsWith('/api/v1/attempts?'))return new Response(JSON.stringify({items:[{kind:'assessment',attemptId:'attempt',activityId:'quiz',attemptNumber:1,status:invalidated?'INVALIDATED':'PASSED',previewToken:'a'.repeat(64),affectedCredentials:invalidated?[]:[{credentialId:'old',status:'ACTIVE'}]}],nextCursor:null}));
 if(url.endsWith('/invalidate')){invalidationKeys.push(init.headers['idempotency-key']);invalidated=true;if(invalidationKeys.length===1)throw Error('Invalidation response interrupted');return new Response(JSON.stringify({status:'INVALIDATED'}));}
 if(url.startsWith('/api/v1/attempt-reviews?')&&url.includes('mode=reset'))return new Response(JSON.stringify({items:resetDone?[]:[{enrollmentId:'enrollment',activityId:'quiz',title:'Safety',activityTitle:'Procedure',throughAttempt:2,maxAttempts:3}],nextCursor:null}));
 if(url.endsWith('/reset')){resetKeys.push(init.headers['idempotency-key']);resetDone=true;if(resetKeys.length===1)throw Error('Reset response interrupted');return new Response(JSON.stringify({status:'ALLOWANCE_RESET'}));}
 if(url.startsWith('/api/v1/attempt-reviews?'))return new Response(JSON.stringify({items:reviewed?[]:[{enrollmentId:'enrollment',activityId:'quiz',title:'Safety',activityTitle:'Procedure',throughAttempt:2}],nextCursor:null}));
 if(url.startsWith('/api/v1/attempt-reviews/')){reviewKeys.push(init.headers['idempotency-key']);reviewed=true;if(reviewKeys.length===1)throw Error('Review response interrupted');return new Response(JSON.stringify({status:'REVIEWED'}));}
 if(url.startsWith('/api/v1/credentials?'))return new Response(JSON.stringify({items:[{credentialId:'old',title:'Training',status:superseded?'SUPERSEDED':'EXPIRED',courseId:'course',courseVersionId:'v1',issuedAt:'2025-01-01'},{credentialId:'new',title:'Updated training',status:'ACTIVE',courseId:'course',courseVersionId:'v2',issuedAt:'2026-01-01'}],nextCursor:null}));
 if(url.endsWith('/supersede')){lifecycleKeys.push(init.headers['idempotency-key']);superseded=true;if(lifecycleKeys.length===1)throw Error('Lifecycle response interrupted');return new Response(JSON.stringify({status:'SUPERSEDED'}));}
 if(init.method==='POST'){submissions.push(JSON.parse(init.body));if(submissions.length===1)throw Error('Connection interrupted');return new Response(JSON.stringify({status:'ACTIVE'}));}
 if(url.includes('kind=members'))return new Response(JSON.stringify(url.includes('after=')?{items:[{learnerId:'second'}],nextCursor:null}:{items:[{learnerId:'learner'}],nextCursor:'learner'}));
 return new Response(JSON.stringify({items:[{releaseId:'release:test',courseVersionId:'course:v1',title:'<img src=x> Training'}],nextCursor:null}));
};
await import('/author/assignments.js');
const wait=()=>new Promise(r=>setTimeout(r,40)),q=s=>document.querySelector(s),check=(v,m)=>{if(!v)throw Error(m)};
try{
 await wait();check(!q('#choices').disabled,'Choices unavailable');check(!document.querySelector('img'),'Unsafe title HTML');
 q('#more-members').click();await wait();check(q('#member').options.length===3,'Member paging failed');
 q('#member').value='second';q('#release').value='release:test';q('#assign').click();await wait();
 check(q('#message').textContent.includes('retry safely'),'Missing retry guidance');check(q('#member').value==='second','Selection lost');
 q('#assign').click();await wait();check(JSON.stringify(submissions[0])===JSON.stringify(submissions[1]),'Retry changed target');
 check(Object.keys(submissions[0]).sort().join(',')==='learnerId,releaseId','Spoofable scope sent');
 check(q('#message').textContent.includes('is assigned to second'),'Missing success');
 q('#load-credentials').click();await wait();
 const form=q('#credential-admin form'),action=form.querySelector('select'),replacement=form.querySelector('select[data-replacement-for]');
 action.value='supersede';action.dispatchEvent(new Event('change'));replacement.value='new';form.querySelector('textarea').value='Completed updated training';
 form.querySelector('button').click();await wait();check(q('#message').textContent.includes('retry the same request'),'Missing lifecycle retry guidance');
 form.querySelector('button').click();await wait();check(lifecycleKeys.length===2&&lifecycleKeys[0]===lifecycleKeys[1],'Lifecycle retry changed key');
 check(q('#credential-admin').textContent.includes('SUPERSEDED'),'Updated credential status missing');
 q('#load-reviews').click();await wait();const reviewForm=q('#attempt-reviews form');reviewForm.querySelector('textarea').value='Reviewed missed instruction';reviewForm.querySelector('button').click();await wait();check(q('#message').textContent.includes('Review response interrupted'),'Missing review retry error');reviewForm.querySelector('button').click();await wait();check(reviewKeys.length===2&&reviewKeys[0]===reviewKeys[1],'Review retry changed key');check(q('#attempt-reviews').textContent.includes('No required reviews'),'Resolved review remained');
 q('#load-resets').click();await wait();check(q('#attempt-reviews').textContent.includes('reset grants 3 attempts'),'Reset allowance preview missing');const resetForm=q('#attempt-reviews form');resetForm.querySelector('textarea').value='Remedial practice completed';resetForm.querySelector('button').click();await wait();check(q('#message').textContent.includes('Reset response interrupted'),'Reset retry error missing');resetForm.querySelector('button').click();await wait();check(resetKeys.length===2&&resetKeys[0]===resetKeys[1],'Reset retry changed identity');check(q('#attempt-reviews').textContent.includes('No attempts currently qualify'),'Reset completion missing');
 q('#load-attempts').click();await wait();check(q('#attempt-admin').textContent.includes('Credentials to revoke: old'),'Impact preview missing');const invalidationForm=q('#attempt-admin form');invalidationForm.querySelector('textarea').value='Corrupt evidence';invalidationForm.querySelector('button').click();await wait();check(q('#message').textContent.includes('Invalidation response interrupted'),'Invalidation error missing');invalidationForm.querySelector('button').click();await wait();check(invalidationKeys.length===2&&invalidationKeys[0]===invalidationKeys[1],'Invalidation retry changed key');check(q('#attempt-admin').textContent.includes('INVALIDATED')&&!q('#attempt-admin form'),'Invalidation view stale');
 q('#load-impact').click();await wait();check(q('#course-impact').textContent.includes('2 affected learners')&&q('#course-impact').textContent.includes('skipped 1'),'Impact status missing');q('#more-impact').click();await wait();check(q('#course-impact').textContent.includes('membership inactive'),'Affected learner paging missing');
 q('#load-failed-jobs').click();await wait();check(q('#failed-jobs').textContent.includes('Completed 50'),'Recovery checkpoint missing');check(!q('#failed-jobs img'),'Unsafe recovery text');q('#more-failed-jobs').click();await wait();check(q('#failed-jobs').querySelectorAll('form').length===2,'Recovery paging missing');
 const recoveryForm=q('#failed-jobs form');recoveryForm.querySelector('textarea').value='Restored service';recoveryForm.querySelector('button').click();await wait();check(q('#message').textContent.includes('Recovery response interrupted'),'Recovery retry error missing');recoveryForm.querySelector('button').click();await wait();check(recoveryKeys.length===2&&recoveryKeys[0]===recoveryKeys[1],'Recovery retry changed key');check(q('#failed-jobs').textContent.includes('No failed'),'Recovered job remained');
 delay=true;q('#load-failed-jobs').click();q('#refresh').click();q('#sign-out').click();await new Promise(r=>setTimeout(r,200));
 check(!q('#member').options.length&&!q('#release').options.length,'Late response restored private choices');check(q('#choices').disabled,'Signed-out form enabled');check(!sessionStorage.getItem('mdt.auth.access-token'),'Token retained');
 check(!q('#credential-admin').textContent&&!q('#course-impact').textContent&&!q('#failed-jobs').textContent,'Administration retained after sign-out');
 document.body.dataset.testResult='PASS';
}catch(error){document.body.dataset.testResult='FAIL: '+error.message;}
`;
const server=createServer(async(req,res)=>{try{
 if(req.url==='/exercise.js'){res.setHeader('content-type','text/javascript');res.end(exercise);return;}
 if(req.url==='/'){res.setHeader('content-type','text/html');res.end((await readFile('apps/web/dist/assignments.html','utf8')).replace(/<script[^>]*src="[^"]+"[^>]*><\/script>/g,'')+'<script type="module" src="/exercise.js"></script>');return;}
 const file={'/author/assignments.js':'assignments.js','/author/auth-session.js':'auth-session.js'}[req.url];if(!file){res.writeHead(404).end();return;}res.setHeader('content-type','text/javascript');res.end(await readFile(join('apps/web/dist',file)));
}catch{res.writeHead(500).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
try{
 const profile=await mkdtemp(join(tmpdir(),'mdt-assignment-'));
 const child=spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',['--headless=new',`--user-data-dir=${profile}`,'--dump-dom','--virtual-time-budget=5000',`http://127.0.0.1:${server.address().port}`],{windowsHide:true});
 let output='';child.stdout.on('data',x=>output+=x);child.stderr.resume();const timer=setTimeout(()=>child.kill(),30000);
 try{await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});}finally{clearTimeout(timer);}
 assert.match(output,/data-test-result="PASS"/,output.slice(-2200));
 console.log('Assignment browser passed: member/course choices, pagination, inert titles, interrupted retry, server confirmation and sign-out during pending reads.');
}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
