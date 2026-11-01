import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {createAzureOpenAiGateway,createDeterministicAiGateway} from '../packages/ai-gateway/dist/index.js';
import {evaluationCases,evaluateAi} from './ai-evaluation.mjs';
const args=process.argv.slice(2);
if(args.length!==3||!['--local','--azure'].includes(args[0])||args[1]!=='--output')throw Error('Usage: node tools/evaluate-ai.mjs --local|--azure --output <new report.json>');
const mode=args[0]==='--local'?'local':'azure';
const extraction=JSON.parse(await readFile('output/fixture-import/aic-001-document-extraction.json','utf8'));
if(extraction.fixtureId!=='AIC-001'||extraction.status!=='READY'||!extraction.chunks?.length)throw Error('REFERENCE_EXTRACTION_REQUIRED');
let gateway,configuration,tokenBudget=2000;
if(mode==='local'){gateway=createDeterministicAiGateway();configuration={provider:'deterministic-local',promptVersion:'course-draft.v1'};}
else{
 const config=JSON.parse(await readFile('config/pilot-readiness.json','utf8'));
 for(const key of ['deployment','region','model','apiVersion'])if(typeof config.ai[key]!=='string'||!config.ai[key].trim())throw Error('AI_CONFIGURATION_PENDING:'+key);
 const endpoint=process.env.AZURE_OPENAI_ENDPOINT,apiKey=process.env.AZURE_OPENAI_API_KEY;
 if(!endpoint||!apiKey)throw Error('AZURE_AI_CREDENTIALS_REQUIRED');
 const url=new URL(endpoint);if(url.protocol!=='https:'||!url.hostname.endsWith('.openai.azure.com')||url.username||url.password||url.search||url.hash)throw Error('AZURE_AI_ENDPOINT_INVALID');
 tokenBudget=config.economics.maxAiTokensPerRun;
 if(!Number.isSafeInteger(tokenBudget)||tokenBudget<1||tokenBudget>12000)throw Error('AI_TOKEN_BUDGET_PENDING');
 configuration={provider:'azure-openai',deployment:config.ai.deployment,region:config.ai.region,model:config.ai.model,apiVersion:config.ai.apiVersion,promptVersion:'course-draft.v1',endpointHost:url.hostname,tokenBudget};
 gateway=createAzureOpenAiGateway({endpoint,apiKey,deployment:config.ai.deployment,model:config.ai.model,apiVersion:config.ai.apiVersion,fetchImpl:(url,init)=>fetch(url,{...init,signal:AbortSignal.timeout(60000)})});
}
const report=await evaluateAi({gateway,cases:evaluationCases(extraction),mode,configuration,tokenBudget});
const output=resolve(args[2]);await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(`Wrote ${report.results.length} ${mode} evaluation cases. Promotion status: NOT_APPROVED. Report: ${output}`);
