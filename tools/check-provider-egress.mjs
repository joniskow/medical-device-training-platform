import assert from 'node:assert/strict';
import {isPublicAddress,approvedUrl,boundedHttpsRequest} from '../apps/worker/dist/provider-egress.js';
for(const address of ['127.0.0.1','10.1.2.3','169.254.169.254','172.16.0.1','192.168.0.1','100.64.0.1','198.18.0.1','::1','::ffff:8.8.8.8','fc00::1','fe80::1','2001:db8::1'])assert.equal(isPublicAddress(address),false,address);
for(const address of ['8.8.8.8','1.1.1.1','2606:4700:4700::1111'])assert.equal(isPublicAddress(address),true,address);
const origins=new Set(['https://provider.example']);
for(const value of ['http://provider.example','https://attacker.example','https://user:secret@provider.example','https://provider.example/#x','file:///etc/passwd'])assert.throws(()=>approvedUrl(value,origins));
assert.equal(approvedUrl('https://provider.example/jobs/1',origins).origin,'https://provider.example');
await assert.rejects(boundedHttpsRequest({url:'https://127.0.0.1',origins:new Set(['https://127.0.0.1']),maxBytes:100,timeoutMs:100}),/DESTINATION_DENIED/);
console.log('Provider destination and private-address controls passed.');
