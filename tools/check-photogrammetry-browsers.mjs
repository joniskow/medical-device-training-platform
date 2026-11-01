import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
for(const mode of ['multi-view','video'])await new Promise((done,reject)=>{
 const child=spawn(process.execPath,['tools/check-reconstruction-browser.mjs'],{windowsHide:true,stdio:'inherit',env:{...process.env,RECONSTRUCTION_BROWSER_MODE:mode,RECONSTRUCTION_BROWSER_RUN:resolve('output/photogrammetry-refined',mode)}});
 child.once('error',reject);child.once('close',code=>code===0?done():reject(Error('PHOTOGRAMMETRY_BROWSER_FAILED:'+mode)));
});
