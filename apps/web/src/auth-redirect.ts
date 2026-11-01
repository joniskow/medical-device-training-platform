import {broadcastResponseToMainFrame} from '@azure/msal-browser/redirect-bridge';
void broadcastResponseToMainFrame().catch(()=>{
 document.querySelector<HTMLElement>('#message')!.textContent='Sign-in could not return to the application. Close this page and try again.';
});
