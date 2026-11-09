import assert from 'node:assert/strict';
import { createLessonVariant, validateLessonVariants, validateVideoLesson, validateLessonFinalReview, lessonFinalReviewRevision, finalReviewDimensions, lessonFinalPublicationBindingError, compareLessonVariantOutcomes } from '../packages/simulation-schema/dist/index.js';

const citation={assetVersionId:'source:manual',page:1};
const narration='Before pressing Start, confirm Ready. Warning: keep the cover closed. Press Start. Confirm Flowing.';
const source={schemaVersion:'video-lesson.v1',lessonId:'lesson:baseline',title:'Start flow',durationSeconds:60,learningObjectives:['Verify Flowing'],safetyBoundary:'Simulation only.',citations:[citation],briefSnapshot:{deviceRevision:'A'},scenes:[{sceneId:'scene:one',startSeconds:0,endSeconds:60,narration,onScreenText:['Start'],visual:{kind:'source_image',assetVersionId:'media:one',label:'Start'},citations:[citation]}],direction:{schemaVersion:'lesson-direction.v1',openingProblem:'How do you confirm flow has started?',outcome:'Confirm Flowing',beats:[{sceneId:'scene:one',sourceEvidence:[{citation,quote:narration}],startingCondition:'confirm Ready',subject:'Start',framing:'operator',attentionTarget:'Start',action:'Press Start.',result:'Confirm Flowing.',narration,callouts:[{text:'Start',target:'Start',startSeconds:5,endSeconds:10}],observationHoldSeconds:3,prerequisites:['Before pressing Start, confirm Ready.'],warnings:['Warning: keep the cover closed.'],exactLabels:['Start']}]}};
function approve(lesson,assetVersionId,hash){
  lesson.renderArtifact={mode:'final',sha256:hash.repeat(64),artifactId:'sha256:'+hash.repeat(64),placeholders:[]};
  lesson.finalReview={schemaVersion:'lesson-final-review.v1',assetVersionId,artifactSha256:hash.repeat(64),lessonRevision:lessonFinalReviewRevision(lesson),reviewerId:'reviewer:one',reviewedAt:new Date().toISOString(),disposition:'APPROVE',soundAndMotionReviewed:true,fullVideoReviewed:true,dimensions:Object.fromEntries(finalReviewDimensions.map(d=>[d,'PASS'])),intervals:lesson.scenes.map(s=>({sceneId:s.sceneId,startSeconds:s.startSeconds,endSeconds:s.endSeconds})),findings:[],devices:['laptop','tablet'].map(profile=>({profile,width:1280,height:720,minLabelPixels:18,minCaptionPixels:24,maxCaptionOcclusionPercent:0,maxSyncOffsetMs:200,clippedSpeechCount:0,integratedLufs:-16,truePeakDb:-1}))};
}
Object.assign(source,{brief:{deviceRevision:'A'},briefRevision:'brief:one',briefBinding:'brief:binding',referencePack:{approvedViewIds:['media:one'],exactLabels:['Start']},sourceRevision:'manual:one',identity:{deviceRevision:'A',accessory:'approved'}});
approve(source,'asset:source','a');
const correctedSource=structuredClone(source);correctedSource.sceneTakes={selected:{'scene:one':'take:approved-correction'}};
approve(correctedSource,'asset:corrected','e');
assert.throws(()=>createLessonVariant(correctedSource,'beginner','lesson:corrected-variant'),/selected.*take|corrected.*visual/i,'A variant must not silently discard the approved corrected scene take.');
const beginner=createLessonVariant(source,'beginner','lesson:beginner');
const refresher=createLessonVariant(source,'refresher','lesson:refresher');
const remediation=createLessonVariant(source,'remediation','lesson:remediation',['scene:one']);
const variants=[beginner,refresher,remediation],lessons=[source,...variants];
assert(beginner.durationSeconds>source.durationSeconds);
assert(refresher.durationSeconds<source.durationSeconds);
assert(remediation.durationSeconds>source.durationSeconds);
for(const variant of variants){
  assert.equal(variant.finalReview,undefined);assert.equal(variant.renderArtifact,undefined);
  assert.equal(variant.scenes[0].narration,narration);assert.deepEqual(variant.learningObjectives,source.learningObjectives);
  assert.equal(validateLessonFinalReview(variant).valid,false,'Source review cannot approve a variant');
  assert.equal(validateVideoLesson(variant).valid,true,JSON.stringify(validateVideoLesson(variant)));
}
assert.equal(validateLessonVariants(lessons).valid,true,JSON.stringify(validateLessonVariants(lessons)));
const invalid=(edit,code)=>{const copy=structuredClone(lessons);edit(copy);const r=validateLessonVariants(copy);assert(r.findings.some(f=>f.code===code),JSON.stringify(r));};
invalid(l=>l[1].scenes[0].narration=l[1].scenes[0].narration.replace('Warning: keep the cover closed. ',''),'LESSON_VARIANT_CLAIMS_CHANGED');
invalid(l=>l[1].scenes[0].onScreenText=['Go'],'LESSON_VARIANT_CLAIMS_CHANGED');
invalid(l=>l[0].briefSnapshot.deviceRevision='B','LESSON_VARIANT_SOURCE_STALE');
for(const key of ['briefSnapshot','brief','briefRevision','briefBinding','referencePack','sourceRevision','identity']){
  invalid(l=>{l[1][key]={deviceRevision:'B'};},'LESSON_VARIANT_IDENTITY_CHANGED');
  invalid(l=>{delete l[1][key];},'LESSON_VARIANT_IDENTITY_CHANGED');
  invalid(l=>{l[0][key]={deviceRevision:'B'};},'LESSON_VARIANT_SOURCE_STALE');
}
invalid(l=>{l[1].briefSnapshot.deviceRevision='B';},'LESSON_VARIANT_IDENTITY_CHANGED');
invalid(l=>{l[1].referencePack.approvedViewIds=['media:other'];},'LESSON_VARIANT_IDENTITY_CHANGED');
invalid(l=>l[1].briefSnapshot.deviceRevision='B','LESSON_VARIANT_IDENTITY_CHANGED');
invalid(l=>l[1].referencePack={sourceArtifactIds:['source:other']},'LESSON_VARIANT_IDENTITY_CHANGED');
invalid(l=>l[1].learningObjectives=['Other objective'],'LESSON_VARIANT_REQUIRED_ELEMENTS_CHANGED');
invalid(l=>l[1].variantIdentity.targetSceneIds=['missing'],'LESSON_VARIANT_TARGET_INVALID');
invalid(l=>l[1].lessonId=l[0].lessonId,'LESSON_ID_DUPLICATE');
invalid(l=>l[1].direction.beats[0].action='Invented action','LESSON_VARIANT_DIRECTION_CHANGED');
invalid(l=>l[1].finalReview=structuredClone(l[0].finalReview),'LESSON_VARIANT_ARTIFACT_REUSED');
for(const malformed of [null,{},[],{scenes:null},{scenes:[null]},{direction:{beats:7}},{variantIdentity:null}])assert.doesNotThrow(()=>validateLessonVariants([malformed,...variants]));
approve(beginner,'asset:beginner','b');approve(refresher,'asset:refresher','c');approve(remediation,'asset:remediation','d');
for(const variant of variants){
  assert.equal(validateLessonFinalReview(variant).valid,true);
  const binding={media:{assetVersionId:variant.finalReview.assetVersionId,sha256:variant.renderArtifact.sha256,sourceType:'video',state:'APPROVED'},approval:{decision:'APPROVE',actorId:'reviewer:one',revision:9},authorId:'author:one',revision:9};
  assert.equal(lessonFinalPublicationBindingError(variant,binding),null);
  assert(lessonFinalPublicationBindingError(variant,{...binding,media:{...binding.media,sha256:'a'.repeat(64)}}));
  assert(lessonFinalPublicationBindingError(variant,{...binding,approval:{...binding.approval,actorId:'author:one'}}));
}
const video={activityId:'activity:remediation',type:'video',videoLessonId:remediation.lessonId,media:{assetVersionId:remediation.finalReview.assetVersionId,transcript:narration}};
const activity={activityId:'activity:quiz',type:'multiple_choice',remediation:{lessonId:remediation.lessonId,sceneId:'scene:one',objective:'Verify Flowing'}};
assert.equal(validateLessonVariants(lessons,[video,activity]).valid,true);
assert.equal(validateLessonVariants(lessons,[{...video,media:{...video.media,assetVersionId:'asset:source'}},activity]).valid,false);
assert.equal(validateLessonVariants(lessons,[video,{...activity,remediation:{...activity.remediation,objective:'Unsupported objective'}}]).valid,false);
assert.equal(validateLessonVariants(lessons,[activity]).valid,false);
const comparison=compareLessonVariantOutcomes(lessons,[{lessonId:refresher.lessonId,objective:'Verify Flowing',correct:false,criticalError:true},{lessonId:beginner.lessonId,objective:'Verify Flowing',correct:true,criticalError:false}]);
assert.equal(comparison.find(r=>r.lessonId===refresher.lessonId).criticalErrors,1);assert.equal(comparison.find(r=>r.lessonId===beginner.lessonId).correct,1);
assert.throws(()=>createLessonVariant(source,'remediation','lesson:bad',['missing']));
const unreviewed=structuredClone(source);delete unreviewed.finalReview;assert.throws(()=>createLessonVariant(unreviewed,'beginner','lesson:bad'));
console.log('Learning variants passed: required claims and revision equivalence, distinct paced complete timelines, independent artifact reviews/publication bindings, remediation targets and same-objective outcomes. Browser and actual media inspection remain separate checks.');
