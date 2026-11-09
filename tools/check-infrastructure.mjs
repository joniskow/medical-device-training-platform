import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile,mkdir,readdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const compiler=process.env.BICEP_CLI;
if(!compiler)throw Error('BICEP_CLI_REQUIRED');
const execute=args=>{const result=spawnSync(compiler,args,{encoding:'utf8',windowsHide:true,shell:false,timeout:60000,maxBuffer:4*1024*1024});if(result.error||result.status!==0||/\bWarning\b/.test(result.stderr??''))throw Error('INFRASTRUCTURE_COMPILE_FAILED');return result.stdout.trim();};
const version=execute(['--version']);if(!version.startsWith('Bicep CLI version 0.49.2 '))throw Error('BICEP_VERSION_MISMATCH');
const target=resolve('output/infrastructure');await mkdir(target,{recursive:true});
const results=[];
for(const file of (await readdir('infra/azure')).filter(name=>name.endsWith('.bicep')).sort()){
 const source=resolve('infra/azure',file),output=resolve(target,file+'.json');execute(['build',source,'--outfile',output]);
 results.push({file,sourceSha256:createHash('sha256').update(await readFile(source)).digest('hex'),artifactSha256:createHash('sha256').update(await readFile(output)).digest('hex')});
}
if(!results.length)throw Error('INFRASTRUCTURE_SUITE_EMPTY');
await writeFile(resolve(target,'compilation.json'),JSON.stringify({version,compilerSha256:createHash('sha256').update(await readFile(compiler)).digest('hex'),results},null,2)+'\n');
console.log(`Infrastructure passed: ${results.length} templates, pinned Bicep 0.49.2, no diagnostics. Compilation is not cloud deployment validation.`);
