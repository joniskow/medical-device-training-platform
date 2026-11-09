import {createHash,createHmac} from 'node:crypto';
import type {Pool} from 'pg';
import type {SourceUsageReceipt,SourceUsageRate,TenantContext} from '@medical-device/contracts';
import {sourceUsageOperations,sourceUsageUnits} from '@medical-device/contracts';
import {withTenantTransaction} from './tenant-transaction.js';
import {recordTechnicalCost} from './technical-metering.js';

const operations=new Set<string>(sourceUsageOperations);
const units=new Set<string>(sourceUsageUnits);
const id=(value:unknown):value is string=>typeof value==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(value);
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function readSourceUsageRates(raw:string|undefined):SourceUsageRate[]{
  if(!raw)return [];
  try{
    if(raw.length>32768)throw Error();
    const parsed=JSON.parse(raw);
    if(!Array.isArray(parsed)||parsed.length>64||parsed.some(rate=>!rate||typeof rate!=='object'||Object.keys(rate).some(key=>!['rateId','operation','provider','unit','microUsdPerMillionUnits'].includes(key))||!id(rate.rateId)||!operations.has(rate.operation)||!id(rate.provider)||rate.provider.length>80||!units.has(rate.unit)||!Number.isSafeInteger(rate.microUsdPerMillionUnits)||rate.microUsdPerMillionUnits<0||rate.microUsdPerMillionUnits>1e12))throw Error();
    if(new Set(parsed.map(rate=>JSON.stringify([rate.operation,rate.provider,rate.unit]))).size!==parsed.length)throw Error();
    return parsed;
  }catch{throw Error('SOURCE_USAGE_RATES_INVALID');}
}
export function createSourceUsageMeteringStore(pool:Pool,options:{rates?:readonly SourceUsageRate[];telemetrySecret?:string;sink?:(line:string)=>void}={}){
  if(options.telemetrySecret!==undefined&&options.telemetrySecret.length<32)throw Error('SOURCE_TELEMETRY_SECRET_INVALID');
  const rates=readSourceUsageRates(JSON.stringify(options.rates??[]));
  const record=async(tenant:TenantContext,receipt:SourceUsageReceipt)=>{
    if(!id(receipt.receiptId)||!operations.has(receipt.operation)||!id(receipt.provider)||receipt.provider.length>80||!['STARTED','SUCCEEDED','FAILED'].includes(receipt.phase)||!receipt.metrics||Object.keys(receipt.metrics).length>9||Object.entries(receipt.metrics).some(([unit,value])=>!units.has(unit)||!Number.isSafeInteger(value)||value!<0||value!>1e12))throw Error('SOURCE_USAGE_RECEIPT_INVALID');
    const result=await withTenantTransaction(pool,tenant,async client=>{
      const sourceId='source:'+hash([tenant.organizationId,receipt.receiptId,receipt.phase]);
      const metadata={sourceReceiptId:receipt.receiptId,operation:receipt.operation,provider:receipt.provider,phase:receipt.phase,provenance:'SOURCE_METER'};
      const fingerprint=hash([metadata,Object.entries(receipt.metrics).sort(([a],[b])=>a.localeCompare(b))]);
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[sourceId]);
      const prior=(await client.query('SELECT metadata FROM usage_meter_events WHERE organization_id=$1 AND usage_event_id=$2',[tenant.organizationId,sourceId])).rows[0];
      if(prior){if(prior.metadata.fingerprint!==fingerprint)throw Error('IDEMPOTENCY_KEY_REUSED');return {sourceUsageEventId:sourceId,replayed:true,estimatedMicroUsd:0};}
      await client.query('INSERT INTO usage_meter_events(usage_event_id,organization_id,meter_key,quantity,deduplication_key,metadata,created_at) VALUES($1,$2,$3,1,$1,$4::jsonb,now())',[sourceId,tenant.organizationId,`${receipt.operation}.receipts.${receipt.phase.toLowerCase()}`,JSON.stringify({...metadata,fingerprint})]);
      for(const [unit,value]of Object.entries(receipt.metrics)){
        const eventId='unit:'+hash([sourceId,unit]);
        await client.query('INSERT INTO usage_meter_events(usage_event_id,organization_id,meter_key,quantity,deduplication_key,metadata,created_at) VALUES($1,$2,$3,$4,$1,$5::jsonb,now())',[eventId,tenant.organizationId,`${receipt.operation}.${receipt.phase.toLowerCase()}.${unit}`,value,JSON.stringify(metadata)]);
      }
      // Only completed source measurements can receive an estimate. Unknown/failed calls
      // remain visible as source receipts; their admission reservation is retained separately.
      let estimatedMicroUsd=0;
      if(receipt.phase==='SUCCEEDED')for(const rate of rates){
        const quantity=receipt.metrics[rate.unit];
        if(rate.operation!==receipt.operation||rate.provider!==receipt.provider||quantity===undefined)continue;
        const microUsd=Number((BigInt(quantity)*BigInt(rate.microUsdPerMillionUnits)+999999n)/1000000n);
        estimatedMicroUsd+=microUsd;
        const cost=await recordTechnicalCost(client,tenant,{eventId:'rate:'+hash([sourceId,rate.rateId,rate.unit]),microUsd,provenance:'ESTIMATED_RATE',provider:receipt.provider,operation:receipt.operation});
        await client.query('UPDATE usage_meter_events SET metadata=metadata||$3::jsonb WHERE organization_id=$1 AND usage_event_id=$2',[tenant.organizationId,cost.usageEventId,JSON.stringify({rateId:rate.rateId,unit:rate.unit,microUsdPerMillionUnits:rate.microUsdPerMillionUnits,sourceUsageEventId:sourceId,measuredQuantity:quantity})]);
      }
      return {sourceUsageEventId:sourceId,replayed:false,estimatedMicroUsd};
    });
    if(!result.replayed&&receipt.phase!=='STARTED'){
      const providers=new Set(['azure-blob','azure-speech','openmontage','reconstruction-engine','worker','azure-openai','azure-openai-embeddings']);
      const emit=(value:unknown)=>{try{(options.sink??console.log)(JSON.stringify(value));}catch{/* Durable receipts remain authoritative if the best-effort telemetry sink is unavailable. */}};
      emit({event:'source_usage',service:'metering',operation:receipt.operation,provider:providers.has(receipt.provider)?receipt.provider:'other',phase:receipt.phase,...receipt.metrics,...(options.telemetrySecret?{correlationHash:createHmac('sha256',options.telemetrySecret).update(tenant.correlationId).digest('hex')}:{})});
      if(result.estimatedMicroUsd>0)emit({event:'cost_recorded',service:'metering',provenance:'ESTIMATED_RATE',microUsd:result.estimatedMicroUsd,operation:receipt.operation,provider:providers.has(receipt.provider)?receipt.provider:'other'});
    }
    return {sourceUsageEventId:result.sourceUsageEventId};
  };
  return {record,storage:async(input:{organizationId:string;receipt:SourceUsageReceipt})=>record({organizationId:input.organizationId,actorId:'storage-meter',correlationId:input.receipt.receiptId},input.receipt)};
}
