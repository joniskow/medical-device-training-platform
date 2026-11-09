import assert from 'node:assert/strict';
import {Pool} from 'pg';
import {applyProcessingJobMigration,createPostgresCourseReviewStore} from '../packages/db/dist/index.js';
import {lessonFinalReviewRevision,finalReviewDimensions} from '../packages/simulation-schema/dist/index.js';
import {lessonRenderRevision} from '../packages/contracts/dist/index.js';
import {createSourceDirection} from '../packages/ai-gateway/dist/lesson-planner.js';

const pool=new Pool({connectionString:process.env.DATABASE_URL??'postgresql://local_app:local_only_change_me@127.0.0.1:54329/medical_device'});
const id='lesson_publish_'+Date.now(),organizationId=id+'_org',authorId=id+'_author',reviewerId=id+'_reviewer';
const tenant={organizationId,actorId:id+'_publisher',correlationId:id},courseId=id+'_course',courseVersionId=id+'_version',aiRunId=id+'_ai';
const sourceId=id+'_manual',imageId=id+'_image',finalId=id+'_final';
const citation={assetVersionId:sourceId,page:1},narration='Before pressing Start, confirm Ready. Warning: keep the cover closed. Press Start. Confirm Flowing.';
const lesson={schemaVersion:'video-lesson.v1',lessonId:'lesson:postgres',title:'Start flow',durationSeconds:30,learningObjectives:['Verify Flowing'],safetyBoundary:'Engineering fixture only.',citations:[citation],scenes:[{sceneId:'one',startSeconds:0,endSeconds:30,narration,onScreenText:['Start'],visual:{kind:'source_image',assetVersionId:imageId,label:'Start'},citations:[citation]}]};
lesson.direction=createSourceDirection(lesson,[{assetVersionId:sourceId,citation,text:narration}]);
lesson.renderArtifact={schemaVersion:'lesson-render.v1',mode:'final',sha256:'f'.repeat(64),artifactId:'sha256:'+'f'.repeat(64),inputRevision:lessonRenderRevision(lesson),durationSeconds:30,placeholders:[],scenes:[{sceneId:'one',startSeconds:0,endSeconds:30,narrationSeconds:3}],outputPath:'fixture.mp4',captionsPath:'fixture.vtt',captionsSha256:'c'.repeat(64)};
lesson.finalReview={schemaVersion:'lesson-final-review.v1',assetVersionId:finalId,artifactSha256:'f'.repeat(64),lessonRevision:lessonFinalReviewRevision(lesson),reviewerId,reviewedAt:new Date().toISOString(),disposition:'APPROVE',soundAndMotionReviewed:true,fullVideoReviewed:true,dimensions:Object.fromEntries(finalReviewDimensions.map(d=>[d,'PASS'])),intervals:[{sceneId:'one',startSeconds:0,endSeconds:30}],findings:[],devices:['laptop','tablet'].map(profile=>({profile,width:1280,height:720,minLabelPixels:18,minCaptionPixels:24,maxCaptionOcclusionPercent:0,maxSyncOffsetMs:200,clippedSpeechCount:0,integratedLufs:-16,truePeakDb:-1}))};
const content={schemaVersion:'course-draft.v1',title:'Reviewed video',sourceArtifactIds:[sourceId],citations:[citation],videoLessons:[lesson],modules:[{moduleId:'module:video',title:'Video',activities:[{activityId:'activity:video',type:'video',title:'Reviewed final',videoLessonId:lesson.lessonId,media:{assetVersionId:finalId,transcript:narration}}]}]};
const artifacts={releaseManifestBlobKey:({organizationId,releaseId})=>organizationId+'/'+releaseId+'/manifest.json',materializeReleaseManifest:async()=>{}};
try{
  await applyProcessingJobMigration(pool);
  await pool.query(`INSERT INTO courses(course_id,organization_id,name,status,created_by,created_at,updated_at) VALUES($1,$2,'Video','DRAFT',$3,now(),now())`,[courseId,organizationId,authorId]);
  await pool.query(`INSERT INTO course_versions(course_version_id,course_id,organization_id,revision,content,status,created_by,created_at,updated_at) VALUES($1,$2,$3,2,$4::jsonb,'DRAFT',$5,now(),now())`,[courseVersionId,courseId,organizationId,JSON.stringify(content),authorId]);
  for(const [assetVersionId,type,mime,hash] of [[sourceId,'pdf','application/pdf','a'],[imageId,'image','image/png','b'],[finalId,'video','video/mp4','f']]){
    await pool.query(`INSERT INTO assets(asset_id,organization_id,source_type,status,created_by,updated_by,created_at,updated_at) VALUES($1,$2,$3,'APPROVED',$4,$4,now(),now())`,[assetVersionId+'_asset',organizationId,type,authorId]);
    await pool.query(`INSERT INTO asset_versions(asset_version_id,asset_id,organization_id,source_type,blob_key,file_name,content_type,size_bytes,sha256,state,created_by,created_at,updated_at) VALUES($1,$2,$3,$4,$5,'fixture',$6,1,$7,'APPROVED',$8,now(),now())`,[assetVersionId,assetVersionId+'_asset',organizationId,type,organizationId+'/'+assetVersionId,mime,hash.repeat(64),authorId]);
  }
  await pool.query(`INSERT INTO ai_runs(ai_run_id,organization_id,course_version_id,operation,source_artifact_ids,provider,deployment,model,api_version,prompt_version,output_schema_version,status,output,citations,warnings,metrics,created_at,updated_at) VALUES($1,$2,$3,'generate_video_lesson',$4,'fixture','fixture','fixture','local','v1','course-draft.v1','DRAFT',$5::jsonb,'[]','[]','{}',now(),now())`,[aiRunId,organizationId,courseVersionId,[sourceId],JSON.stringify(content)]);
  const store=createPostgresCourseReviewStore(pool,{releaseArtifacts:artifacts});
  for(const [targetType,targetId] of [['AI_DRAFT',aiRunId],['COURSE',courseVersionId],['VIDEO_LESSON',lesson.lessonId]])await store.recordDecision({tenant:{...tenant,actorId:reviewerId},courseVersionId,targetType,targetId,decision:'APPROVE',rationale:'Engineering fixture for exact-hash independent-review gate.',revision:2,idempotencyKey:id+targetType,requestHash:id+targetType});
  const publish=()=>store.publish({tenant,courseVersionId,idempotencyKey:id+'_publish',requestHash:id+'_publish'});
  await pool.query(`UPDATE course_versions SET content=jsonb_set(content,'{videoLessons,0,renderArtifact,scenes,0,sceneId}','"unknown"'::jsonb) WHERE course_version_id=$1`,[courseVersionId]);
  await assert.rejects(publish(),/LESSON_FINAL_RENDER_STALE/,'A final manifest must contain the complete current scene timeline');
  await pool.query(`UPDATE course_versions SET content=$1::jsonb WHERE course_version_id=$2`,[JSON.stringify(content),courseVersionId]);
  await pool.query(`UPDATE asset_versions SET sha256=$1 WHERE asset_version_id=$2`,['e'.repeat(64),finalId]);
  await assert.rejects(publish(),/LESSON_FINAL_ASSET_HASH_MISMATCH/);
  await pool.query(`UPDATE asset_versions SET sha256=$1 WHERE asset_version_id=$2`,['f'.repeat(64),finalId]);
  await pool.query(`UPDATE course_review_decisions SET actor_id=$1 WHERE organization_id=$2 AND target_type='VIDEO_LESSON'`,[authorId,organizationId]);
  await assert.rejects(publish(),/LESSON_FINAL_INDEPENDENT_REVIEW_REQUIRED/);
  await pool.query(`UPDATE course_review_decisions SET actor_id=$1,revision=1 WHERE organization_id=$2 AND target_type='VIDEO_LESSON'`,[reviewerId,organizationId]);
  await assert.rejects(publish(),/LESSON_FINAL_INDEPENDENT_REVIEW_REQUIRED/);
  await pool.query(`UPDATE course_review_decisions SET revision=2 WHERE organization_id=$1 AND target_type='VIDEO_LESSON'`,[organizationId]);
  const editorId=id+'_second_editor';
  const edited=structuredClone((await store.get(tenant,courseVersionId)).courseVersion.content);
  const editedLesson=edited.videoLessons[0];editedLesson.title='Revised start flow';
  editedLesson.renderArtifact.inputRevision=lessonRenderRevision(editedLesson);
  editedLesson.finalReview.reviewerId=editorId;editedLesson.finalReview.lessonRevision=lessonFinalReviewRevision(editedLesson);
  await store.saveDraft({tenant:{...tenant,actorId:editorId},courseVersionId,revision:2,content:edited});
  const approveRevision=async(revision,videoReviewer)=>{for(const [targetType,targetId] of [['AI_DRAFT',aiRunId],['COURSE',courseVersionId],['VIDEO_LESSON',lesson.lessonId]])await store.recordDecision({tenant:{...tenant,actorId:targetType==='VIDEO_LESSON'?videoReviewer:reviewerId},courseVersionId,targetType,targetId,decision:'APPROVE',rationale:'Engineering review of saved revision.',revision,idempotencyKey:id+targetType+revision,requestHash:id+targetType+revision});};
  await approveRevision(3,editorId);
  await assert.rejects(publish(),/LESSON_FINAL_INDEPENDENT_REVIEW_REQUIRED/,'A second editor must not independently approve their own instructional changes');
  const scorecardOnly=structuredClone((await store.get(tenant,courseVersionId)).courseVersion.content);
  scorecardOnly.videoLessons[0].finalReview.reviewerId=reviewerId;
  scorecardOnly.videoLessons[0].finalReview.reviewedAt=new Date().toISOString();
  await store.saveDraft({tenant:{...tenant,actorId:reviewerId},courseVersionId,revision:3,content:scorecardOnly});
  await approveRevision(4,reviewerId);
  const release=await publish();assert(release.releaseId);assert.equal(release.manifest.content.videoLessons[0].finalReview.assetVersionId,finalId);
  console.log('Lesson PostgreSQL publication passed: JSONB save/reload, immutable final hash, independent current-revision approval, rejected altered hash/original author/second editor/old review, and scorecard-only independent reviewer save then release. Fixture scorecards do not establish clinical or listening acceptance.');
}finally{
  for(const table of ['outbox_events','release_manifests','audit_events','course_review_decisions','ai_runs','course_versions','asset_versions','assets','courses'])await pool.query(`DELETE FROM ${table} WHERE organization_id=$1`,[organizationId]).catch(()=>{});
  await pool.end();
}
