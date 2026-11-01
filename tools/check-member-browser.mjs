import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile,mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
const exercise=`
sessionStorage.setItem('mdt.auth.access-token','test');sessionStorage.setItem('mdt.auth.organization-id','org:test');
const wait=()=>new Promise(r=>setTimeout(r,40)),q=s=>document.querySelector(s),check=(v,m)=>{if(!v)throw Error(m)};
let saved=false,delay=false,forbidden=false;const keys=[],bodies=[],statusKeys=[];let memberStatus='ACTIVE';window.confirm=()=>true;
window.fetch=async(url,init={})=>{
 if(init.headers['x-organization-id']!=='org:test')throw Error('Missing selected organization');
 if(forbidden)return new Response(JSON.stringify({error:{code:'MEMBER_ADMIN_REQUIRED'}}),{status:403});
 if(delay)await new Promise(r=>setTimeout(r,150));
 if(init.method==='POST'&&url.endsWith('/status')){statusKeys.push(init.headers['idempotency-key']);const body=JSON.parse(init.body);check(Object.keys(body).sort().join(',')==='reason,revision,status','Spoofable status authority sent');memberStatus=body.status;if(memberStatus==='REMOVED')saved=false;if(statusKeys.length===1)throw Error('Status response interrupted');return new Response('{}');}
 if(init.method==='POST'){keys.push(init.headers['idempotency-key']);bodies.push(JSON.parse(init.body));saved=true;if(keys.length===1)throw Error('Role response interrupted');return new Response('{}');}
 return new Response(JSON.stringify({allowedRoles:['learner','author','organization_admin'],items:url.includes('after=')?[{subject:'second',status:'ACTIVE',roles:['learner'],revision:'b'.repeat(64)}]:[{subject:'<img src=x> learner',status:memberStatus,roles:saved?['author']:['learner'],revision:'a'.repeat(64)},{subject:'suspended',status:'SUSPENDED',roles:['learner'],revision:'c'.repeat(64)}],nextCursor:url.includes('after=')?null:'next'}));
};
await import('/author/members.js');
try{
 await wait();check(!q('#members img'),'Unsafe member identifier');check(q('#members').querySelectorAll('form[data-kind=roles]').length===1,'Inactive member editable');
 q('#more').click();await wait();check(q('#members').querySelectorAll('article').length===3,'Member paging failed');
 const form=q('#members form[data-kind=roles]');form.querySelector('textarea').value='New author responsibility';form.querySelector('input[value=learner]').checked=false;form.querySelector('button').click();await wait();check(q('#message').textContent.includes('at least one role'),'Empty role validation missing');
 form.querySelector('input[value=author]').checked=true;form.querySelector('button').click();await wait();check(q('#message').textContent.includes('Role response interrupted'),'Interrupted response not shown');form.querySelector('button').click();await wait();
 check(keys.length===2&&keys[0]===keys[1],'Role retry identity changed');check(JSON.stringify(bodies[0])===JSON.stringify(bodies[1]),'Retry payload changed');check(Object.keys(bodies[0]).sort().join(',')==='reason,revision,roles','Spoofable role authority sent');check(q('#members input[value=author]').checked&&!q('#members input[value=learner]').checked,'Saved roles not refreshed');
 const changeStatus=async(value,reason)=>{const form=q('#members form[data-kind=status]');form.querySelector('select').value=value;form.querySelector('textarea').value=reason;form.querySelector('button').click();await wait();};
 await changeStatus('SUSPENDED','Review membership');check(q('#message').textContent.includes('Status response interrupted'),'Status retry error missing');q('#members form[data-kind=status] button').click();await wait();check(statusKeys[0]===statusKeys[1],'Status retry changed identity');check(!q('#members form[data-kind=roles]'),'Suspended member retains role controls');
 await changeStatus('ACTIVE','Review complete');check(q('#members input[value=author]').checked,'Suspension lost prior roles');
 await changeStatus('REMOVED','Departed');check(!q('#members form[data-kind=roles]'),'Removed member editable');await changeStatus('ACTIVE','Rejoined');check(q('#members input[value=learner]').checked&&!q('#members input[value=author]').checked,'Removal restored privileged roles');
 forbidden=true;q('#refresh').click();await wait();check(q('#message').textContent.includes('no longer have administrator access')&&!q('#members').textContent,'Changed access retained member data');forbidden=false;
 delay=true;q('#refresh').click();q('#sign-out').click();await new Promise(r=>setTimeout(r,200));check(!q('#members').textContent&&!sessionStorage.getItem('mdt.auth.organization-id'),'Late response restored private member data');
 document.body.dataset.testResult='PASS';
}catch(error){document.body.dataset.testResult='FAIL: '+error.message;}
`;
const server=createServer(async(req,res)=>{try{
 if(req.url==='/exercise.js'){res.setHeader('content-type','text/javascript');res.end(exercise);return;}
 if(req.url==='/'){res.setHeader('content-type','text/html');res.end((await readFile('apps/web/dist/members.html','utf8')).replace(/<script[^>]*src="[^"]+"[^>]*><\/script>/g,'')+'<script type="module" src="/exercise.js"></script>');return;}
 const file={'/author/members.js':'members.js','/author/auth-session.js':'auth-session.js'}[req.url];if(!file){res.writeHead(404).end();return;}res.setHeader('content-type','text/javascript');res.end(await readFile(join('apps/web/dist',file)));
}catch{res.writeHead(500).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
try{
 const profile=await mkdtemp(join(tmpdir(),'mdt-members-'));
 const child=spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',['--headless=new',`--user-data-dir=${profile}`,'--dump-dom','--virtual-time-budget=5000',`http://127.0.0.1:${server.address().port}`],{windowsHide:true});
 let output='';child.stdout.on('data',x=>output+=x);child.stderr.resume();const timer=setTimeout(()=>child.kill(),30000);
 try{await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});}finally{clearTimeout(timer);}
 assert.match(output,/data-test-result="PASS"/,output.slice(-2200));
 console.log('Member browser passed: private scope header, inert identities, inactive rows, role validation, paging, interrupted retry and sign-out fencing.');
}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
