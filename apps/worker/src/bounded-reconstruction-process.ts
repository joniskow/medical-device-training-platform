import {spawn,execFileSync} from 'node:child_process';
import {join} from 'node:path';

/** Kill our complete process tree before allowing temporary-input cleanup. */
export function runReconstructionProcess(executable:string,args:string[],timeout:number,env:NodeJS.ProcessEnv,signal?:AbortSignal){
 return new Promise<{stdout:string;stderr:string}>((resolve,reject)=>{
  if(signal?.aborted){reject(Error('RECONSTRUCTION_PROCESS_CANCELLED'));return;}
  const child=spawn(executable,args,{windowsHide:true,detached:process.platform!=='win32',stdio:['ignore','pipe','pipe'],env});
  const stdout:Buffer[]=[],stderr:Buffer[]=[];let size=0,failure:Error|undefined,finished=false,childClosed=false,killPending=false,terminationGracePending=false;
  const finish=(error?:Error)=>{if(finished)return;finished=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);error?reject(Object.assign(error,{stderr:Buffer.concat(stderr).toString()})):resolve({stdout:Buffer.concat(stdout).toString(),stderr:Buffer.concat(stderr).toString()});};
  const stop=(error:Error)=>{if(failure)return;failure=error;
   if(!child.pid)return;
   if(process.platform==='win32'){
    killPending=true;let killFailed=false;
    try{execFileSync(join(process.env.SystemRoot??'C:\\Windows','System32','taskkill.exe'),['/PID',String(child.pid),'/T','/F'],{windowsHide:true,timeout:10_000,stdio:'ignore'});}
    catch{killFailed=true;}
    killPending=false;terminationGracePending=true;
    setTimeout(()=>{terminationGracePending=false;if(killFailed&&!childClosed&&!finished)finish(Object.assign(error,{processStillRunning:true}));else if(childClosed&&!finished)finish(failure);else if(!childClosed&&!finished)finish(Object.assign(error,{processStillRunning:true}));},killFailed?1000:250);
   }
   else try{process.kill(-child.pid,'SIGKILL');}catch(killError){if((killError as NodeJS.ErrnoException).code!=='ESRCH')finish(Object.assign(error,{processStillRunning:true}));}
  };
  const collect=(chunks:Buffer[])=>(chunk:Buffer)=>{size+=chunk.length;if(size>1024*1024){stop(Error('RECONSTRUCTION_PROCESS_OUTPUT_LIMIT'));return;}chunks.push(chunk);};
  child.stdout.on('data',collect(stdout));child.stderr.on('data',collect(stderr));
  child.once('error',error=>finish(error));child.once('close',code=>{childClosed=true;if(!failure)finish(code===0?undefined:Error('RECONSTRUCTION_PROCESS_FAILED'));else if(!killPending&&!terminationGracePending)finish(failure);});
  const timer=setTimeout(()=>stop(Error('RECONSTRUCTION_PROCESS_TIMEOUT')),timeout);
  const abort=()=>stop(Error('RECONSTRUCTION_PROCESS_CANCELLED'));
  signal?.addEventListener('abort',abort,{once:true});
  if(signal?.aborted)abort();
 });
}
