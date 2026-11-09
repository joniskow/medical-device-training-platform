import {createConnection} from 'node:net';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import type {AssetScannerPort} from '@medical-device/contracts';
import type { AssetProcessingRequest, AssetScanResult, PrivateObjectStoragePort } from "@medical-device/contracts";

const EICAR = Buffer.from("X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*", "ascii");

function startsWith(bytes: Uint8Array, signature: Uint8Array): boolean {
  return signature.every((value, index) => bytes[index] === value);
}

function hasEicar(bytes: Uint8Array): boolean {
  outer: for (let offset = 0; offset <= bytes.length - EICAR.length; offset += 1) {
    for (let index = 0; index < EICAR.length; index += 1) {
      if (bytes[offset + index] !== EICAR[index]) continue outer;
    }
    return true;
  }
  return false;
}

function hasExpectedMagic(sourceType: AssetProcessingRequest["sourceType"], bytes: Uint8Array): boolean {
  if (sourceType === "pdf") return startsWith(bytes, Buffer.from("%PDF-", "ascii"));
  if (sourceType === "image") {
    return startsWith(bytes, Uint8Array.from([0x89, 0x50, 0x4e, 0x47]))
      || startsWith(bytes, Uint8Array.from([0xff, 0xd8, 0xff]))
      || (bytes.length >= 12 && Buffer.from(bytes.slice(8, 12)).toString("ascii") === "WEBP");
  }
  if (sourceType === "glb") return startsWith(bytes, Buffer.from("glTF", "ascii"));
  if (sourceType === "gltf") {
    try {
      const parsed = JSON.parse(Buffer.from(bytes).toString("utf8")) as { asset?: unknown };
      return Boolean(parsed && typeof parsed === "object" && parsed.asset);
    } catch {
      return false;
    }
  }
  return bytes.length > 0;
}

export function createDeterministicAssetScanner(): {
  scan(input: { request: AssetProcessingRequest; storage: PrivateObjectStoragePort }): Promise<AssetScanResult>;
} {
  return {
    async scan({ request, storage }) {
      const object = await storage.readObject({ blobKey: request.blobKey, maxBytes: request.sizeBytes });
      const reasons: string[] = [];
      if (request.sizeBytes !== undefined && object.bytes.byteLength !== request.sizeBytes) reasons.push("CONTENT_SIZE_MISMATCH");
      if (request.contentType && object.contentType.toLowerCase() !== request.contentType.toLowerCase()) reasons.push("CONTENT_TYPE_MISMATCH");
      if (hasEicar(object.bytes)) reasons.push("MALWARE_SIGNATURE_EICAR");
      if (!hasExpectedMagic(request.sourceType, object.bytes)) reasons.push("CONTENT_SIGNATURE_MISMATCH");
      return { status: reasons.length === 0 ? "CLEAN" : "QUARANTINE", reasons };
    }
  };
}

/** clamd INSTREAM scans the exact bytes subsequently checked against the queued SHA-256. */
export function createClamAvAssetScanner(options: {host: string; port?: number; timeoutMs?: number; maxBytes?: number}): AssetScannerPort {
  const port = options.port ?? 3310;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const maxBytes = options.maxBytes ?? 128 * 1024 * 1024;
  if (!options.host.trim() || !Number.isInteger(port) || port < 1 || port > 65535 || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || !Number.isSafeInteger(maxBytes) || maxBytes < 1) throw Error('CLAMAV_CONFIGURATION_INVALID');
  return {async scan({request,storage}) {
    try {
      const object = await storage.readObject({blobKey:request.blobKey,maxBytes});
      const reasons: string[] = [];
      if (object.bytes.byteLength > maxBytes) reasons.push('CONTENT_TOO_LARGE');
      if (request.sizeBytes !== undefined && object.bytes.byteLength !== request.sizeBytes) reasons.push('CONTENT_SIZE_MISMATCH');
      if (!/^[a-f0-9]{64}$/i.test(request.sha256) || createHash('sha256').update(object.bytes).digest('hex') !== request.sha256.toLowerCase()) reasons.push('CONTENT_HASH_MISMATCH');
      if (request.contentType && object.contentType.toLowerCase() !== request.contentType.toLowerCase()) reasons.push('CONTENT_TYPE_MISMATCH');
      if (!hasExpectedMagic(request.sourceType,object.bytes)) reasons.push('CONTENT_SIGNATURE_MISMATCH');
      if (reasons.length) return {status:'QUARANTINE',reasons};
      const verdict = await scanStream(object.bytes,{host:options.host,port,timeoutMs});
      return verdict === 'stream: OK' ? {status:'CLEAN',reasons:[]} : {status:'QUARANTINE',reasons:[verdict.endsWith(' FOUND') ? 'MALWARE_DETECTED' : 'SCANNER_VERDICT_UNTRUSTED']};
    } catch {return {status:'QUARANTINE',reasons:['SCANNER_UNAVAILABLE']};}
  }};
}

async function scanStream(bytes: Uint8Array, options: {host:string;port:number;timeoutMs:number}): Promise<string> {
  return new Promise((resolve,reject)=>{
    const socket = createConnection({host:options.host,port:options.port});
    let result = '';
    const timer = setTimeout(()=>finish(Error('CLAMAV_TIMEOUT')),options.timeoutMs);
    let settled = false;
    function finish(error?: Error, verdict?: string) {
      if(settled) return;
      settled=true;clearTimeout(timer);socket.destroy();
      if(error) reject(error);else resolve(verdict!);
    }
    socket.on('error',error=>finish(error));
    socket.on('end',()=>finish(Error('CLAMAV_TRUNCATED_RESPONSE')));
    socket.on('data',chunk=>{
      result += chunk.toString('utf8');
      if(result.length>4096) {finish(Error('CLAMAV_RESPONSE_TOO_LARGE'));return;}
      const end=result.indexOf('\0');
      if(end>=0) finish(undefined,result.slice(0,end));
    });
    socket.on('connect',()=>{void (async()=>{
      async function write(chunk:Uint8Array) {if(!socket.write(chunk)) await once(socket,'drain');}
      await write(Buffer.from('zINSTREAM\0'));
      for(let offset=0;offset<bytes.byteLength;offset+=64*1024){
        const chunk=bytes.subarray(offset,offset+64*1024);const length=Buffer.alloc(4);length.writeUInt32BE(chunk.byteLength);
        await write(length);await write(chunk);
      }
      await write(Buffer.alloc(4));
    })().catch(error=>finish(error));});
  });
}

export function createAssetScannerFromEnvironment(env: Readonly<Record<string,string|undefined>> = process.env): AssetScannerPort {
  const production=['production','staging'].includes(env.APP_ENV?.trim().toLowerCase() ?? '');
  const mode=env.ASSET_SCANNER_MODE?.trim().toLowerCase() ?? 'deterministic';
  if(mode==='clamav') return createClamAvAssetScanner({host:env.CLAMAV_HOST ?? '',port:env.CLAMAV_PORT ? Number(env.CLAMAV_PORT) : undefined,timeoutMs:env.CLAMAV_TIMEOUT_MS ? Number(env.CLAMAV_TIMEOUT_MS) : undefined,maxBytes:env.PROVIDER_MAX_BYTES ? Number(env.PROVIDER_MAX_BYTES) : undefined});
  if(production || mode!=='deterministic') throw Error('PRODUCTION_SCANNER_REQUIRED');
  return createDeterministicAssetScanner();
}
