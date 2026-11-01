import type {ReconstructionEngine} from '@medical-device/contracts';
import {createSingleImageEngine} from './single-image-engine.js';
import {createPhotogrammetryEngine} from './photogrammetry-engine.js';

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
