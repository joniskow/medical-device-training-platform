import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
const exercise=`
const wait=()=>new Promise(r=>setTimeout(r,50)),check=(v,m)=>{if(!v)throw Error(m)};
let calls=0;window.fetch=async(url)=>{check(url==='/api/v1/auth/config','Unexpected network');calls++;return new Response(JSON.stringify({error:'private-provider-diagnostic'}),{status:503});};
try{
 await import('/author/signin.js');await wait();check(calls===0,'Sign-in automatically contacted provider');
 const button=document.querySelector('#continue');check(!button.disabled,'Sign-in button disabled');button.click();await wait();
 check(calls===1&&!button.disabled,'Unavailable config not retryable');check(document.querySelector('#message').textContent.includes('could not be completed'),'Missing error guidance');
 check(!document.body.textContent.includes('private-provider'),'Provider diagnostics leaked');button.click();await wait();check(calls===2,'Config retry failed');
 check(document.documentElement.scrollWidth<=innerWidth,'Horizontal overflow');document.body.dataset.testResult='PASS';
}catch(error){document.body.dataset.testResult='FAIL';document.body.append(String(error));}
`;
const server=createServer(async(req,res)=>{try{
 if(req.url==='/exercise.js'){res.setHeader('content-type','text/javascript');res.end(exercise);return;}
 if(req.url==='/'){res.setHeader('content-type','text/html');res.end((await readFile('apps/web/dist/signin.html','utf8')).replace(/<script[^>]*src="[^"]+"[^>]*><\/script>/g,'')+'<script type="module" src="/exercise.js"></script>');return;}
 if(req.url==='/author/signin.js'){res.setHeader('content-type','text/javascript');res.end(await readFile('apps/web/dist/signin.js'));return;}res.writeHead(404).end();
}catch{res.writeHead(500).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
try{
 const profile=await mkdtemp(join(tmpdir(),'mdt-signin-'));
 const child=spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',['--headless=new','--window-size=320,800',`--user-data-dir=${profile}`,'--dump-dom','--virtual-time-budget=5000',`http://127.0.0.1:${server.address().port}`],{windowsHide:true});
 let output='';child.stdout.on('data',x=>output+=x);child.stderr.resume();const timer=setTimeout(()=>child.kill(),30000);
 try{await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});}finally{clearTimeout(timer);}
 assert.match(output,/data-test-result="PASS"/,output.slice(-2000));
 console.log('Sign-in Chrome passed: bundled MSAL loads, no unsolicited auth requests, safe configuration failure, retry and narrow viewport.');
}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
