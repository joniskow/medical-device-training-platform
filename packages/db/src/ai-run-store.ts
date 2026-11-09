import { aiInputEvidence } from "./ai-input-evidence.js";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { AiRunStorePort } from "@medical-device/contracts";
import { withTenantTransaction } from "./tenant-transaction.js";
import {recordTechnicalCost} from './technical-metering.js';

export interface AiCostRate{provider:string;deployment:string;model:string;inputMicroUsdPerMillionTokens:number;outputMicroUsdPerMillionTokens:number}
export function readAiCostRates(value:string|undefined):AiCostRate[]{
 if(!value)return [];if(value.length>32768)throw Error('AI_COST_RATES_INVALID');let parsed:unknown;try{parsed=JSON.parse(value);}catch{throw Error('AI_COST_RATES_INVALID');}
 if(!Array.isArray(parsed)||parsed.length>32||parsed.some(rate=>!rate||typeof rate!=='object'||Object.keys(rate).some(key=>!['provider','deployment','model','inputMicroUsdPerMillionTokens','outputMicroUsdPerMillionTokens'].includes(key))||['provider','deployment','model'].some(key=>typeof rate[key]!=='string'||!/^[A-Za-z0-9._:-]{1,128}$/.test(rate[key]))||['inputMicroUsdPerMillionTokens','outputMicroUsdPerMillionTokens'].some(key=>!Number.isSafeInteger(rate[key])||rate[key]<0||rate[key]>1000000000000)))throw Error('AI_COST_RATES_INVALID');
 const rates=parsed as AiCostRate[];if(new Set(rates.map(rate=>JSON.stringify([rate.provider,rate.deployment,rate.model]))).size!==rates.length)throw Error('AI_COST_RATES_INVALID');return rates;
}

export function createPostgresAiRunStore(pool: Pool,options?:{costRates:readonly AiCostRate[]}): AiRunStorePort {
  if(options)readAiCostRates(JSON.stringify(options.costRates));
  return {
    async record({ tenant, request, result, promptVersion, courseVersionId }) {
      const aiRunId = `ai:${randomUUID()}`;
      let estimatedMicroUsd:number|undefined;
      await withTenantTransaction(pool, tenant, async (client) => {
        await client.query(
          `INSERT INTO ai_runs (
             ai_run_id, organization_id, course_version_id, operation, source_artifact_ids, provider,
             deployment, model, api_version, prompt_version, output_schema_version,
             status, output, citations, warnings, metrics, input_evidence, created_at, updated_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14::jsonb, $15::jsonb, $16::jsonb, $17::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          [
            aiRunId,
            tenant.organizationId,
            courseVersionId ?? tenant.courseVersionId ?? null,
            request.operation,
            request.sourceArtifactIds,
            result.providerMetadata.provider,
            result.providerMetadata.deployment,
            result.providerMetadata.model,
            result.providerMetadata.apiVersion,
            promptVersion,
            request.outputSchemaVersion,
            result.status,
            result.output === undefined ? null : JSON.stringify(result.output),
            JSON.stringify(result.citations),
            JSON.stringify(result.warnings),
            JSON.stringify(result.metrics),
            JSON.stringify(aiInputEvidence(request,promptVersion))
          ]
        );
        for(const [field,meter] of [['inputTokens','ai.input_tokens'],['outputTokens','ai.output_tokens'],['durationMs','ai.duration_ms']] as const){const value=result.metrics[field];if(value!==undefined&&Number.isSafeInteger(value)&&value>=0)await client.query('INSERT INTO usage_meter_events(usage_event_id,organization_id,meter_key,quantity,deduplication_key,metadata,created_at) VALUES($1,$2,$3,$4,$1,$5::jsonb,now()) ON CONFLICT DO NOTHING',[aiRunId+':'+field,tenant.organizationId,meter,value,JSON.stringify({aiRunId,provider:result.providerMetadata.provider,operation:request.operation})]);}
        const rates=options?.costRates.find(rate=>rate.provider===result.providerMetadata.provider&&rate.deployment===result.providerMetadata.deployment&&rate.model===result.providerMetadata.model);
        if(rates&&Number.isSafeInteger(result.metrics.inputTokens)&&Number.isSafeInteger(result.metrics.outputTokens)&&result.metrics.inputTokens!>=0&&result.metrics.outputTokens!>=0){
          const microUsd=Number((BigInt(result.metrics.inputTokens!)*BigInt(rates.inputMicroUsdPerMillionTokens)+BigInt(result.metrics.outputTokens!)*BigInt(rates.outputMicroUsdPerMillionTokens)+999999n)/1000000n);
          estimatedMicroUsd=microUsd;
          await recordTechnicalCost(client,tenant,{eventId:aiRunId,microUsd,provenance:'ESTIMATED_RATE',provider:result.providerMetadata.provider,operation:request.operation});
        }
      });
      const measurements:Record<string,number>={};
      for(const field of ['inputTokens','outputTokens','durationMs'] as const){const value=result.metrics[field];if(Number.isSafeInteger(value)&&value!>=0)measurements[field]=value!;}
      try{
        console.log(JSON.stringify({event:'ai_run_metrics',service:'api',provider:result.providerMetadata.provider==='azure-openai'?'azure-openai':'other',status:['DRAFT','REJECTED','FAILED'].includes(result.status)?result.status:'other',...measurements}));
        if(estimatedMicroUsd!==undefined)console.log(JSON.stringify({event:'cost_recorded',service:'metering',operation:'provider.ai',provider:'azure-openai',provenance:'ESTIMATED_RATE',microUsd:estimatedMicroUsd}));
      }catch{/* A committed AI run does not become a failed provider call when logging fails. */}
      return aiRunId;
    }
  };
}
