// Private Azure smoke execution: emit measurements only, never provider credentials.
import {randomUUID} from 'node:crypto';
import {createSpeechProvider} from '/app/dist/speech-provider.js';
import {synthesizeLessonAudio} from '/app/dist/lesson-audio.js';
try {
 const speech=createSpeechProvider(), text='Inspect the NxStage System One. Confirm Ready before selecting Start.';
 const render=delivery=>synthesizeLessonAudio({speech,requestId:randomUUID(),text,delivery,ffmpeg:'/usr/bin/ffmpeg',ffprobe:'/usr/bin/ffprobe'});
 const plain=await render({rate:1,emphasis:'none'});
 const controlled=await render({rate:0.85,emphasis:'moderate',pauses:[{afterText:'System One.',milliseconds:900}],pronunciations:[{term:'NxStage',alias:'Next Stage'}]});
 if(plain.provider.voice!=='en-US-JennyNeural'||controlled.provider.voice!=='en-US-JaneNeural')throw Error('SPEECH_VOICE_MISMATCH');
 if(controlled.durationSeconds<=plain.durationSeconds+0.3)throw Error('SPEECH_PACING_OR_PAUSE_MISSING');
 for(const result of [plain,controlled])if(result.bytes.length<1000||!Number.isFinite(result.measurements.outputIntegratedLufs)||result.measurements.outputTruePeakDb>-1)throw Error('SPEECH_FINISHING_FAILED');
 console.log(JSON.stringify({check:'live-speech-delivery',status:'PASS',plain:{voice:plain.provider.voice,duration:plain.durationSeconds,measurements:plain.measurements},controlled:{voice:controlled.provider.voice,duration:controlled.durationSeconds,measurements:controlled.measurements},controls:['pace','emphasis','anchored-pause','pronunciation-alias'],listeningReview:'REQUIRED'}));
}catch(error){console.error(JSON.stringify({check:'live-speech-delivery',status:'FAIL',code:/^[A-Z0-9_:]+$/.test(error.message)?error.message:'SPEECH_CHECK_FAILED'}));process.exitCode=1;}
