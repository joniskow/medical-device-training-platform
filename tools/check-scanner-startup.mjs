import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const bash=process.platform==='win32'?'C:/Program Files/Git/bin/bash.exe':'bash';
assert.ok(process.platform!=='win32'||existsSync(bash),'Git Bash is required for the shell startup regression test');
const source=readFileSync(new URL('../infra/scanner/start-scanner.sh',import.meta.url),'utf8');
// Replace only the final process handoff; exercise the actual fail-closed shell ordering.
const script=source.replace('exec /init "$@"',"printf 'SUPERVISOR_STARTED\\n'");
assert.notEqual(script,source);
for(const status of [0,1]){
 const result=spawnSync(bash,['-c',`chown(){ :; }; freshclam(){ printf 'REFRESH_ATTEMPTED\\n'; return ${status}; };\n${script}`],{encoding:'utf8'});
 assert.equal(result.status,status,result.stderr);
 assert.equal(result.stdout,status===0?'REFRESH_ATTEMPTED\nSUPERVISOR_STARTED\n':'REFRESH_ATTEMPTED\n');
}
console.log('Scanner startup passed: refresh completes before daemon startup; refresh failure prevents startup.');
