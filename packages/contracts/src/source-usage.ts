export const sourceUsageOperations=['storage.read','storage.write','storage.delete','storage.properties','storage.quarantine','storage.upload_grant','storage.download_grant','provider.speech','provider.video','provider.reconstruction','provider.embeddings','processing.job'] as const;
export const sourceUsageUnits=['calls','bytes','duration_ms','input_characters','input_tokens','audio_ms','video_ms','input_bytes','output_bytes'] as const;
export type SourceUsageOperation = typeof sourceUsageOperations[number];
export type SourceUsageUnit = typeof sourceUsageUnits[number];
export interface SourceUsageReceipt {
  receiptId:string;
  operation:SourceUsageOperation;
  provider:string;
  phase:'STARTED'|'SUCCEEDED'|'FAILED';
  metrics:Partial<Record<SourceUsageUnit,number>>;
}
export interface SourceUsageRate {
  rateId:string;
  operation:SourceUsageOperation;
  provider:string;
  unit:SourceUsageUnit;
  microUsdPerMillionUnits:number;
}
