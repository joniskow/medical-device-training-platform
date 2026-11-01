import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import type {AssetProcessorPort,PrivateObjectStoragePort} from '@medical-device/contracts';

const run=promisify(execFile);
const profiles:Record<string,{kind:string;codec:string[];format:string;demuxer:string}>={
 'image/png':{kind:'image',codec:['png'],format:'png_pipe',demuxer:'png_pipe'},
 'image/jpeg':{kind:'image',codec:['mjpeg'],format:'jpeg_pipe',demuxer:'jpeg_pipe'},
 'image/webp':{kind:'image',codec:['webp'],format:'webp_pipe',demuxer:'webp_pipe'},
 'video/mp4':{kind:'video',codec:['h264'],format:'mp4',demuxer:'mov'},
 'video/webm':{kind:'video',codec:['vp8','vp9'],format:'webm',demuxer:'matroska'}
};

export function createMediaAssetProcessor(input:{storage:PrivateObjectStoragePort;fallback:AssetProcessorPort}):AssetProcessorPort{
 const handles=(type:string)=>type==='image'||type==='video';
 return {
  inspect:request=>handles(request.sourceType)?Promise.resolve({supported:profiles[request.contentType??'']?.kind===request.sourceType&&(request.sizeBytes??Infinity)<=128*1024*1024,reasons:profiles[request.contentType??'']?.kind===request.sourceType?[]:['MEDIA_PROFILE_UNSUPPORTED']}):input.fallback.inspect(request),
  canProcess:request=>handles(request.sourceType)?Promise.resolve(true):input.fallback.canProcess(request),
  async process(request,job){
   if(!handles(request.sourceType))return input.fallback.process(request,job);
   const start=Date.now();
   const fail=(code:string)=>({adapter:'media-inspection',adapterVersion:'2',inputAssetVersionId:request.inputAssetVersionId,outputArtifactIds:[],status:'FAILED' as const,warnings:[],metrics:{durationMs:Date.now()-start},failure:{class:'VALIDATION' as const,code,message:'Media processing failed: '+code}});
   const profile=profiles[request.contentType??''];
   if(!profile||profile.kind!==request.sourceType)return fail('MEDIA_PROFILE_UNSUPPORTED');
   if(!request.blobKey.startsWith(job.tenant.organizationId+'/'))return fail('BLOB_TENANT_MISMATCH');
   const object=await input.storage.readObject({blobKey:request.blobKey,maxBytes:128*1024*1024});
   if(createHash('sha256').update(object.bytes).digest('hex')!==request.sha256)return fail('CHECKSUM_MISMATCH');
   const directory=await mkdtemp(join(tmpdir(),'media-inspection-'));
   try{
    const path=join(directory,'source'),previewPath=join(directory,'preview.png');await writeFile(path,object.bytes);
    // Only supported local demuxers are available; nested network protocols are disabled.
    const inputArgs=['-protocol_whitelist','file','-format_whitelist',profile.demuxer,'-i',path];
    const probe=await run('ffprobe',['-v','error',...inputArgs,'-show_entries','stream=codec_name,codec_type,width,height,pix_fmt,duration:format=format_name,duration','-of','json'],{timeout:15000,maxBuffer:1024*1024,windowsHide:true});
    const metadata=JSON.parse(probe.stdout),streams=metadata.streams??[],video=streams.filter((s:any)=>s.codec_type==='video'),audio=streams.filter((s:any)=>s.codec_type==='audio');
    if(video.length!==1||streams.length!==video.length+audio.length||audio.length>1)return fail('MEDIA_STREAMS_UNSUPPORTED');
    const stream=video[0];
    if(!profile.codec.includes(stream.codec_name)||!String(metadata.format?.format_name).split(',').includes(profile.format))return fail('MEDIA_CODEC_UNSUPPORTED');
    if(!Number.isSafeInteger(stream.width)||!Number.isSafeInteger(stream.height)||stream.width<1||stream.height<1||stream.width>4096||stream.height>4096||stream.width*stream.height>16777216)return fail('MEDIA_DIMENSION_LIMIT');
    const duration=request.sourceType==='video'?Number(metadata.format?.duration??stream.duration):0;
    if(!Number.isFinite(duration)||duration<0||request.sourceType==='video'&&(duration===0||duration>300))return fail('MEDIA_DURATION_LIMIT');
    if(request.sourceType==='image'&&audio.length||audio.some((s:any)=>!(request.contentType==='video/mp4'?['aac']:['opus','vorbis']).includes(s.codec_name)))return fail('MEDIA_AUDIO_UNSUPPORTED');
    if(request.contentType==='video/mp4'&&!['yuv420p','yuvj420p'].includes(stream.pix_fmt))return fail('MEDIA_PIXEL_FORMAT_UNSUPPORTED');
    // Decode the entire admitted file, so a valid header alone cannot pass review preparation.
    await run('ffmpeg',['-nostdin','-v','error','-xerror','-threads','2',...inputArgs,'-map','0:v:0','-map','0:a?','-f','null','-'],{timeout:60000,maxBuffer:1024*1024,windowsHide:true});
    await run('ffmpeg',['-nostdin','-v','error','-threads','2',...inputArgs,'-frames:v','1','-vf','scale=640:640:force_original_aspect_ratio=decrease','-y',previewPath],{timeout:15000,maxBuffer:1024*1024,windowsHide:true});
    const preview=await readFile(previewPath),prefix=`${job.tenant.organizationId}/derived/media/${encodeURIComponent(request.inputAssetVersionId)}/${request.sha256}`;
    const frames:Array<{index:number;timestampSeconds:number;blobKey:string;sha256:string;byteLength:number}>=[];
    const frameObjects:Array<{blobKey:string;bytes:Uint8Array;contentType:string}>=[];
    if(request.sourceType==='video'){
     // Sample original decoded timestamps; this is a review gallery, not a coverage claim.
     const interval=duration/24;
     const sampled=await run('ffmpeg',['-nostdin','-v','info','-threads','2',...inputArgs,'-an','-vf',`select='gte(t,selected_n*${interval})',scale=640:640:force_original_aspect_ratio=decrease,showinfo`,'-frames:v','24','-fps_mode','passthrough','-y',join(directory,'frame-%02d.png')],{timeout:45000,maxBuffer:1024*1024,windowsHide:true});
     const times=[...sampled.stderr.matchAll(/Parsed_showinfo[^\n]*\bn:\s*\d+[^\n]*\bpts_time:([\d.e+-]+)/g)].map(match=>Number(match[1])).slice(0,24);
     if(!times.length||times.some((time,index)=>!Number.isFinite(time)||time<0||time>duration||index>0&&time<=times[index-1]))return fail('MEDIA_FRAME_TIMING_INVALID');
     let frameBytes=0;
     for(let index=0;index<times.length;index++){
      const bytes=await readFile(join(directory,`frame-${String(index+1).padStart(2,'0')}.png`));frameBytes+=bytes.length;
      if(bytes.length>2*1024*1024||frameBytes>24*1024*1024)return fail('MEDIA_FRAME_SIZE_LIMIT');
      const blobKey=`${prefix}/frame-${index}.png`,sha256=createHash('sha256').update(bytes).digest('hex');
      frames.push({index,timestampSeconds:times[index],blobKey,sha256,byteLength:bytes.length});frameObjects.push({blobKey,bytes,contentType:'image/png'});
     }
    }
    const uniqueFrameCount=new Set(frames.map(frame=>frame.sha256)).size;
    const frameWarnings=frames.length&&uniqueFrameCount<frames.length?['IDENTICAL_SAMPLED_FRAMES']:[];
    const report={schemaVersion:'media-inspection.v1',assetVersionId:request.inputAssetVersionId,sourceSha256:request.sha256,sourceType:request.sourceType,contentType:request.contentType,width:stream.width,height:stream.height,durationSeconds:duration,videoCodec:stream.codec_name,audioCodec:audio[0]?.codec_name??null,previewBlobKey:prefix+'/preview.png',decodeVerified:true,reconstructionPerformed:false,...(frames.length?{frames,uniqueFrameCount,frameWarnings,sampling:'elapsed-time-original-pts.v1'}:{})};
    const reportBytes=Buffer.from(JSON.stringify(report));
    await input.storage.putObject({blobKey:report.previewBlobKey,bytes:preview,contentType:'image/png'});
    for(const frame of frameObjects)await input.storage.putObject(frame);
    await input.storage.putObject({blobKey:prefix+'/inspection.json',bytes:reportBytes,contentType:'application/json'});
    return {adapter:'media-inspection',adapterVersion:'2',inputAssetVersionId:request.inputAssetVersionId,outputArtifactIds:[prefix+'/inspection.json',report.previewBlobKey,...frames.map(frame=>frame.blobKey)],status:'REVIEW_REQUIRED',warnings:[{code:'MEDIA_REVIEW_REQUIRED',severity:'warning',message:'Media decoding passed. Review the original content, rights, accessibility text and suitability before publication. No 3D reconstruction was performed.'},...frameWarnings.map(code=>({code,severity:'warning' as const,message:'Some sampled views are identical. Inspect camera coverage before using this video for reconstruction.'}))],metrics:{durationMs:Date.now()-start,inputBytes:object.bytes.length,outputBytes:preview.length+reportBytes.length+frameObjects.reduce((total,frame)=>total+frame.bytes.length,0)},details:report};
   }catch(error){
    // Storage failures must remain retryable; decoder failures are invalid source media.
    if(error&&typeof error==='object'&&'cmd' in error)return fail('MEDIA_DECODE_FAILED');
    throw error;
   }finally{await rm(directory,{recursive:true,force:true});}
  }
 };
}
