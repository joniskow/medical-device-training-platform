import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
const exercise=`
const wait=()=>new Promise(r=>setTimeout(r,50)),q=s=>document.querySelector(s),check=(v,m)=>{if(!v)throw Error(m)};
let mode='list';const course={publicId:'11111111-1111-1111-1111-111111111111',title:'<img src=x onerror=alert(1)>',issuerName:'Example issuer',publishedRevision:7,certification:{version:2,passScore:.85,maxAttempts:3,cooldownSeconds:60,attemptTtlSeconds:600,repeatedFailureReviewAfter:2,expirationDays:365,resultSelection:'latest',requiredActivities:[{title:'<img src=x> Quiz',kind:'assessment',passScore:.9}]},audience:'Candidates',productScope:'Device',prerequisites:'None',issuerStatement:'Product training',intendedUse:'Not licensure',accessibilityPath:'Text and keyboard',estimatedMinutes:30,costDesignation:'free-in-MVP'};
window.fetch=async(url,init)=>{check(init.credentials==='omit'&&!init.headers,'Catalog sent credentials');if(mode==='fail')return new Response('{}',{status:503});if(mode==='gone')return new Response('{}',{status:404});return new Response(JSON.stringify(mode==='detail'?course:{items:[course],nextCursor:url.includes('after=')?null:course.publicId}));};
try{
 await import('/catalog.js');await wait();check(q('#courses').children.length===1&&!document.querySelector('img'),'Unsafe course title');check(!q('#more').hidden,'Paging absent');q('#more').click();await wait();check(q('#courses').children.length===2&&q('#more').hidden,'Paging failed');
 mode='fail';q('#reload').click();await wait();check(!q('#courses').children.length&&q('#message').textContent.includes('retry'),'Stale catalog/error retry');
 mode='detail';history.replaceState({},'', '?course='+course.publicId);await import('/catalog.js?detail');await wait();check(q('dl').textContent.includes('Prerequisites')&&q('dl').textContent.includes('Text and keyboard'),'Disclosure missing');check(q('#courses').textContent.includes('Sign in and create your personal profile'),'Anonymous enrollment guidance missing');check(q('#courses').textContent.includes('Published revision 7')&&q('#courses').textContent.includes('85%')&&q('#courses').textContent.includes('90%')&&q('#courses').textContent.includes('365 days')&&!q('#courses img'),'Requirements/version missing or unsafe');
 mode='gone';q('#reload').click();await wait();check(!q('#courses').children.length&&q('#message').textContent.includes('not available'),'Withdrawn course remained visible');
 check(document.documentElement.scrollWidth<=innerWidth,'Horizontal overflow');document.body.dataset.testResult='PASS';
}catch(error){document.body.dataset.testResult='FAIL';document.body.append(String(error));}
`;
const server=createServer(async(req,res)=>{try{
 if(req.url==='/exercise.js'){res.setHeader('content-type','text/javascript');res.end(exercise);return;}
 if(req.url==='/'){res.setHeader('content-type','text/html');res.end((await readFile('apps/web/dist/catalog.html','utf8')).replace(/<script[^>]*src="[^"]+"[^>]*><\/script>/g,'')+'<script type="module" src="/exercise.js"></script>');return;}
 if(req.url.startsWith('/catalog.js')){res.setHeader('content-type','text/javascript');res.end(await readFile('apps/web/dist/catalog.js'));return;}res.writeHead(404).end();
}catch{res.writeHead(500).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
try{
 const profile=await mkdtemp(join(tmpdir(),'mdt-signin-'));
 const child=spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',['--headless=new','--window-size=320,800',`--user-data-dir=${profile}`,'--dump-dom','--virtual-time-budget=5000',`http://127.0.0.1:${server.address().port}`],{windowsHide:true});
 let output='';child.stdout.on('data',x=>output+=x);child.stderr.resume();const timer=setTimeout(()=>child.kill(),30000);
 try{await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});}finally{clearTimeout(timer);}
 assert.match(output,/data-test-result="PASS"/,output.slice(-2000));
 console.log('Catalog Chrome passed: anonymous requests, inert text, paging, disclosure detail, unavailable-course cleanup, retry and compact layout.');
}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
