import type {ReconstructionEngine} from '@medical-device/contracts';
import {createSingleImageEngine} from './single-image-engine.js';
import {createPhotogrammetryEngine} from './photogrammetry-engine.js';
import {execFile} from 'node:child_process';
import {join} from 'node:path';

type Preflight=(executable:string,args:string[])=>Promise<void>;
const executePreflight:Preflight=(executable,args)=>new Promise((resolve,reject)=>execFile(executable,args,{windowsHide:true,timeout:180_000,maxBuffer:64*1024,env:{...process.env,HF_HUB_OFFLINE:'1',TRANSFORMERS_OFFLINE:'1',HF_HUB_DISABLE_TELEMETRY:'1'}},error=>error?reject(error):resolve()));
/** Run before queue consumption. Configured capability is unavailable unless its exact offline runtime passes. */
export async function initializeReconstructionEngine(env:NodeJS.ProcessEnv,preflight:Preflight=executePreflight):Promise<ReconstructionEngine|undefined>{
 const feature=env.RECONSTRUCTION_SINGLE_IMAGE_ENABLED?.trim();
 if(feature!==undefined&&!['true','false'].includes(feature))throw Error('RECONSTRUCTION_SINGLE_IMAGE_FEATURE_INVALID');
 const required=(name:string)=>{const value=env[name]?.trim();if(!value)throw Error('WORKER_CONFIGURATION_MISSING:'+name);return value;};
 const configured=feature==='true'||feature===undefined&&Boolean(env.RECONSTRUCTION_ASSETS_DIR?.trim());
 if(configured){
  const executable=required('RECONSTRUCTION_PYTHON'),scripts=required('RECONSTRUCTION_SCRIPTS_DIR'),assets=required('RECONSTRUCTION_ASSETS_DIR'),code=required('RECONSTRUCTION_SINGLE_IMAGE_CODE_DIR'),manifest=required('RECONSTRUCTION_SINGLE_IMAGE_MANIFEST');
  try{await preflight(executable,[join(scripts,'single_image_preflight.py'),'--assets',assets,'--code',code,'--manifest',manifest]);}
  catch{throw Error('RECONSTRUCTION_SINGLE_IMAGE_PREFLIGHT_FAILED');}
 }
 const engine=readReconstructionEngine({...env,...(!configured?{RECONSTRUCTION_ASSETS_DIR:''}:{})});
 if(env.RECONSTRUCTION_MODES!==undefined){
  const expected=env.RECONSTRUCTION_MODES.split(',').map(v=>v.trim()).sort(),actual=[...(engine?.modes??[])].sort();
  if(expected.some(mode=>!['single-image','multi-view','video'].includes(mode))||new Set(expected).size!==expected.length||JSON.stringify(actual)!==JSON.stringify(expected))throw Error('RECONSTRUCTION_CAPABILITY_CONFIGURATION_MISMATCH');
 }
 return engine;
}

export function readReconstructionEngine(env:NodeJS.ProcessEnv):ReconstructionEngine|undefined{
 const required=(name:string)=>{const value=env[name]?.trim();if(!value)throw Error('WORKER_CONFIGURATION_MISSING:'+name);return value;};
 const engines:ReconstructionEngine[]=[];
 if(env.RECONSTRUCTION_ASSETS_DIR?.trim())engines.push(createSingleImageEngine({runtime:{kind:'python',executable:env.RECONSTRUCTION_PYTHON?.trim()||'python3'},assetsDirectory:required('RECONSTRUCTION_ASSETS_DIR'),scriptsDirectory:required('RECONSTRUCTION_SCRIPTS_DIR'),workDirectory:env.RECONSTRUCTION_WORK_DIR?.trim()}));
 if(env.PHOTOGRAMMETRY_OPENMVS_DIR?.trim()){
  const ffmpeg=env.PHOTOGRAMMETRY_FFMPEG?.trim(),ffprobe=env.PHOTOGRAMMETRY_FFPROBE?.trim();if(Boolean(ffmpeg)!==Boolean(ffprobe))throw Error('PHOTOGRAMMETRY_VIDEO_TOOLS_INCOMPLETE');
  const blenderExecutable=env.BLENDER_EXECUTABLE?.trim(),blenderScript=env.BLENDER_SCRIPT?.trim();if(Boolean(blenderExecutable)!==Boolean(blenderScript))throw Error('BLENDER_CONFIGURATION_INCOMPLETE');
  engines.push(createPhotogrammetryEngine({pythonExecutable:required('PHOTOGRAMMETRY_PYTHON'),scriptsDirectory:required('RECONSTRUCTION_SCRIPTS_DIR'),openMvsDirectory:required('PHOTOGRAMMETRY_OPENMVS_DIR'),workDirectory:env.RECONSTRUCTION_WORK_DIR?.trim(),...(ffmpeg&&ffprobe?{videoTools:{kind:'native',ffmpeg,ffprobe}}:{}),...(blenderExecutable&&blenderScript?{blender:{executable:blenderExecutable,script:blenderScript}}:{})}));
 }
 if(!engines.length)return undefined;
 return {modes:engines.flatMap(engine=>engine.modes),generate(input){const engine=engines.find(engine=>engine.modes.includes(input.job.payload.mode));if(!engine)return Promise.reject(Error('RECONSTRUCTION_ENGINE_UNAVAILABLE'));return engine.generate(input);}};
}
