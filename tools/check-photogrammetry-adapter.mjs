import assert from 'node:assert/strict';
import {mkdtemp,readdir,rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createPhotogrammetryEngine} from '../apps/worker/dist/photogrammetry-engine.js';
const root=await mkdtemp(resolve('output','photogrammetry-adapter-check-'));
try{
 const options={pythonExecutable:process.execPath,scriptsDirectory:resolve('tools/reconstruction'),openMvsDirectory:root,workDirectory:root,calibration:{file:'not-used',sourceHashes:['allowed-source']}};
 const engine=createPhotogrammetryEngine(options);assert.deepEqual(engine.modes,['multi-view']);
 await assert.rejects(()=>engine.generate({job:{payload:{mode:'single-image'}},sources:[]}),/MODE_UNAVAILABLE/);
 await assert.rejects(()=>engine.generate({job:{payload:{mode:'video'}},sources:[{}]}),/MODE_UNAVAILABLE/);
 await assert.rejects(()=>engine.generate({job:{payload:{mode:'multi-view'}},sources:Array(19).fill({})}),/MODE_UNAVAILABLE/);
 await assert.rejects(()=>engine.generate({job:{payload:{mode:'multi-view'}},sources:Array.from({length:20},(_,index)=>({source:{sourceHash:'unapproved-'+index,contentType:'image/png'},bytes:Buffer.from('fixture')}))}),/CALIBRATION_SOURCE_MISMATCH/);
 assert.deepEqual(await readdir(root),[],'Rejected calibration must not leave temporary inputs');
 console.log('Photogrammetry adapter checks passed: explicit mode capabilities, image count, calibration source-hash fence and isolated cleanup.');
}finally{await rm(root,{recursive:true,force:true});}
