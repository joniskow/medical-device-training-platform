import {beginSignIn,completeSignIn,providerSignOut} from './managed-auth.js';
const message=document.querySelector<HTMLElement>('#message')!;
const button=document.querySelector<HTMLButtonElement>('#continue')!;
const signingOut=location.pathname==='/signout';
button.textContent=signingOut?'Finish provider sign-out':'Sign in or create an account';
async function run(action:()=>Promise<unknown>){button.disabled=true;try{await action();}catch{message.textContent=signingOut?'You are signed out locally. Provider sign-out could not finish. Retry to end the provider session.':'Sign-in could not be completed. Check that sign-in is configured, then try again or contact support.';}finally{button.disabled=false;}}
button.onclick=()=>void run(signingOut?providerSignOut:beginSignIn);
if(signingOut){message.textContent='You are signed out locally. Finishing provider sign-out…';void run(async()=>{await providerSignOut();message.textContent='You are signed out locally.';});}
else void run(async()=>{if(await completeSignIn())location.replace('/account');});
