import assert from 'node:assert/strict';
import {createServer} from 'node:net';
import {createHash} from 'node:crypto';
import {createClamAvAssetScanner,createAssetScannerFromEnvironment} from '../apps/worker/dist/asset-scanner.js';
const bytes=Buffer.from('%PDF-1.7\nscan fixture');
const request={inputAssetVersionId:'asset1',sourceType:'pdf',blobKey:'org_test/source',sha256:createHash('sha256').update(bytes).digest('hex'),sizeBytes:bytes.length,contentType:'application/pdf'};
const storage={readObject:async()=>({bytes,contentType:'application/pdf'})};
let verdict='stream: OK\0',received=Buffer.alloc(0);
const server=createServer(socket=>{socket.on('data',chunk=>{received=Buffer.concat([received,chunk]);if(received.subarray(-4).equals(Buffer.alloc(4)))socket.end(verdict);});});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const scanner=createClamAvAssetScanner({host:'127.0.0.1',port:server.address().port,timeoutMs:1000});
try {
 assert.deepEqual(await scanner.scan({request,storage}),{status:'CLEAN',reasons:[]});
 assert.equal(received.subarray(0,10).toString(),'zINSTREAM\0');
 received=Buffer.alloc(0);verdict='stream: Eicar-Test-Signature FOUND\0';
 assert.equal((await scanner.scan({request,storage})).status,'QUARANTINE');
 received=Buffer.alloc(0);verdict='stream: unexpected ERROR\0';
 assert.equal((await scanner.scan({request,storage})).status,'QUARANTINE');
 assert.equal((await scanner.scan({request:{...request,sha256:'0'.repeat(64)},storage})).reasons.includes('CONTENT_HASH_MISMATCH'),true);
 assert.throws(()=>createAssetScannerFromEnvironment({APP_ENV:'production',ASSET_SCANNER_MODE:'deterministic'}));
} finally {await new Promise(resolve=>server.close(resolve));}
assert.equal((await scanner.scan({request,storage})).status,'QUARANTINE');
console.log('Production scanner protocol, clean/malware/error/hash/outage and configuration checks passed.');
