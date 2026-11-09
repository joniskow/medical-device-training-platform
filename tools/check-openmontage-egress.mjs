import assert from 'node:assert/strict';
import {createRequire,syncBuiltinESMExports} from 'node:module';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
const require=createRequire(import.meta.url),https=require('node:https'),dns=require('node:dns/promises');
const originals={request:https.request,lookup:dns.lookup};
const seen=[];let videoUrl='https://video.example/output.mp4';
dns.lookup=async()=>[{address:'8.8.8.8',family:4}];
https.request=(url,options,callback)=>{
 seen.push({url:url.href,headers:options.headers});
 const req=new EventEmitter();req.destroy=error=>{if(error)req.emit('error',error);req.emit('close');};
 req.end=()=>queueMicrotask(()=>{const response=new PassThrough();response.statusCode=200;response.headers={};response.on('close',()=>req.emit('close'));callback(response);response.end(url.hostname==='video.example'?Buffer.from('video'):JSON.stringify({videoUrl}));});return req;
};syncBuiltinESMExports();process.env.OPENMONTAGE_VIDEO_ORIGINS='https://video.example';
const {createOpenMontageProvider}=await import('../apps/worker/dist/openmontage-provider.js');
try{
 const provider=createOpenMontageProvider({mode:'http',endpoint:'https://provider.example/generate',apiKey:'secret-test'});
 const request={mode:'LOCKED_INTERACTIVE',width:960,height:540,frameRate:30,durationSeconds:3};
 assert.equal(Buffer.from((await provider.generate(request)).video.bytes).toString(),'video');
 assert.equal(seen[0].headers.authorization,'Bearer secret-test');assert.equal(seen[1].headers.authorization,undefined);
 videoUrl='https://169.254.169.254/metadata';await assert.rejects(provider.generate(request),/DESTINATION_DENIED/);
 assert.equal(seen.some(value=>value.url.includes('169.254')),false);
 console.log('OpenMontage full provider boundary: approved download, secret isolation and hostile URL rejection passed.');
}finally{https.request=originals.request;dns.lookup=originals.lookup;syncBuiltinESMExports();delete process.env.OPENMONTAGE_VIDEO_ORIGINS;}
