export interface InvitationKeys {activeKeyId:string;keys:ReadonlyMap<string,Buffer>;expiryHours:number}
export function readInvitationConfiguration(environment:NodeJS.ProcessEnv):InvitationKeys{
  const raw=environment.INVITATION_TOKEN_KEYS_JSON?.trim();
  const activeKeyId=environment.INVITATION_ACTIVE_KEY_ID?.trim()??'';
  const expiryHours=Number(environment.INVITATION_EXPIRY_HOURS??72);
  const keys=new Map<string,Buffer>();
  try{
    if(raw){
      const parsed:unknown=JSON.parse(raw);
      if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw Error();
      for(const [id,value] of Object.entries(parsed)){
        if(!/^[A-Za-z0-9._-]{1,128}$/.test(id)||typeof value!=='string'||!/^[a-fA-F0-9]{64}$/.test(value))throw Error();
        keys.set(id,Buffer.from(value,'hex'));
      }
    }
    if((keys.size>0&&!keys.has(activeKeyId))||(activeKeyId&&!keys.has(activeKeyId))||!Number.isInteger(expiryHours)||expiryHours<1||expiryHours>168)throw Error();
  }catch{throw Error('INVITATION_CONFIGURATION_INVALID');}
  // Empty key configuration permits acceptance of issued tokens, but creation fails closed.
  return {keys,activeKeyId,expiryHours};
}
