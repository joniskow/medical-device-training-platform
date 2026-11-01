import {authenticatedFetch,getOrganizationHeaders} from './auth-session.js';
/** Only same-origin API paths receive application credentials. */
export const fetchModelAsset:typeof fetch=(input,init={})=>{
 if(typeof input==='string'&&input.startsWith('/api/v1/')){
  const headers=new Headers(init.headers);for(const [key,value] of Object.entries(getOrganizationHeaders()))headers.set(key,value);
  return authenticatedFetch(input,{...init,headers});
 }
 return fetch(input,init);
};
