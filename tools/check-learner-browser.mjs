import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile,mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const webRequire=createRequire(new URL('../apps/web/package.json',import.meta.url));
const decoder=(await webRequire('esbuild').build({entryPoints:[webRequire.resolve('jsqr')],bundle:true,format:'esm',platform:'browser',write:false})).outputFiles[0].text;
const exercise=`
sessionStorage.setItem('mdt.auth.access-token','test');
sessionStorage.setItem('mdt.auth.organization-id','org:test');
const keys=[],submissions=[];let starts=0;
let issued=false,issuanceCalls=0;
let acknowledgementCalls=0,guidanceUnavailable=false,noticeRead=false;
const credential={credentialId:'credential:test',title:'Device training credential',status:'ACTIVE',issuedAt:'2026-10-30T12:00:00Z',expiresAt:null,intendedUse:'Organization-issued training credential'};
credential.verificationEnabled=true;credential.publicId='a'.repeat(43);
credential.verificationAllowed=true;credential.sharingRevision=0;window.confirm=()=>true;
const sharingKeys=[];
const course={enrollmentId:'enrollment:test',releaseId:'release:test',title:'Assigned device training',assessmentSessions:[],content:{modules:[{title:'Module',activities:[{activityId:'read',type:'rich_text',title:'Read',instructions:'Instructions',text:'<img src=x onerror=alert(1)> Safe text'},{activityId:'quiz',type:'multiple_choice',title:'Quiz'}]}]}};
const session={sessionId:'session:test',enrollmentId:'enrollment:test',activityId:'quiz',status:'IN_PROGRESS',attemptNumber:1,expiresAt:'2099-01-01',assessment:{questions:[{questionId:'single',type:'multiple_choice',prompt:'Single',options:[{optionId:'a',text:'First'},{optionId:'b',text:'Second'}]},{questionId:'multi',type:'multi_select',prompt:'Multi',options:[{optionId:'a',text:'One'},{optionId:'b',text:'Two'}]},{questionId:'order',type:'ordered_step',prompt:'Order',options:[{optionId:'b',text:'Finish'},{optionId:'a',text:'Start'}]}]}};
window.fetch=async(url,init={})=>{
 if(url.startsWith('/api/')&&init.headers['x-organization-id']!=='org:test')throw Error('Selected organization was not forwarded');
 if(url==='/api/v1/notifications')return new Response(JSON.stringify({items:[{notificationId:'notice:test',enrollmentId:'enrollment:test',title:'Updated training',message:'<img src=x> Review the new procedure.',releaseNotes:'Procedure updated',effectiveAt:'2026-11-01T00:00:00.000Z',decision:'full_retake',read:noticeRead},{notificationId:'notice:credential',kind:'credential',title:'<img src=x> Training',message:'A training credential was issued.',lifecycleEvent:'ISSUED',occurredAt:'2026-10-30T12:00:00.000Z',currentStatus:'REVOKED',read:true}],nextCursor:null}));
 if(url.endsWith('/read')){noticeRead=true;return new Response(JSON.stringify({read:true}));}
 if(url.endsWith('/acknowledge')){check(init.method==='POST'&&init.body==='{}','Acknowledgement supplied authority fields');acknowledgementCalls++;if(acknowledgementCalls===1)throw Error('Acknowledgement interrupted');course.progress.push({activityId:'read',status:'ACKNOWLEDGED'});return new Response(JSON.stringify({activityId:'read',status:'ACKNOWLEDGED'}));}
 if(url.endsWith('/sharing')){sharingKeys.push(init.headers['idempotency-key']);const body=JSON.parse(init.body);credential.verificationEnabled=body.enabled;credential.sharingRevision++;if(sharingKeys.length===1)throw Error('Sharing response interrupted');return new Response(JSON.stringify(credential));}
 if(url.startsWith('/api/v1/credentials'))return new Response(JSON.stringify({items:issued?[credential]:[],nextCursor:null}));
 if(url.endsWith('/credential')){issuanceCalls++;issued=true;if(issuanceCalls===1)throw Error('Credential response interrupted');return new Response(JSON.stringify(credential));}
 if(url==='/api/v1/enrollments')return new Response(JSON.stringify({items:[course],nextCursor:null}));
 if(url.startsWith('/api/v1/enrollments/')){if(guidanceUnavailable)throw Error('Guidance unavailable');return new Response(JSON.stringify(course));}
 if(url.endsWith('/submit')){submissions.push(JSON.parse(init.body));if(submissions.length===1)throw Error('Interrupted submission');return new Response(JSON.stringify({...session,status:'PASSED',result:{score:3,maxScore:3}}));}
 if(init.method==='POST'){keys.push(init.headers['idempotency-key']);if(++starts===1)throw Error('Interrupted start');return new Response(JSON.stringify(session));}
 return new Response(JSON.stringify(session));
};
history.replaceState({},'', '?enrollment=enrollment%3Atest');
await import('/learner/learner.js');
course.progress=[{activityId:'quiz',status:'FAILED',score:1,maxScore:3}];
course.content.modules[0].moduleId='update';
course.content.modules.push({moduleId:'reference',title:'Reference',activities:[]});
course.eligibility={configurationValid:true,eligible:false,requalification:{sourceCredentialId:'credential:old',updateModuleIds:['update']},activities:[{activityId:'quiz',passed:false,reviewRequired:true}]};
const wait=()=>new Promise(r=>setTimeout(r,40)),q=s=>document.querySelector(s),check=(v,m)=>{if(!v)throw Error(m)};
const click=text=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent===text);check(b,'Missing button '+text);b.click();};
try{
 await wait();check(!q('#course').hidden&&q('#course').textContent.includes('Assigned device training'),'Deep-linked enrollment did not open');check(q('#courses').children.length>0&&q('#credentials').textContent.includes('My training credentials'),'Deep link discarded list/wallet');check(q('#notices').textContent.includes('Review the new procedure.'),'Notice missing');check(!q('#notices img'),'Unsafe notice text');check(q('#notices').textContent.includes('Current status: REVOKED'),'Current credential status missing');check(!q('#notices').textContent.includes('Invalid Date'),'Credential notice used course-change date');click('View credential wallet');await wait();click('Open assigned updated course');await wait();check(!q('#course').hidden,'Assigned course notice did not open course');click('Mark notice as read');await wait();check(q('#notices').textContent.includes('Read'),'Read notice not refreshed');click('Assigned device training');await wait();
 check(q('#course').textContent.includes('Latest attempt: FAILED · 1 / 3'),'Missing server progress');
 check(q('#course').textContent.includes('administrator review is required'),'Missing certification guidance');
 check(q('#course').textContent.includes('current source-course credential'),'Missing update qualification explanation');
 check(q('#course').textContent.includes('Required update module')&&q('#course').textContent.includes('Reference module: not required for this update'),'Update/reference module distinction missing');
 check(q('#course').textContent.includes('Safe text'),'Missing source text');check(!q('#course img'),'Unsafe HTML rendered');
 click('Mark as reviewed');await wait();check(q('#message').textContent.includes('Acknowledgement interrupted'),'Missing acknowledgement error');click('Mark as reviewed');await wait();check(q('#course').textContent.includes('You marked this reading as reviewed.'),'Missing reading completion');check(![...q('#course').querySelectorAll('button')].some(b=>b.textContent==='Mark as reviewed'),'Acknowledgement control remained');
 click('Start assessment');await wait();check(q('#message').textContent.includes('Interrupted'),'Missing failure');click('Start assessment');await wait();
 check(keys.length===2&&keys[0]===keys[1],'Start retry lost idempotency key');
 q('input[name=single][value=b]').click();q('input[name=multi][value=a]').click();q('input[name=multi][value=b]').click();click('Move Start up');
 click('Submit answers');await wait();check(q('#message').textContent.includes('Interrupted'),'Missing submission failure');click('Submit answers');await wait();
 check(JSON.stringify(submissions[0])===JSON.stringify(submissions[1]),'Submission retry changed answers');
 check(submissions[0].answers[2].selectedOptionIds.join(',')==='a,b','Incorrect ordered step submission');
 check(q('#assessment').textContent.includes('PASSED: 3 / 3'),'Server result missing');
 course.eligibility={configurationValid:true,eligible:true,activities:[]};click('Assigned device training');await wait();click('Get my training credential');await wait();click('Get my training credential');await wait();
 check(issuanceCalls===2,'Issuance retry missing');check(q('#credentials').textContent.includes('Device training credential'),'Credential wallet missing');
 check(q('#credentials a').getAttribute('href').endsWith('/verify?credential='+credential.publicId),'Opaque public sharing link missing');
 click('Show verification QR');await wait();
 const {default:decode}=await import('/qr-decoder.js');const canvas=q('#credentials canvas'),pixels=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height);
 const decoded=decode(pixels.data,pixels.width,pixels.height);check(decoded?.data===q('#credentials a').href,'QR did not decode to the exact public URL');
 check(!decoded.data.includes('credential:test')&&!decoded.data.includes('test@'),'QR leaked private identifiers');
 click('Disable public sharing');await wait();click('Disable public sharing');await wait();
 check(sharingKeys.length===2&&sharingKeys[0]===sharingKeys[1],'Sharing retry key changed');check(!q('#credentials a')&&!q('#credentials canvas'),'Disabled sharing retained link or QR');
 click('Enable public sharing');await wait();check(q('#credentials a'),'Restored sharing link missing');
 course.assessmentSessions=[{activityId:'quiz',sessionId:'session:test',status:'FAILED'}];
 session.status='FAILED';session.result={score:1,maxScore:3,demonstratedCompetencyIds:['safe-selection'],missedCompetencyIds:['procedure-order','<img src=x>']};
 const requirement={activityId:'quiz',passed:false,attemptsUsed:1,maxAttempts:3,reviewRequired:false,retryEligible:false,retryBlockedReasons:['COOLDOWN'],retryAt:Date.now()+60000};
 course.eligibility={configurationValid:true,eligible:false,activities:[requirement]};
 click('Assigned device training');await wait();click('View / resume latest attempt');await wait();
 check(q('#assessment').textContent.includes('Demonstrated competencies')&&q('#assessment').textContent.includes('procedure-order'),'Competency remediation missing');check(!q('#assessment img'),'Unsafe competency rendering');
 check(q('#assessment').textContent.includes('waiting period ends'),'Cooldown guidance missing');check(![...q('#assessment').querySelectorAll('button')].some(b=>b.textContent==='Start next assessment attempt'),'Cooldown permitted UI retry');
 requirement.retryBlockedReasons=['ATTEMPT_LIMIT'];click('Refresh result guidance');await wait();check(q('#assessment').textContent.includes('used all allowed attempts'),'Attempt limit guidance missing');
 requirement.reviewRequired=true;click('Refresh result guidance');await wait();check(q('#assessment').textContent.includes('content review and remediation'),'Review guidance missing');
 requirement.reviewRequired=false;requirement.retryBlockedReasons=[];requirement.retryEligible=true;click('Refresh result guidance');await wait();check(q('#assessment').textContent.includes('Start next assessment attempt'),'Eligible retry action missing');
 guidanceUnavailable=true;click('Refresh result guidance');await wait();check(q('#assessment').textContent.includes('could not be loaded'),'Guidance error missing');check(![...q('#assessment').querySelectorAll('button')].some(b=>b.textContent==='Start next assessment attempt'),'Failed guidance retained stale retry action');
 guidanceUnavailable=false;click('Refresh result guidance');await wait();
 session.status='IN_PROGRESS';delete session.result;click('Start next assessment attempt');await wait();check(q('#assessment form'),'Next attempt did not open');
 session.status='EXPIRED';click('Assigned device training');await wait();click('View / resume latest attempt');await wait();check(q('#assessment').textContent.includes('expired before submission'),'Expired attempt explanation missing');
 click('View remaining course requirements');await wait();check(q('#assessment').hidden&&!q('#course').hidden,'Remaining requirements navigation failed');
 click('Sign out');check(!sessionStorage.getItem('mdt.auth.access-token'),'Token retained');check(!q('#course').textContent&&!q('#assessment').textContent&&!q('#courses').textContent&&!q('#credentials').textContent&&!q('#notices').textContent,'Private content retained');
 document.body.dataset.testResult='PASS';
}catch(error){document.body.dataset.testResult='FAIL: '+error.message;}
`;
const server=createServer(async(req,res)=>{try{
 if(req.url==='/qr-decoder.js'){res.setHeader('content-type','text/javascript');res.end(decoder);return;}
 if(req.url==='/exercise.js'){res.setHeader('content-type','text/javascript');res.end(exercise);return;}
 if(req.url==='/'){res.setHeader('content-type','text/html');res.end((await readFile('apps/web/dist/learner.html','utf8')).replace(/<script[^>]*src="[^"]+"[^>]*><\/script>/g,'')+'<script type="module" src="/exercise.js"></script>');return;}
 const file={'/learner/learner.js':'learner.js','/learner/auth-session.js':'auth-session.js','/learner/learner-media.js':'learner-media.js'}[req.url];if(!file){res.writeHead(404).end();return;}res.setHeader('content-type','text/javascript');res.end(await readFile(join('apps/web/dist',file)));
}catch{res.writeHead(500).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
try{
 const profile=await mkdtemp(join(tmpdir(),'mdt-learner-'));
 const child=spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',['--headless=new',`--user-data-dir=${profile}`,'--dump-dom','--virtual-time-budget=5000',`http://127.0.0.1:${server.address().port}`],{windowsHide:true});
 let output='';child.stdout.on('data',x=>output+=x);child.stderr.resume();const timer=setTimeout(()=>child.kill(),30000);
 try{await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});}finally{clearTimeout(timer);}
 assert.match(output,/data-test-result="PASS"/,output.slice(-2200));
 console.log('Learner browser passed: assigned course, inert text, three assessment types, stable start and submit retries, server result, resume and sign-out.');
}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
