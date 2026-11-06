import {copyFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
const output=resolve('apps/web/dist');
await mkdir(output,{recursive:true});
for(const [source,destination] of [['docs/developer-integration.md','developer-integration.md'],['apps/web/src/developer-starter.ts','developer-starter.ts'],['output/developer-kit/nxstage-familiarization.review.json','nxstage-familiarization.review.json']])await copyFile(source,resolve(output,destination));
console.log('Prepared hosted developer downloads under apps/web/dist. No local server is distributed.');
