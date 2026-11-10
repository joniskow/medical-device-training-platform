import { beginSignIn, completeSignIn } from './managed-auth.js';
const button = document.querySelector<HTMLButtonElement>('#continue')!;
const message = document.querySelector<HTMLElement>('#message')!;
button.onclick = () => { void beginSignIn().catch(() => { message.textContent = 'Sign-in could not start. Please retry.'; }); };
void completeSignIn().then(complete => { if (complete) location.replace('/demo?model=nxstage-review'); }).catch(() => { message.textContent = 'Sign-in could not complete. Please retry.'; });
