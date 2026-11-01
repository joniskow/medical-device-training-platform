import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,readFile,rm,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const {createMediaAssetProcessor}=await import(process.env.MDT_WORKER_MODULE??'../apps/worker/dist/media-asset-processor.js');
const run=promisify(execFile),directory=await mkdtemp(join(tmpdir(),'media-fixture-'));
try{
 const fixtures=[['image','image/png','image.png',['-frames:v','1']],['image','image/jpeg','image.jpg',['-frames:v','1']],['image','image/webp','image.webp',['-frames:v','1']],['video','video/webm','video.webm',['-t','1','-c:v','libvpx-vp9']],['video','video/mp4','video.mp4',['-t','1','-c:v','libx264','-pix_fmt','yuv420p']],['video','video/mp4','moving.mp4',['-t','4','-c:v','libx264','-pix_fmt','yuv420p'],'testsrc2=size=320x240:rate=12']];
 for(const [sourceType,contentType,file,args,filter] of fixtures){
  const path=join(directory,file);
  await run('ffmpeg',['-nostdin','-v','error','-f','lavfi','-i',filter??'color=c=blue:s=320x240:r=5',...args,'-y',path]);
  const bytes=await readFile(path),sha256=createHash('sha256').update(bytes).digest('hex'),outputs=new Map();
  const processor=createMediaAssetProcessor({storage:{readObject:async()=>({bytes,contentType}),putObject:async object=>outputs.set(object.blobKey,object)},fallback:{process:async()=>{throw Error('Unexpected placeholder path');}}});
  const request={sourceType,contentType,blobKey:'org/source',inputAssetVersionId:'version:'+sourceType,sizeBytes:bytes.length,sha256},job={tenant:{organizationId:'org',actorId:'author',correlationId:'test'}};
  assert.equal((await processor.inspect(request)).supported,true);
  const result=await processor.process(request,job);assert.equal(result.status,'REVIEW_REQUIRED',JSON.stringify(result));
  assert.equal(result.details.width,320);assert.equal(result.details.height,240);assert.equal(result.details.decodeVerified,true);assert.equal(result.details.reconstructionPerformed,false);
  const frames=result.details.frames??[];assert.equal(outputs.size,2+frames.length);const preview=outputs.get(result.details.previewBlobKey);assert.deepEqual([...preview.bytes.subarray(0,4)],[137,80,78,71]);
  if(sourceType==='video'){
   assert(frames.length>1&&frames.length<=24);assert.equal(frames[0].timestampSeconds,0);assert(frames.at(-1).timestampSeconds>=result.details.durationSeconds*.7);
   for(const [index,frame] of frames.entries()){assert.equal(frame.index,index);assert(index===0||frame.timestampSeconds>frames[index-1].timestampSeconds);const object=outputs.get(frame.blobKey);assert.equal(object.bytes.length,frame.byteLength);assert.equal(createHash('sha256').update(object.bytes).digest('hex'),frame.sha256);}
   if(filter){assert.equal(frames.length,24);assert(result.details.uniqueFrameCount>20);assert.deepEqual(result.details.frameWarnings,[]);}else{assert.equal(result.details.uniqueFrameCount,1);assert(result.details.frameWarnings.includes('IDENTICAL_SAMPLED_FRAMES'));}
  }else assert.equal(frames.length,0);
  const report=JSON.parse(outputs.get(result.outputArtifactIds[0]).bytes.toString());assert.equal(report.sourceSha256,sha256);
  const repeated=await processor.process(request,job);assert.deepEqual(repeated.outputArtifactIds,result.outputArtifactIds);assert.deepEqual(repeated.details.frames,result.details.frames);assert.equal(outputs.size,2+frames.length);
  if(filter&&process.env.MEDIA_EVIDENCE_DIR){await mkdir(process.env.MEDIA_EVIDENCE_DIR,{recursive:true});await writeFile(join(process.env.MEDIA_EVIDENCE_DIR,'source.mp4'),bytes);await writeFile(join(process.env.MEDIA_EVIDENCE_DIR,'inspection.json'),JSON.stringify(result.details,null,2));for(const frame of frames)await writeFile(join(process.env.MEDIA_EVIDENCE_DIR,`frame-${frame.index}.png`),outputs.get(frame.blobKey).bytes);}
  assert.equal((await processor.process({...request,sha256:'0'.repeat(64)},job)).failure.code,'CHECKSUM_MISMATCH');
  assert.equal((await processor.process({...request,blobKey:'foreign/source'},job)).failure.code,'BLOB_TENANT_MISMATCH');
  const corrupt=Buffer.from('not decodable media');
  const invalid=createMediaAssetProcessor({storage:{readObject:async()=>({bytes:corrupt,contentType}),putObject:async()=>{throw Error('Invalid media persisted');}},fallback:{}});
  assert.equal((await invalid.process({...request,sha256:createHash('sha256').update(corrupt).digest('hex')},job)).status,'FAILED');
 }
 console.log('Media processing passed: real PNG/JPEG/WebP/H.264/WebM decode, bounded timestamped video views, moving/static distinction, source/frame hashes, retry-stable artifacts, tenant denial and corrupt-media rejection.');
}finally{await rm(directory,{recursive:true,force:true});}
