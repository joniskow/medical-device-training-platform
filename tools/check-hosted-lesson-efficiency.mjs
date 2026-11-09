import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {processHostedLessonRenderJob} from '../apps/worker/dist/hosted-lesson-render.js';
import {lessonRenderRevision} from '../packages/contracts/dist/index.js';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const objects = new Map(), jobs = new Map(), outcomes = [];
let speechCalls = 0, rightsChecks = 0, denyRights = false;
const storage = {
  async readObject({blobKey, maxBytes}) { const object = objects.get(blobKey); if (!object || object.bytes.length > maxBytes) throw Error('missing'); return {...object, sha256: sha(object.bytes)}; },
  async putObject({blobKey, ...object}) {objects.set(blobKey, object);}
};
const jobStore = {
  async get(_tenant, id) {return jobs.get(id);},
  async claim(_tenant, id, workerId) {const job = jobs.get(id); Object.assign(job, {state: 'RUNNING', leaseOwner: workerId, leaseGeneration: 1}); return job;},
  async fail(_tenant, id, _workerId, _lease, lastFailure) {const job = jobs.get(id); Object.assign(job, {state: 'FAILED', lastFailure}); return job;}
};
const store = {
  async assertCurrent() {rightsChecks++; if (denyRights) throw Error('LESSON_RENDER_RIGHTS_WITHDRAWN');},
  async complete(_tenant, id, _workerId, _lease, _manifest, outcome) {outcomes.push(outcome); jobs.get(id).state = 'SUCCEEDED'; return true;}
};
const speech = {async synthesize(request) {speechCalls++; return {provider: {name: 'azure-speech', voice: request.voice}, audio: {bytes: new Uint8Array(128).fill(5), contentType: 'audio/mpeg', durationSeconds: 2}};}};
// Test only hosted transport/cache behavior; no media-quality acceptance is implied by these bytes.
const render = async input => {
  for (const scene of input.lesson.scenes) await input.speech.synthesize({requestId: scene.sceneId, text: scene.narration, voice: 'en-US-JennyNeural', locale: 'en-US', delivery: scene.narrationDelivery});
  const video = Buffer.from('video fixture'), captions = Buffer.from('WEBVTT\n');
  const outputPath = join(input.outputDirectory, 'video.mp4'), captionsPath = join(input.outputDirectory, 'captions.vtt');
  await writeFile(outputPath, video); await writeFile(captionsPath, captions);
  return {schemaVersion: 'lesson-render.v1', mode: input.mode, artifactId: `sha256:${sha(video)}`, sha256: sha(video), captionsSha256: sha(captions), inputRevision: lessonRenderRevision(input.lesson), durationSeconds: 30, placeholders: [], scenes: input.lesson.scenes.map(s => ({sceneId: s.sceneId, startSeconds: s.startSeconds, endSeconds: s.endSeconds, narrationSeconds: 2})), outputPath, captionsPath};
};
const tenant = {organizationId: 'org:efficiency', actorId: 'author', correlationId: 'test'};
const lesson = {lessonId: 'lesson:1', durationSeconds: 30, scenes: [{sceneId: 'one', startSeconds: 0, endSeconds: 15, narration: 'Check the clamp.'}, {sceneId: 'two', startSeconds: 15, endSeconds: 30, narration: 'Verify Ready.'}]};
const run = async (id, savedLesson = lesson) => {
  jobs.set(id, {jobId: id, jobType: 'lesson.render', tenant, payload: {courseVersionId: 'course:1', lessonId: lesson.lessonId, revision: 1, mode: 'rough-cut', lesson: structuredClone(savedLesson), assets: []}});
  return processHostedLessonRenderJob({jobStore, store, storage, speech, tenant, jobId: id, workerId: 'worker', render});
};
assert.equal((await run('first')).state, 'SUCCEEDED');
assert.equal((await run('repeat')).state, 'SUCCEEDED');
assert.equal(speechCalls, 2);
assert.equal(outcomes[1].metrics.narrationCacheHits, 2);
assert.equal(outcomes[1].metrics.narrationSyntheses, 0);
assert.ok(outcomes[1].details.narrationEvidence.every(e => e.reused && e.scriptSha256 && e.audioSha256));
const edited = structuredClone(lesson); edited.scenes[1].narration = 'Verify Stopped.';
assert.equal((await run('edited', edited)).state, 'SUCCEEDED');
assert.equal(speechCalls, 3, 'only the changed scene requests new speech');
assert.equal(outcomes[2].metrics.narrationCacheHits, 1);
assert.equal(outcomes[2].metrics.narrationSyntheses, 1);
assert.equal(rightsChecks, 6, 'each successful render validates current rights before and after rendering');
denyRights = true;
assert.equal((await run('withdrawn')).lastFailure.code, 'LESSON_RENDER_RIGHTS_WITHDRAWN');
assert.equal(speechCalls, 3, 'cached speech cannot bypass withdrawn source rights');
console.log('hosted lesson efficiency checks passed');
