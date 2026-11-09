// Engineering fixture only. Run inside the private speech smoke job; publish nothing.
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {lessonDirectionRevision} from '@medical-device/simulation-schema';
import {isCurrentLessonRenderManifest} from '@medical-device/contracts';
import {createSpeechProvider} from '/app/dist/speech-provider.js';
import {renderLessonJob} from '/app/dist/lesson-render-job.js';
const run=promisify(execFile),directory=await mkdtemp(join(tmpdir(),'speech-render-smoke-'));
try {
 const image=join(directory,'engineering.png');
 await run('/usr/bin/ffmpeg',['-nostdin','-y','-v','error','-f','lavfi','-i','color=c=blue:s=640x360','-frames:v','1',image]);
 const citation={assetVersionId:'engineering:source',page:1},narration='Inspect the AIC. Confirm Ready before selecting Start.';
 const lesson={schemaVersion:'video-lesson.v1',lessonId:'engineering:speech',title:'Speech integration check',durationSeconds:30,learningObjectives:['Confirm Ready'],safetyBoundary:'Fictional engineering fixture; never publish.',citations:[citation],scenes:[{sceneId:'one',startSeconds:0,endSeconds:30,narration,narrationDelivery:{rate:0.9,emphasis:'moderate',pauses:[{afterText:'AIC.',milliseconds:500}],pronunciations:[{term:'AIC',alias:'A I C'}]},onScreenText:['Ready'],visual:{kind:'source_image',assetVersionId:'engineering:image',label:'Engineering fixture'},citations:[citation]}],direction:{schemaVersion:'lesson-direction.v1',openingProblem:'Is the device ready?',outcome:'Confirm Ready.',beats:[{sceneId:'one',sourceEvidence:[{citation,quote:narration}],startingCondition:'Inspect the AIC.',subject:'AIC',framing:'operator',attentionTarget:'Ready',action:'Confirm Ready before selecting Start.',result:'Ready',narration,callouts:[],observationHoldSeconds:3,prerequisites:[],warnings:[],exactLabels:['Ready','Start']}]}};
 lesson.directionReview={revision:lessonDirectionRevision(lesson.direction)};
 const manifest=await renderLessonJob({lesson,mode:'rough-cut',outputDirectory:join(directory,'output'),assets:{'engineering:image':{path:image,approved:true}},speech:createSpeechProvider(),ffmpeg:'/usr/bin/ffmpeg',ffprobe:'/usr/bin/ffprobe'});
 const probe=JSON.parse((await run('/usr/bin/ffprobe',['-v','error','-show_streams','-of','json',manifest.outputPath])).stdout);
 const captions=await readFile(manifest.captionsPath,'utf8');
 if(!isCurrentLessonRenderManifest(manifest,lesson)||manifest.placeholders.length||!probe.streams.some(s=>s.codec_type==='audio')||!probe.streams.some(s=>s.codec_type==='video')||!captions.includes('Inspect the AIC.')||manifest.scenes[0].narrationSeconds<1)throw Error('LIVE_NARRATED_RENDER_INVALID');
 console.log(JSON.stringify({check:'live-narrated-render',status:'PASS',durationSeconds:manifest.durationSeconds,narrationSeconds:manifest.scenes[0].narrationSeconds,actualAzureSpeech:true,videoAndAudio:true,captions:true,sha256:manifest.sha256,listeningReview:'REQUIRED'}));
}catch(error){console.error(JSON.stringify({check:'live-narrated-render',status:'FAIL',code:/^[A-Z0-9_:]+$/.test(error.message)?error.message:'LIVE_RENDER_FAILED'}));process.exitCode=1;}finally{await rm(directory,{recursive:true,force:true});}
