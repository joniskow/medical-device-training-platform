// Fail closed until the colocated scanner responds and passes real verdict checks.
import net from 'node:net';
const exchange = command => new Promise((resolve,reject)=>{
 const socket=net.createConnection({host:'127.0.0.1',port:3310});let result='';
 socket.setTimeout(10000,()=>socket.destroy(Error('SCANNER_TIMEOUT')));
 socket.on('connect',()=>socket.write(command));
 socket.on('data',bytes=>{result+=bytes.toString();if(result.includes('\0'))socket.end();});
 socket.on('end',()=>resolve(result));socket.on('error',reject);
});
let ready=false;
for(let attempt=0;attempt<120;attempt++){
 try{if((await exchange(Buffer.from('zPING\0'))).includes('PONG')){ready=true;break;}}catch{}
 await new Promise(resolve=>setTimeout(resolve,5000));
}
if(!ready)throw Error('PRIVATE_SCANNER_NOT_READY');
const scan=bytes=>{const length=Buffer.alloc(4);length.writeUInt32BE(bytes.length);return exchange(Buffer.concat([Buffer.from('zINSTREAM\0'),length,bytes,Buffer.alloc(4)]));};
if(!(await scan(Buffer.from('A harmless scanner startup probe.'))).includes(': OK'))throw Error('SCANNER_CLEAN_PROBE_FAILED');
const fixture=Buffer.from('WDVPIVAlQEFQWzRcUFpYNTQoUF4pN0NDKTd9JEVJQ0FSLVNUQU5EQVJELUFOVElWSVJVUy1URVNULUZJTEUhJEgrSCo=','base64');
if(!(await scan(fixture)).includes(' FOUND'))throw Error('SCANNER_DETECTION_PROBE_FAILED');
console.log(JSON.stringify({event:'scanner_self_test',status:'PASS',clean:true,malwareDetection:true}));
await import('/app/dist/entrypoint.js');
