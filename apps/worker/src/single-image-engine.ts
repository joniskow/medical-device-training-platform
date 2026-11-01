import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,mkdir,readFile,writeFile,rm,lstat,realpath} from 'node:fs/promises';
import {resolve,join,dirname,basename} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import type {ReconstructionEngine} from '@medical-device/contracts';

const execute=promisify(execFile);
type Runtime={kind:'python';executable:string}|{kind:'docker';executable:string;image:string};
export function createSingleImageEngine(options:{runtime:Runtime;assetsDirectory:string;scriptsDirectory:string;workDirectory?:string}):ReconstructionEngine{
  return {modes:['single-image'],async generate({job,sources}){
    if(job.payload.mode!=='single-image'||sources.length!==1)throw Error('RECONSTRUCTION_MODE_UNAVAILABLE');
    const root=resolve(options.workDirectory??tmpdir());await mkdir(root,{recursive:true});
    const work=await mkdtemp(join(root,'mdt-reconstruction-')),results=join(work,'results'),containerName='mdt-reconstruct-'+randomUUID();
    let safeCleanup=true;
    try{
      await mkdir(results);const extension=({'image/png':'png','image/jpeg':'jpg','image/webp':'webp'} as Record<string,string>)[sources[0].source.contentType];
      if(!extension)throw Error('RECONSTRUCTION_SOURCE_UNSUPPORTED');
      const source=join(work,'source.'+extension);await writeFile(source,sources[0].bytes,{mode:0o400});
      const runtime=options.runtime,assets=resolve(options.assetsDirectory),scripts=resolve(options.scriptsDirectory);
      const args=runtime.kind==='docker'?['run','--rm','--name',containerName,'--network','none','--memory','8g','--cpus','4',
        '--mount',`type=bind,source=${assets},target=/assets,readonly`,'--mount',`type=bind,source=${scripts},target=/checks,readonly`,
        '--mount',`type=bind,source=${source},target=/input/source.${extension},readonly`,'--mount',`type=bind,source=${results},target=/runs`,runtime.image,
        '--image',`/input/source.${extension}`,'--assets','/assets','--output','/runs/output']:
        [join(scripts,'single_image.py'),'--image',source,'--assets',assets,'--output',join(results,'output')];
      try{await execute(runtime.executable,args,{windowsHide:true,timeout:1_100_000,maxBuffer:1024*1024,env:{...process.env,HF_HUB_OFFLINE:'1',HF_HUB_DISABLE_TELEMETRY:'1'}});}
      catch(error){
        if(runtime.kind==='docker')try{await execute(runtime.executable,['rm','-f',containerName],{windowsHide:true,timeout:20_000,maxBuffer:64*1024});}
        catch(cleanupError){if(!String((cleanupError as {stderr?:string}).stderr).includes('No such container'))safeCleanup=false;}
        throw error;
      }
      async function artifact(name:string,limit:number,optional=false){
        const path=join(results,'output',name);let stat;try{stat=await lstat(path);}catch(error){if(optional&&(error as NodeJS.ErrnoException).code==='ENOENT')return undefined;throw error;}
        if(!stat.isFile()||stat.isSymbolicLink()||stat.size<1||stat.size>limit||!(await realpath(path)).startsWith(await realpath(results)+ (process.platform==='win32'?'\\':'/')))throw Error('RECONSTRUCTION_OUTPUT_INVALID');
        return readFile(path);
      }
      return {candidate:(await artifact('candidate-private.glb',64*1024*1024))!,quality:(await artifact('quality.json',256*1024))!,
        foreground:await artifact('foreground.png',32*1024*1024,true),conditioningImage:await artifact('input.png',32*1024*1024,true)};
    }finally{
      // This exact temporary directory was created above; never remove a computed parent.
      if(safeCleanup&&dirname(work)===root&&basename(work).startsWith('mdt-reconstruction-'))await rm(work,{recursive:true,force:true});
    }
  }};
}
