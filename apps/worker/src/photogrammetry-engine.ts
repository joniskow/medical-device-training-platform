import {mkdtemp,mkdir,writeFile,readFile,lstat,realpath,rm,copyFile,readdir} from 'node:fs/promises';
import {resolve,join,dirname,basename,sep} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID,createHash} from 'node:crypto';
import type {ReconstructionEngine} from '@medical-device/contracts';
import {runReconstructionProcess} from './bounded-reconstruction-process.js';

type VideoTools={kind:'native';ffmpeg:string;ffprobe:string}|{kind:'docker';executable:string;image:string};
export function createPhotogrammetryEngine(options:{pythonExecutable:string;scriptsDirectory:string;openMvsDirectory:string;workDirectory?:string;videoTools?:VideoTools;
  retainEvidenceDirectory?:string;calibration?:{file:string;sourceHashes:readonly string[]};blender?:{executable:string;script:string}}):ReconstructionEngine{
 return {modes:options.videoTools?['multi-view','video']:['multi-view'],async generate({job,sources}){
  if(!['multi-view','video'].includes(job.payload.mode)||job.payload.mode==='video'&&(!options.videoTools||sources.length!==1)||job.payload.mode==='multi-view'&&(sources.length<20||sources.length>100))throw Error('RECONSTRUCTION_MODE_UNAVAILABLE');
  const root=resolve(options.workDirectory??tmpdir());await mkdir(root,{recursive:true});const work=await mkdtemp(join(root,'mdt-photogrammetry-')),images=join(work,'images'),run=join(work,'result'),scripts=resolve(options.scriptsDirectory);
  let safeCleanup=true;
  const launch=(command:string,args:string[],timeout:number)=>runReconstructionProcess(command,args,timeout,{...process.env,OMP_NUM_THREADS:'4',OPENBLAS_NUM_THREADS:'4'});
  try{
   let inputImages=images;
   if(job.payload.mode==='video'){
    const extension=({'video/mp4':'mp4','video/webm':'webm'} as Record<string,string>)[sources[0].source.contentType];if(!extension)throw Error('RECONSTRUCTION_SOURCE_UNSUPPORTED');
    const video=join(work,'source.'+extension),views=join(work,'views');await writeFile(video,sources[0].bytes,{mode:0o400});
    const tools=options.videoTools!;
    if(tools.kind==='native')await launch(options.pythonExecutable,[join(scripts,'video_views.py'),'--video',video,'--output',views,'--frames','48','--ffmpeg',tools.ffmpeg,'--ffprobe',tools.ffprobe],240_000);
    else{
     const destination=join(work,'video-output');await mkdir(destination);const name='mdt-video-views-'+randomUUID();
     try{await launch(tools.executable,['run','--rm','--name',name,'--network','none','--memory','2g','--cpus','2','--mount',`type=bind,source=${video},target=/input/source.${extension},readonly`,'--mount',`type=bind,source=${scripts},target=/checks,readonly`,'--mount',`type=bind,source=${destination},target=/runs`,'--entrypoint','python3',tools.image,'/checks/video_views.py','--video',`/input/source.${extension}`,'--output','/runs/views','--frames','48'],240_000);}
     catch(error){try{await launch(tools.executable,['rm','-f',name],20_000);}catch(cleanupError){if(!String((cleanupError as {stderr?:string}).stderr).includes('No such container'))safeCleanup=false;}throw error;}
     inputImages=join(destination,'views','images');
    }
    if(tools.kind==='native')inputImages=join(views,'images');
   }else{
    await mkdir(images);for(let index=0;index<sources.length;index++){const source=sources[index],extension=({'image/png':'png','image/jpeg':'jpg','image/webp':'webp'} as Record<string,string>)[source.source.contentType];if(!extension)throw Error('RECONSTRUCTION_SOURCE_UNSUPPORTED');await writeFile(join(images,`view-${String(index).padStart(3,'0')}.${extension}`),source.bytes,{mode:0o400});}
   }
   const args=[join(scripts,'reconstruct.py'),'--images',inputImages,'--output',run,'--openmvs-dir',resolve(options.openMvsDirectory),'--detail','high'];
   if(options.calibration){const actual=sources.map(({source})=>source.sourceHash).sort(),expected=[...options.calibration.sourceHashes].sort();if(JSON.stringify(actual)!==JSON.stringify(expected))throw Error('RECONSTRUCTION_CALIBRATION_SOURCE_MISMATCH');args.push('--camera-calibration',resolve(options.calibration.file));}
   await launch(options.pythonExecutable,args,3_300_000);
   if(options.blender){
    const source=join(run,'candidate.glb'),blenderCandidate=join(run,'candidate-blender.glb');
    const originalHash=createHash('sha256').update(await readFile(source)).digest('hex');
    const blenderResult=await launch(options.blender.executable,['-b','--python',resolve(options.blender.script),'--','--input',source,'--output',blenderCandidate],300_000);
    const blenderLine=blenderResult.stdout.trim().split(/\r?\n/).filter(Boolean).at(-1);
    let blenderReport:any;try{blenderReport=JSON.parse(blenderLine??'');}catch{throw Error('BLENDER_STAGE_INVALID');}
    if(blenderReport?.stage!=='blender'||blenderReport.inputSha256!==originalHash)throw Error('BLENDER_STAGE_INVALID');
    const blenderBytes=await readFile(blenderCandidate),blenderOutputHash=createHash('sha256').update(blenderBytes).digest('hex');
    if(blenderReport.outputSha256!==blenderOutputHash)throw Error('BLENDER_STAGE_INVALID');
    await copyFile(blenderCandidate,source);
    await launch(options.pythonExecutable,[join(scripts,'package_candidate.py'),run],180_000);
    const packaged=JSON.parse((await readFile(join(run,'quality.json'))).toString('utf8'));
    packaged.adapter={...(packaged.adapter??{}),blender:{version:blenderReport.version,inputSha256:originalHash,outputSha256:blenderOutputHash,meshObjects:blenderReport.meshObjects}};
    await writeFile(join(run,'quality.json'),JSON.stringify(packaged,null,2)+'\n');
   }
   async function artifact(name:string,limit:number){const file=join(run,name),stat=await lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size<1||stat.size>limit||!(await realpath(file)).startsWith(await realpath(run)+sep))throw Error('RECONSTRUCTION_OUTPUT_INVALID');return readFile(file);}
   const candidate=await artifact('candidate-private.glb',64*1024*1024),quality=await artifact('quality.json',256*1024);
   const report=JSON.parse(quality.toString('utf8')),sourceViews=[];
   if(job.payload.mode==='video'){
    const frames=report.sourceVideo?.frames;if(!Array.isArray(frames)||frames.length<20)throw Error('RECONSTRUCTION_OUTPUT_INVALID');
    for(let index=0;index<8;index++){
     const frame=frames[Math.round(index*(frames.length-1)/7)];if(!/^frame-\d{3}\.png$/.test(frame.name))throw Error('RECONSTRUCTION_OUTPUT_INVALID');
     const path=join(inputImages,frame.name),stat=await lstat(path);
     if(!stat.isFile()||stat.isSymbolicLink()||stat.size>25*1024*1024||!(await realpath(path)).startsWith(await realpath(inputImages)+sep))throw Error('RECONSTRUCTION_OUTPUT_INVALID');
     sourceViews.push({sourceName:frame.name,timestampSeconds:frame.timestampSeconds,bytes:await readFile(path)});
    }
   }
   // Explicit local benchmark retention is separate from application artifact storage.
   if(options.retainEvidenceDirectory){const destination=resolve(options.retainEvidenceDirectory);await mkdir(destination,{recursive:true});const preserved=join(destination,basename(work));await mkdir(preserved);await copyFile(join(run,'candidate-private.glb'),join(preserved,'candidate-private.glb'));await copyFile(join(run,'quality.json'),join(preserved,'quality.json'));
    for(const name of await readdir(run))if(name.endsWith('.log')&&(await lstat(join(run,name))).isFile())await copyFile(join(run,name),join(preserved,name));
    await mkdir(join(preserved,'selected-sparse'));for(const name of ['cameras.bin','images.bin','points3D.bin','rigs.bin','frames.bin']){const file=join(run,'selected-sparse',name),stat=await lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>64*1024*1024)throw Error('RECONSTRUCTION_EVIDENCE_INVALID');await copyFile(file,join(preserved,'selected-sparse',name));}
    await writeFile(join(preserved,'job-reference.json'),JSON.stringify({jobId:job.jobId,candidateSha256:createHash('sha256').update(candidate).digest('hex')},null,2));}
   return {candidate,quality,...(sourceViews.length?{sourceViews}:{})};
  }catch(error){if((error as {processStillRunning?:boolean}).processStillRunning)safeCleanup=false;throw error;}
  finally{if(safeCleanup&&dirname(work)===root&&basename(work).startsWith('mdt-photogrammetry-'))await rm(work,{recursive:true,force:true});}
 }};
}
