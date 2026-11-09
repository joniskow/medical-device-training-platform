import type {TenantContext} from './index.js';

export interface SourceEmbeddingProvider {
  /** Versioned provider/deployment/model identity; incompatible vectors never mix. */
  readonly configurationId:string;
  readonly dimensions:1536;
  embed(tenant:TenantContext,texts:readonly string[]):Promise<readonly (readonly number[])[]>;
}

export function validateEmbedding(vector:readonly number[]):void {
  if(vector.length!==1536||vector.some(value=>!Number.isFinite(value))||!vector.some(value=>value!==0))throw Error('EMBEDDING_INVALID');
}
