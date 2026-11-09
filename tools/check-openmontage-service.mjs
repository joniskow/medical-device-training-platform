import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createProviderServer,validateRequest,createRenderer,buildImageRequest} from '../services/openmontage/server.mjs';
import {execFileSync} from 'node:child_process';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
const request={generationId:'generation:1',prompt:'A calm teaching room.',mode:'LOCKED_INTERACTIVE',width:640,height:360,frameRate:24,durationSeconds:2,modelVersionId:'model:1',modelSourceHash:'a'.repeat(64)};
const finalRequest={...request,background:{profile:'final',style:'warm-learning',camera:'seated'}};
assert.equal(validateRequest(finalRequest),finalRequest);
for(const background of [null,[],{profile:'expensive'},{quality:'high'},{style:'invented'},{camera:'moving'}])assert.throws(()=>validateRequest({...request,background}));
const finalImage=buildImageRequest(finalRequest,{deployment:'image',finalQuality:'high'});
assert.equal(finalImage.quality,'high');assert.equal(finalImage.n,1);
assert.match(finalImage.prompt,/warm neutral/);assert.match(finalImage.prompt,/1.2 meters/);
assert.match(finalImage.prompt,/center 60%/);assert.match(finalImage.prompt,/640:360/);
assert.equal(buildImageRequest({...request,width:640,height:640},{deployment:'image'}).size,'1024x1024');
assert.equal(buildImageRequest({...request,width:640,height:960},{deployment:'image'}).size,'1024x1536');
assert.equal(buildImageRequest(request,{deployment:'image'}).quality,'low');
assert.throws(()=>createRenderer({endpoint:'https://example.openai.azure.com/',apiKey:'key',deployment:'image',finalQuality:'auto'}),/IMAGE_CONFIGURATION_INVALID/);
for(const change of [v=>v.mode='CINEMATIC',v=>v.width=641,v=>v.durationSeconds=Infinity,v=>v.prompt='',v=>v.prompt='x'.repeat(4001),v=>v.url='http://internal',v=>v.modelSourceHash='fake']){const invalid=structuredClone(request);change(invalid);assert.throws(()=>validateRequest(invalid));}
assert.throws(()=>createRenderer({endpoint:'http://internal',apiKey:'key',deployment:'image'}));
let calls=0,finish;
const server=createProviderServer({token:'x'.repeat(64),render:async value=>{calls++;if(value.generationId==='held')await new Promise(resolve=>{finish=resolve;});return {videoBase64:'ZmFrZQ==',jobId:value.generationId};}});
server.listen(0,'127.0.0.1');await once(server,'listening');const origin='http://127.0.0.1:'+server.address().port;
const post=(value,token='x'.repeat(64))=>fetch(origin+'/generate',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(value)});
try{
 assert.equal((await fetch(origin+'/healthz')).status,200);
 assert.equal((await post(request,'bad')).status,401);assert.equal(calls,0);
 assert.equal((await post({...request,mode:'CINEMATIC'})).status,422);assert.equal(calls,0);
 assert.equal((await post(request)).status,200);assert.equal((await post(request)).status,200);assert.equal(calls,1);
 assert.equal((await post({...request,prompt:'Changed prompt'})).status,409);
 assert.equal((await post(finalRequest)).status,409,'quality changes must not replay a previously generated draft');
 const held=post({...request,generationId:'held'});while(!finish)await new Promise(r=>setTimeout(r,5));
 assert.equal((await post({...request,generationId:'another'})).status,429);finish();assert.equal((await held).status,200);
 console.log('OpenMontage service passed: auth, bounded inputs, unsupported cinematic denial, paid-call replay protection, conflicts and capacity.');
}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
const temp=await mkdtemp(join(tmpdir(),'video-provider-check-'));
try{
 const windowsFfmpeg=join(process.env.APPDATA??'','Python/Python312/site-packages/imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v7.1.exe');
 const ffmpeg=process.env.LESSON_FFMPEG??(existsSync(windowsFfmpeg)?windowsFfmpeg:'ffmpeg');
 const windowsProbe=resolve('output/OpenMontage/remotion-composer/node_modules/@remotion/compositor-win32-x64-msvc/ffprobe.exe');
 const ffprobe=process.env.LESSON_FFPROBE??(existsSync(windowsProbe)?windowsProbe:'ffprobe');
 const jpeg=join(temp,'source.jpg');execFileSync(ffmpeg,['-nostdin','-y','-v','error','-f','lavfi','-i','color=c=blue:s=320x180','-frames:v','1',jpeg],{windowsHide:true});
 const encoded=(await readFile(jpeg)).toString('base64');
 const render=createRenderer({endpoint:'https://example.openai.azure.com/',apiKey:'test',deployment:'image',ffmpeg,fetchImpl:async(url,options)=>{
  assert.equal(url.pathname,'/openai/v1/images/generations');assert.equal(options.redirect,'error');assert.equal(JSON.parse(options.body).quality,'low');
  return Response.json({data:[{b64_json:encoded}]});
 }});
 const output=await render(request);const path=join(temp,'rendered.mp4');await writeFile(path,Buffer.from(output.videoBase64,'base64'));
 const metadata=JSON.parse(execFileSync(ffprobe,['-v','error','-show_streams','-of','json',path],{windowsHide:true,encoding:'utf8'}));
 assert(metadata.streams.some(stream=>stream.width===640&&stream.height===360));
 assert.equal(output.provider,'azure-image-cpu-compositor');assert.equal(output.tracking,undefined);
 assert.equal(output.background.profile,'draft');assert.equal(output.background.quality,'low');
 assert.match(output.background.sourceImageHash,/^[a-f0-9]{64}$/);assert.match(output.background.promptHash,/^[a-f0-9]{64}$/);
 const finalRender=createRenderer({endpoint:'https://example.openai.azure.com/',apiKey:'test',deployment:'image',ffmpeg,defaultProfile:'final',finalQuality:'high',defaultStyle:'neutral-studio',fetchImpl:async(url,options)=>{
  const payload=JSON.parse(options.body);assert.equal(payload.quality,'high');assert.match(payload.prompt,/neutral studio/);
  return Response.json({data:[{b64_json:encoded}]});
 }});
 const finalOutput=await finalRender({...request,generationId:'final-render'});
 assert.equal(finalOutput.background.profile,'final');assert.equal(finalOutput.background.quality,'high');assert.equal(finalOutput.background.style,'neutral-studio');
 assert.equal(finalOutput.background.sourceImageHash,output.background.sourceImageHash);assert.notEqual(finalOutput.background.promptHash,output.background.promptHash);
 console.log('OpenMontage renderer passed: actual JPEG-to-MP4 encode/decode with requested dimensions and no fabricated motion tracking. Image response is a controlled fixture.');
}finally{await rm(temp,{recursive:true,force:true});}
