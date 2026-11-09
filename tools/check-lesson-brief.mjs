import assert from 'node:assert/strict';
import {validateLessonBrief,lessonBriefEvidenceFindings,invalidateBriefArtifacts,validateVideoLesson} from '../packages/simulation-schema/dist/index.js';
import {createSourceGroundedDraftService, createDeterministicAiGateway} from '../packages/ai-gateway/dist/index.js';

const brief={schemaVersion:'lesson-brief.v1',audience:'New operators',priorKnowledge:'No device experience',task:'Identify the display',objective:'Identify Ready',deviceRevision:'Revision A',setting:'Training room',format:'orientation',referencePack:{sourceArtifactIds:['source:manual'],approvedViewIds:['media:front'],exactLabels:['Ready'],permittedStates:['Ready'],permittedActions:[],terminology:['display'],visualConventions:'Neutral light; operator view; readable labels; sans serif captions.'}};
assert.equal(validateLessonBrief(brief).valid,true);
assert.equal(validateLessonBrief({...brief,audience:''}).valid,false);
const media=[{assetVersionId:'media:front',sourceType:'image'}];
assert.deepEqual(lessonBriefEvidenceFindings(brief,['source:manual'],media),[]);
assert(lessonBriefEvidenceFindings({...brief,format:'procedure'},['source:manual'],media).some(f=>f.code==='LESSON_BRIEF_FORMAT_UNSUPPORTED'));
assert(lessonBriefEvidenceFindings(brief,['source:other'],media).some(f=>f.code==='LESSON_BRIEF_SOURCE_MISMATCH'));
assert(lessonBriefEvidenceFindings(brief,['source:manual'],[]).some(f=>f.code==='LESSON_BRIEF_VIEW_UNAPPROVED'));

const published={lessonBrief:brief,videoLessons:[{schemaVersion:'video-lesson.v1',lessonId:'lesson:one',render:{hash:'published'},roughCut:{accepted:true}}]};
const edited=structuredClone(published);edited.lessonBrief.objective='Identify the control';
const stale=invalidateBriefArtifacts(published,edited);
assert.equal(stale.videoLessons[0].generationStatus,'STALE');assert.equal(stale.videoLessons[0].render,undefined);assert.equal(stale.videoLessons[0].roughCut,undefined);
assert.equal(published.videoLessons[0].render.hash,'published');
assert(validateVideoLesson(stale.videoLessons[0]).findings.some(f=>f.code==='VIDEO_LESSON_BRIEF_STALE'));
assert.deepEqual(invalidateBriefArtifacts(published,published),published);
const reordered = JSON.parse(JSON.stringify(published, (_key, value) => value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).reverse()) : value));
assert.equal(invalidateBriefArtifacts(published,reordered).videoLessons[0].render.hash,'published','JSONB object-key ordering must not invalidate an unchanged brief.');

let saved={courseVersion:{revision:1,status:'DRAFT',content:{schemaVersion:'course-draft.v1',title:'Brief',lessonBrief:brief}}};let calls=0;
const service=createSourceGroundedDraftService({
 knowledge:{listForAssetVersions:async()=>[{assetVersionId:'source:manual',text:'Identify Ready on the display.',sourceHash:'a'.repeat(64),citation:{assetVersionId:'source:manual',page:1}}]},
 gateway:{execute:async request=>{calls++;assert.deepEqual(request.input.lessonBrief,brief);return createDeterministicAiGateway().execute(request);}},
 aiRuns:{record:async()=> 'ai:brief'},draftStore:{get:async()=>structuredClone(saved),getApprovedMediaForGeneration:async()=>media,saveGeneratedDraft:async input=>{assert.deepEqual(input.content.lessonBrief,brief);saved={courseVersion:{revision:2,status:'DRAFT',content:structuredClone(input.content)}};return true;}}
});
const tenant={organizationId:'org:test',actorId:'author:test',courseVersionId:'course:test',correlationId:'brief:test'};
const request={sourceArtifactIds:['source:manual'],mediaAssetVersionIds:['media:front'],videoLesson:true};
const result=await service.generate(tenant,request);assert.equal(result.appliedToCourse,true,JSON.stringify(result.result));assert.deepEqual(saved.courseVersion.content.lessonBrief,brief);
saved.courseVersion.content.lessonBrief.format='procedure';await assert.rejects(service.generate(tenant,request),/needs approved motion evidence/);assert.equal(calls,1);
saved.courseVersion.status='PUBLISHED';await assert.rejects(service.generate(tenant,request),/COURSE_VERSION_IMMUTABLE/);
console.log('Lesson brief checks passed: validation, evidence compatibility, saved server generation inputs, save/reload, stale publication gate and immutable snapshot preservation.');
