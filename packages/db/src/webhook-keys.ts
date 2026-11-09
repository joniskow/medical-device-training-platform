export {deriveCustomerWebhookSecret as deriveWebhookSecret} from './customer-webhooks.js';

/** Strict configuration parser shared by API provisioning and worker signing. Never includes key data in errors. */
export function readWebhookKeys(value:string|undefined):ReadonlyMap<string,Buffer>{
 if(value===undefined||value==='')return new Map();
 if(value.length>16384)throw Error('WEBHOOK_KEYS_CONFIGURATION_INVALID');
 let object:unknown;try{object=JSON.parse(value);}catch{throw Error('WEBHOOK_KEYS_CONFIGURATION_INVALID');}
 if(!object||typeof object!=='object'||Array.isArray(object))throw Error('WEBHOOK_KEYS_CONFIGURATION_INVALID');
 const entries=Object.entries(object);if(!entries.length||entries.length>16)throw Error('WEBHOOK_KEYS_CONFIGURATION_INVALID');
 const keys=new Map<string,Buffer>();
 for(const [id,encoded] of entries){
  if(!/^[A-Za-z0-9._:-]{1,64}$/.test(id)||['__proto__','prototype','constructor'].includes(id)||typeof encoded!=='string'||!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))throw Error('WEBHOOK_KEYS_CONFIGURATION_INVALID');
  const key=Buffer.from(encoded,'base64');if(key.length<32||key.length>64||key.toString('base64')!==encoded)throw Error('WEBHOOK_KEYS_CONFIGURATION_INVALID');keys.set(id,key);
 }
 return keys;
}
