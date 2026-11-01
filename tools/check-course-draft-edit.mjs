import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { applyProcessingJobMigration, createPostgresCourseReviewStore } from '../packages/db/dist/index.js';

const pool = new Pool({ connectionString: 'postgresql://local_app:local_only_change_me@127.0.0.1:54329/medical_device' });
const id = `edit_${randomUUID()}`;
const tenant = { organizationId: id, actorId: 'author', correlationId: id };
const content = { schemaVersion: 'course-draft.v1', title: 'Original', modules: [], _source: { aiRunId: 'original-ai' } };
const store = createPostgresCourseReviewStore(pool);
try {
  await applyProcessingJobMigration(pool);
  await pool.query(`INSERT INTO courses (course_id, organization_id, name, status, created_by, created_at, updated_at) VALUES ($1,$1,'Test','DRAFT','author',now(),now())`, [id]);
  await pool.query(`INSERT INTO course_versions (course_version_id, course_id, organization_id, revision, content, status, created_by, created_at, updated_at) VALUES ($1,$1,$1,1,$2,'IN_REVIEW','author',now(),now())`, [id, content]);
  const input = { tenant, courseVersionId: id, revision: 1, content: { ...content, title: 'Edited', _source: { aiRunId: 'forged' } } };
  assert.equal(await store.saveDraft({ ...input, tenant: { ...tenant, organizationId: 'foreign' } }), null);
  const concurrent = await Promise.allSettled([store.saveDraft(input), store.saveDraft(input)]);
  assert.equal(concurrent.filter(x => x.status === 'fulfilled').length, 1);
  assert.equal(concurrent.find(x => x.status === 'rejected').reason.message, 'COURSE_VERSION_STALE');
  const snapshot = await store.get(tenant, id);
  assert.equal(snapshot.courseVersion.revision, 2);
  assert.equal(snapshot.courseVersion.status, 'DRAFT');
  assert.deepEqual(snapshot.courseVersion.content._source, content._source);
  const audit = await pool.query(`SELECT details FROM audit_events WHERE organization_id=$1 AND event_type='COURSE_DRAFT_EDITED'`, [id]);
  assert.equal(audit.rowCount, 1);
  assert.deepEqual(audit.rows[0].details.before, content);
  await assert.rejects(store.recordDecision({ tenant, courseVersionId: id, revision: 1, targetType: 'COURSE', targetId: id, decision: 'APPROVE', rationale: 'Old review', idempotencyKey: id, requestHash: id }), /COURSE_VERSION_STALE/);
  assert.equal(await store.saveGeneratedDraft({ tenant, courseVersionId: id, revision: 1, aiRunId: 'stale-ai', content }), false);
  assert.equal((await store.get(tenant, id)).courseVersion.content.title, 'Edited');
  await store.saveGeneratedDraft({ tenant, courseVersionId: id, revision: 2, aiRunId: 'new-ai', content });
  assert.equal((await store.get(tenant, id)).courseVersion.revision, 3);
  await pool.query(`UPDATE course_versions SET status='PUBLISHED' WHERE course_version_id=$1`, [id]);
  await assert.rejects(store.saveDraft({ ...input, revision: 3 }), /COURSE_VERSION_IMMUTABLE/);
  assert.equal(await store.saveGeneratedDraft({ tenant, courseVersionId: id, revision: 3, aiRunId: 'later-ai', content }), false);
  console.log('Course draft editing passed: concurrency, tenant denial, provenance, revision history, stale review denial, generated revision, and immutable release.');
} finally {
  for (const table of ['audit_events', 'course_review_decisions', 'course_versions', 'courses']) await pool.query(`DELETE FROM ${table} WHERE organization_id=$1`, [id]);
  await pool.end();
}
