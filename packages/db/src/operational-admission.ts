import {createOperationsStore} from './operations-store.js';

/** Reserve worst-case cost, not optimistic average cost. Unknown provider outcomes retain
 * the reservation. The caller must honor abort before side effects and use job lease fencing. */
export async function withOperationalAdmission<T>(input: {
  store: ReturnType<typeof createOperationsStore>;
  key: string;
  estimateCents: number;
  leaseSeconds?: number;
  action: (signal: AbortSignal) => Promise<T>;
  onWarning?: () => void;
}): Promise<T> {
  const leaseSeconds=input.leaseSeconds??300;
  if(!Number.isSafeInteger(leaseSeconds)||leaseSeconds<3||leaseSeconds>3600)throw Error('ADMISSION_LEASE_INVALID');
  const reservation=await input.store.reserve(input.key,input.estimateCents,leaseSeconds);
  if(reservation.status!=='ACCEPTED' && reservation.status!=='ACCEPTED_WARNING')throw Error(`ADMISSION_${reservation.status}`);
  if(reservation.status==='ACCEPTED_WARNING')input.onWarning?.();
  const controller=new AbortController();
  let renewing=false;
  let lost=false;
  const timer=setInterval(()=>{
    if(renewing)return;
    renewing=true;
    void input.store.renew(input.key,reservation.token,leaseSeconds).then(ok=>{if(!ok){lost=true;controller.abort();}}).catch(()=>{lost=true;controller.abort();}).finally(()=>{renewing=false;});
  },Math.floor(leaseSeconds*1000/3));
  timer.unref();
  try {
    const result=await input.action(controller.signal);
    if(lost || !await input.store.settle(input.key,reservation.token,input.estimateCents))throw Error('ADMISSION_LEASE_LOST');
    return result;
  } catch(error) {
    // A failed call can still have consumed paid provider resources.
    await input.store.settle(input.key,reservation.token,input.estimateCents).catch(()=>false);
    throw error;
  } finally {
    clearInterval(timer);
  }
}
