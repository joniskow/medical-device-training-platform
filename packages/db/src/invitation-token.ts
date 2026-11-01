import {createHmac} from 'node:crypto';
/** Delivery-only secret derivation. Never persist the result or place it in logs. */
export function invitationDeliveryToken(invitationId:string,keyId:string,keys:ReadonlyMap<string,Buffer>){
 const key=keys.get(keyId);if(!key||key.length<32)throw Error('INVITATION_KEY_UNAVAILABLE');
 return createHmac('sha256',key).update('organization-invitation:v1:'+invitationId).digest('base64url');
}
