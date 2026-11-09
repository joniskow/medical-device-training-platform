// Run inside the private Azure smoke job. Only safe result metadata is printed.
import {randomUUID,createHash} from 'node:crypto';
import {createAzureOpenAiGateway} from '@medical-device/ai-gateway';
import {createAzureEmbeddingProvider} from '@medical-device/ai-gateway';
import {createSpeechProvider} from '/app/dist/speech-provider.js';
import {finishLessonAudio} from '/app/dist/lesson-audio.js';
import {createOpenMontageProvider} from '/app/dist/openmontage-provider.js';
import {Pool} from 'pg';
const results=[];
const record=value=>{results.push(value);console.log(JSON.stringify(value));};
try{
 const databaseUrl=`postgresql://${encodeURIComponent('medical_device_runtime')}:${encodeURIComponent(process.env.POSTGRES_RUNTIME_PASSWORD)}@mdt-personal-pg.postgres.database.azure.com:5432/medical_device?sslmode=require`;
 const pool=new Pool({connectionString:databaseUrl,max:1,connectionTimeoutMillis:10000});
 try{const vector=(await pool.query("SELECT extversion FROM pg_extension WHERE extname='vector'")).rows[0];if(!vector)throw Error('VECTOR_NOT_INSTALLED');record({check:'database-vector',status:'PASS',version:vector.extversion});}finally{await pool.end();}
 const tenant={organizationId:'smoke:azure',actorId:'operator:smoke',correlationId:randomUUID()};
 const embeddings=await createAzureEmbeddingProvider(process.env).embed(tenant,['A fictional training operator checks the Ready label.']);
 if(embeddings[0]?.length!==1536)throw Error('EMBEDDING_DIMENSIONS_INVALID');record({check:'live-embeddings',status:'PASS',dimensions:embeddings[0].length});
 const gateway=createAzureOpenAiGateway({endpoint:process.env.AZURE_EMBEDDING_ENDPOINT,apiKey:process.env.AZURE_EMBEDDING_API_KEY,deployment:'training-draft',model:'gpt-4.1-mini',apiVersion:'2024-10-21'});
 const generated=await gateway.execute({operation:'generate_course_draft',tenant,sourceArtifactIds:['source:smoke'],outputSchemaVersion:'course-draft.v1',tokenBudget:2000,input:{sourceChunks:[{assetVersionId:'source:smoke',text:'This is a fictional training fixture. Confirm Ready before selecting Start. If Blocked is displayed, do not select Start.',citation:{assetVersionId:'source:smoke',page:1}}],userInstruction:'Create one concise module with a reading activity and one multiple-choice question. Use only this fictional source.'}});
 if(generated.status!=='DRAFT')throw Error('LIVE_TEXT_GENERATION_FAILED:'+String(generated.failure?.code));record({check:'live-course-generation',status:'PASS',modules:generated.output.modules?.length,metrics:generated.metrics});
 const speech=await createSpeechProvider().synthesize({requestId:randomUUID(),text:'Confirm the Ready label before selecting Start.',voice:'en-US-JennyNeural',locale:'en-US'});
 const audio=await finishLessonAudio({speech:speech.audio.bytes,ffmpeg:'/usr/bin/ffmpeg',ffprobe:'/usr/bin/ffprobe'});
 if(audio.durationSeconds<1)throw Error('ACTUAL_SPEECH_MISSING');record({check:'live-spoken-audio',status:'PASS',bytes:speech.audio.bytes.length,durationSeconds:audio.durationSeconds});
 const background=await createOpenMontageProvider().generate({generationId:'smoke:'+randomUUID(),prompt:'An empty neutral teaching room with soft daylight, clear floor space and a plain rear wall. No people, no equipment and no signs.',mode:'LOCKED_INTERACTIVE',width:640,height:360,frameRate:24,durationSeconds:3,modelVersionId:'smoke:model',modelSourceHash:'a'.repeat(64)});
 if(background.video.bytes.length<1000)throw Error('ACTUAL_VIDEO_MISSING');record({check:'live-generated-background-video',status:'PASS',provider:background.provider.name,model:background.provider.model,bytes:background.video.bytes.length,sha256:createHash('sha256').update(background.video.bytes).digest('hex')});
 record({check:'all-learning-services',status:'PASS'});
}catch(error){record({check:'learning-services',status:'FAIL',code:/^[A-Z0-9_:]+$/.test(error.message)?error.message:'SERVICE_SMOKE_FAILED'});process.exitCode=1;}
