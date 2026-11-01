const accessTokenKey = "mdt.auth.access-token";
let memoryToken: string | undefined;
const organizationKey='mdt.auth.organization-id';
export function getOrganizationHeaders():Record<string,string>{
  const organizationId=sessionStorageOrUndefined()?.getItem(organizationKey);
  const link=typeof document!=='undefined'?document.querySelector('[data-org-link]'):null;
  if(link)link.textContent=organizationId?`Organization: ${organizationId}`:'Choose organization';
  return organizationId?{'x-organization-id':organizationId}:{};
}
export function setOrganizationId(value:string){
  if(!value||value.length>128)throw Error('ORGANIZATION_SELECTION_INVALID');
  // Persistent selection is required because switching reloads all tenant-bound views.
  const storage=sessionStorageOrUndefined();if(!storage)throw Error('Session storage is required to switch organizations.');
  storage.setItem(organizationKey,value);
}

function sessionStorageOrUndefined(): Storage | undefined {
  try {
    return typeof sessionStorage === "undefined" ? undefined : sessionStorage;
  } catch {
    return undefined;
  }
}

export function getAccessToken(): string | undefined {
  const storage = sessionStorageOrUndefined();
  if (storage) memoryToken = storage.getItem(accessTokenKey)?.trim() || undefined;
  return memoryToken;
}

export function setAccessToken(token: string): void {
  const normalized = token.trim();
  if (!normalized) throw new Error("ACCESS_TOKEN_INVALID");
  if(getAccessToken()!==normalized)try{sessionStorageOrUndefined()?.removeItem(organizationKey);}catch{}
  memoryToken = normalized;
  try { sessionStorageOrUndefined()?.setItem(accessTokenKey, normalized); } catch { /* memory-only fallback */ }
}

export function clearAccessToken(): void {
  const storage=sessionStorageOrUndefined();
  const managedAccount=storage?.getItem('mdt.auth.managed-account');
  try { if(storage){
    storage.setItem('mdt.auth.epoch',crypto.randomUUID());
    storage.removeItem('mdt.auth.signin-pending');
    storage.removeItem('mdt.auth.managed-account');
    storage.removeItem('mdt.auth.return-course');
    if(managedAccount)storage.setItem('mdt.auth.logout-account',managedAccount);
  }} catch { /* Local token cleanup must still run when storage is unavailable. */ }
  memoryToken = undefined;
  try { sessionStorageOrUndefined()?.removeItem(accessTokenKey); } catch { /* memory-only fallback */ }
  try { sessionStorageOrUndefined()?.removeItem(organizationKey); } catch {}
  getOrganizationHeaders();
  if(managedAccount)window.location.assign('/signout');
}

/** Stable across bearer renewal, changes on account or organization switching. */
export function getSessionIdentity():string {
 const storage=sessionStorageOrUndefined();
 const account=storage?.getItem('mdt.auth.managed-account');
 return JSON.stringify([account??getAccessToken()??null,account?storage?.getItem('mdt.auth.epoch'):null,storage?.getItem(organizationKey)??null]);
}

export const authenticatedFetch:typeof fetch=async(input,init={})=>{
 if(input instanceof Request)throw Error('Authenticated requests must use an explicit API URL.');
 const url=new URL(String(input),window.location.origin);
 if(url.origin!==window.location.origin||url.username||url.password||!url.pathname.startsWith('/api/v1/'))throw Error('Authenticated request destination is not allowed.');
 const identity=getSessionIdentity();
 const originalToken=getAccessToken();
 if(!originalToken)throw Error('Sign in to continue.');
 const account=sessionStorageOrUndefined()?.getItem('mdt.auth.managed-account');
 const token=account?await (await import('./managed-auth.js')).renewAccessToken():originalToken;
 if(identity!==getSessionIdentity())throw Error('Your session changed. Reload before continuing.');
 const headers=new Headers(init.headers);headers.set('authorization',`Bearer ${token}`);
 // Preserve the caller's header representation for existing browser clients.
 const requestHeaders=init.headers instanceof Headers?headers:Object.fromEntries(headers.entries());
 const response=await fetch(input,{...init,headers:requestHeaders,credentials:'omit',redirect:'error'});
 if(identity!==getSessionIdentity())throw Error('Your session changed. Reload before continuing.');
 return response;
};

const returnCourseKey='mdt.auth.return-course';
export function rememberCandidateCourse(publicId:string):void{
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(publicId))return;
 try{sessionStorageOrUndefined()?.setItem(returnCourseKey,JSON.stringify({publicId,createdAt:Date.now()}));}catch{}
}
export function pendingCandidateCourseUrl():string|undefined{
 try{const value=JSON.parse(sessionStorageOrUndefined()?.getItem(returnCourseKey)??'null');if(value&&typeof value.createdAt==='number'&&Date.now()-value.createdAt>=0&&Date.now()-value.createdAt<1800000&&typeof value.publicId==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.publicId))return '/catalog?course='+encodeURIComponent(value.publicId);}catch{}
 return undefined;
}
