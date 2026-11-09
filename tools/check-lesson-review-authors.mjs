import assert from 'node:assert/strict';
import { lessonInstructionAuthors } from '../packages/db/dist/lesson-review-authors.js';

const lesson={lessonId:'lesson:one',scenes:[{sceneId:'scene:one',narration:'Keep the cover closed.'}]};
const content=value=>({videoLessons:[value]});
const changed=structuredClone(lesson);changed.scenes[0].narration='Open the cover.';
const scorecard=structuredClone(changed);scorecard.finalReview={reviewerId:'reviewer:one'};scorecard.renderArtifact={sha256:'a'.repeat(64)};
const history=[
  {created_by:'author:original',actor_id:'author:second',details:{before:content(lesson),after:content(changed)}},
  {created_by:'author:original',actor_id:'reviewer:one',details:{before:content(changed),after:content(scorecard)}}
];
assert.deepEqual(new Set(lessonInstructionAuthors(scorecard,history)),new Set(['author:original','author:second']));
const variant={lessonId:'lesson:variant',variantIdentity:{sourceLessonId:'lesson:one'}};
assert(lessonInstructionAuthors(variant,history).includes('author:second'),'A variant retains source instructional authors.');
const restored={created_by:'author:ancestor',actor_id:'author:restore',details:{before:content(changed),after:content(lesson)}};
assert(lessonInstructionAuthors(lesson,[restored]).includes('author:restore'));
assert.doesNotThrow(()=>lessonInstructionAuthors(lesson,[{created_by:'creator',actor_id:'reviewer',details:{before:null,after:[]}}]));
console.log('Lesson reviewer separation passed: instruction editors and source authors excluded; scorecard-only reviewer saves remain independent.');
