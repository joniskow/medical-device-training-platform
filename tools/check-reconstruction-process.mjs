import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {runReconstructionProcess} from '../apps/worker/dist/bounded-reconstruction-process.js';
const root=await mkdtemp(resolve('output','process-tree-check-'));
try{
 const file=join(root,'child.pid');
 const program=`const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{windowsHide:true,stdio:'ignore'});require('node:fs').writeFileSync(process.argv[1],String(child.pid));setInterval(()=>{},1000);`;
 await assert.rejects(()=>runReconstructionProcess(process.execPath,['-e',program,file],1000,process.env),/RECONSTRUCTION_PROCESS_TIMEOUT/);
 const pid=Number(await readFile(file,'utf8'));let alive=true;for(let index=0;index<100;index++){try{process.kill(pid,0);}catch{alive=false;break;}await new Promise(resolve=>setTimeout(resolve,20));}assert.equal(alive,false,'The timed-out job must not leave its child process running');
 await assert.rejects(()=>runReconstructionProcess(process.execPath,['-e',"process.stdout.write('x'.repeat(2*1024*1024));setInterval(()=>{},1000)"],3000,process.env),/OUTPUT_LIMIT/);
 const completed=await runReconstructionProcess(process.execPath,['-e',"process.stdout.write('completed')"],3000,process.env);assert.equal(completed.stdout,'completed');
 console.log('Reconstruction process checks passed: complete process-tree timeout, bounded output and ordinary completion.');
}finally{await rm(root,{recursive:true,force:true});}
