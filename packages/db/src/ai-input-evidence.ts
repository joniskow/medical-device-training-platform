import { createHash } from "node:crypto";
import type { AiGatewayRequest } from "@medical-device/contracts";
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==="object"&&!Array.isArray(value);
const stable=(value:unknown):unknown=>Array.isArray(value)?value.map(stable):record(value)?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,stable(item)])):value;
const hash=(value:unknown)=>createHash("sha256").update(JSON.stringify(stable(value))??"null").digest("hex");
const string=(value:unknown)=>typeof value==="string"?value:null;
/** Evidence fingerprints, not a second copy of private prompts/source passages. */
export function aiInputEvidence(request:AiGatewayRequest,promptVersion:string){
 const input=record(request.input)?request.input:{};
 const model=record(input.modelContext)?input.modelContext:undefined;
 return {
  schemaVersion:"ai-input-evidence.v1",
  requestHash:hash({operation:request.operation,input:request.input,sourceArtifactIds:request.sourceArtifactIds,outputSchemaVersion:request.outputSchemaVersion,tokenBudget:request.tokenBudget,promptVersion}),
  tokenBudget:request.tokenBudget,
  instructionHash:hash(input.userInstruction??""),
  retrievalVersion:string(input.retrievalVersion),
  ...(Array.isArray(input.retrievalConfigurations)?{retrievalConfigurations:input.retrievalConfigurations.map(string)}:{}),
  passages:(Array.isArray(input.sourceChunks)?input.sourceChunks:[]).map(value=>{
   const chunk=record(value)?value:{};
   return {chunkId:string(chunk.chunkId),assetVersionId:string(chunk.assetVersionId),sourceHash:string(chunk.sourceHash),textHash:hash(chunk.text??""),citationHash:hash(chunk.citation??null),...(typeof chunk.retrievalConfigurationId==='string'?{retrievalConfigurationId:chunk.retrievalConfigurationId,...(typeof chunk.retrievalRankScore==='number'&&Number.isFinite(chunk.retrievalRankScore)&&chunk.retrievalRankScore>=0?{retrievalRankScore:chunk.retrievalRankScore}:{})}:{})};
  }),
  sourceCoverage:(Array.isArray(input.sourceCoverage)?input.sourceCoverage:[]).map(value=>{
   const coverage=record(value)?value:{};
   return {assetVersionId:string(coverage.assetVersionId),selectedPassages:coverage.selectedPassages,totalPassages:coverage.totalPassages,...(coverage.matchingPassages===undefined?{}:{matchingPassages:coverage.matchingPassages})};
  }),
  model:model?{modelVersionId:string(model.modelVersionId),manifestHash:string(model.manifestHash),metadataHash:hash(model)}:null,
  media:(Array.isArray(input.mediaContext)?input.mediaContext:[]).map(value=>{
   const asset=record(value)?value:{};
   return {assetVersionId:string(asset.assetVersionId),sourceType:string(asset.sourceType),contentType:string(asset.contentType)};
  })
 };
}
