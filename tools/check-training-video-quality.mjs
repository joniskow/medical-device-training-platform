// This check validates recorded review evidence. It does not inspect or approve clinical mechanics.
import { readFile } from 'node:fs/promises';
import { validateLessonFinalReview } from '../packages/simulation-schema/dist/index.js';
const path=process.argv[2];
if(!path){console.error('Usage: node tools/check-training-video-quality.mjs <saved-course-or-lesson.json>');process.exitCode=2;}
else{
 const input=JSON.parse(await readFile(path,'utf8'));
 const lessons=Array.isArray(input.videoLessons)?input.videoLessons:[input];
 const results=lessons.map(lesson=>({lessonId:lesson.lessonId,...validateLessonFinalReview(lesson)}));
 console.log(JSON.stringify({automatedApproval:false,results},null,2));
 if(!results.length||results.some(result=>!result.valid))process.exitCode=1;
}
