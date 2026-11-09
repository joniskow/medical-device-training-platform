import {createHash,createHmac,randomInt,randomUUID} from 'node:crypto';
import type {createEmailVerificationStore} from '@medical-device/db';
import type {AuthenticatedPrincipal} from './job-status-http.js';

type VerificationIdentity={subject:string;issuer:string;identityTenant:string};
type VerificationStore=ReturnType<typeof createEmailVerificationStore>;
export interface VerificationEmailSender {sendVerification(input:{email:string;code:string;expiresInMinutes:number}):Promise<void>}
export function verificationIdentityKey(identity:VerificationIdentity):string {
 if(!identity.subject||!identity.issuer||!identity.identityTenant)throw Error('VERIFICATION_IDENTITY_REQUIRED');
 return createHash('sha256').update(JSON.stringify([identity.issuer,identity.identityTenant,identity.subject])).digest('hex');
}
/** Durable independent email possession assurance; never modifies or manufactures signed claims. */
export function createEmailVerificationService(options:{store:VerificationStore;sender:VerificationEmailSender;secret:string}){
 if(Buffer.byteLength(options.secret)<32)throw Error('VERIFICATION_SECRET_TOO_SHORT');
 const hash=(identityKey:string,id:string,code:string)=>createHmac('sha256',options.secret).update(JSON.stringify([identityKey,id,code])).digest('hex');
 return {
  async start(identity:VerificationIdentity,emailInput:string){
   const email=emailInput.trim().toLowerCase();
   if(email.length>254||!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email))throw Error('VERIFICATION_INPUT_INVALID');
   const identityKey=verificationIdentityKey(identity),challengeId=randomUUID(),code=String(randomInt(0,1_000_000)).padStart(6,'0');
   if(!await options.store.issue(identityKey,challengeId,email,hash(identityKey,challengeId,code)))throw Error('VERIFICATION_RATE_LIMITED');
   try{await options.sender.sendVerification({email,code,expiresInMinutes:10});}catch{await options.store.invalidate(identityKey,challengeId);throw Error('VERIFICATION_DELIVERY_UNAVAILABLE');}
   return {challengeId,expiresInSeconds:600};
  },
  async complete(identity:VerificationIdentity,input:{challengeId:string;code:string}){
   if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.challengeId)||!/^\d{6}$/.test(input.code))throw Error('VERIFICATION_UNAVAILABLE');
   const identityKey=verificationIdentityKey(identity);
   const assurance=await options.store.consume(identityKey,input.challengeId,hash(identityKey,input.challengeId,input.code));
   if(!assurance)throw Error('VERIFICATION_UNAVAILABLE');
   return assurance;
  },
  async assurance(identity:VerificationIdentity){return options.store.get(verificationIdentityKey(identity));},
  async enrich(principal:AuthenticatedPrincipal & {authenticationExpiresAt?:string}):Promise<AuthenticatedPrincipal>{
   if(principal.verifiedEmail)return principal;
   const tokenExpiry=Date.parse(principal.authenticationExpiresAt??'');
   if(!Number.isFinite(tokenExpiry)||tokenExpiry<=Date.now()||!principal.issuer||!principal.identityTenant)return principal;
   const assurance=await options.store.get(verificationIdentityKey({subject:principal.subject,issuer:principal.issuer,identityTenant:principal.identityTenant}));
   if(!assurance)return principal;
   const expiresAt=Math.min(tokenExpiry,Date.parse(assurance.verificationExpiresAt));
   if(!Number.isFinite(expiresAt)||expiresAt<=Date.now())return principal;
   return {...principal,verifiedEmail:assurance.verifiedEmail,verificationExpiresAt:new Date(expiresAt).toISOString()};
  },
  async revoke(identity:VerificationIdentity){return options.store.revoke(verificationIdentityKey(identity));}
 };
}
