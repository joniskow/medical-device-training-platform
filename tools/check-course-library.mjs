import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { applyProcessingJobMigration, createPostgresCourseReviewStore, createPostgresKnowledgeStore } from '../packages/db/dist/index.js';
import { createJobStatusHttpServer } from '../apps/api/dist/job-status-http.js';

const pool = new Pool({ connectionString: 'postgresql://local_app:local_only_change_me@127.0.0.1:54329/medical_device' });
const organizationId = `library:${randomUUID()}`;
const tenant = { organizationId, actorId: 'author', correlationId: organizationId };
const store = createPostgresCourseReviewStore(pool);
const server = createJobStatusHttpServer({
  courseReviewStore: store,
  knowledgeStore: createPostgresKnowledgeStore(pool),
  authenticator: { authenticate: async request => {
    const actor = request.headers.authorization?.replace('Bearer ', '');
    return ['author','reviewer','learner','foreign'].includes(actor) ? { subject: actor, roles: [actor === 'foreign' ? 'author' : actor] } : null;
  } },
  organizationContextResolver: { resolveActiveOrganizations: async actor => [actor === 'foreign' ? `${organizationId}:foreign` : organizationId] },
  statusService: { get: async () => null, retry: async () => null }
});
try {
  await applyProcessingJobMigration(pool);
  const request = { tenant, title: 'First course', idempotencyKey: 'duplicate' };
  const results = await Promise.all([store.createDraft(request), store.createDraft(request)]);
  assert.deepEqual(results[0], results[1]);
  await assert.rejects(store.createDraft({ ...request, title: 'Changed title' }), /IDEMPOTENCY_KEY_REUSED/);
  const snapshot = await store.get(tenant, results[0].courseVersionId);
  assert.equal(snapshot.courseVersion.revision, 1);
  assert.equal(snapshot.courseVersion.status, 'DRAFT');
  assert.equal(snapshot.courseVersion.content.title, 'First course');
  await Promise.all(Array.from({ length: 51 }, (_, i) => store.createDraft({ tenant, title: `Course ${i}`, idempotencyKey: `page:${i}` })));
  const first = await store.listDrafts(tenant);
  const second = await store.listDrafts(tenant, first.nextCursor);
  assert.equal(first.items.length, 50);
  assert.equal(second.items.length, 2);
  assert.equal(second.nextCursor, undefined);
  assert.equal(new Set([...first.items, ...second.items].map(x => x.courseVersionId)).size, 52);
  assert.deepEqual((await store.listDrafts({ ...tenant, organizationId: 'foreign' })).items, []);
  assert.equal(await store.get({ ...tenant, organizationId: 'foreign' }, results[0].courseVersionId), null);
  const audits = await pool.query(`SELECT count(*)::int AS count FROM audit_events WHERE organization_id=$1 AND event_type='COURSE_CREATED'`, [organizationId]);
  assert.equal(audits.rows[0].count, 52);
  await new Promise(r => server.listen(0,'127.0.0.1',r));
  const url = `http://127.0.0.1:${server.address().port}/api/v1/courses`;
  const call = (actor, method='GET', body, key='http:create') => fetch(url, { method, headers: { authorization: `Bearer ${actor}`, 'content-type':'application/json', 'idempotency-key':key }, ...(body ? { body: JSON.stringify(body) } : {}) });
  assert.equal((await call('unknown')).status, 401);
  assert.equal((await call('learner')).status, 403);
  assert.equal((await call('reviewer', 'POST', { title: 'Denied' })).status, 403);
  assert.equal((await call('author', 'POST', { title: 'Spoof', organizationId: 'foreign' })).status, 422);
  const created = await call('author', 'POST', { title: 'HTTP course' });
  assert.equal(created.status, 201);
  assert.deepEqual(await created.json(), await (await call('author', 'POST', { title: 'HTTP course' })).json());
  assert.equal((await call('author', 'POST', { title: 'Mismatch' })).status, 409);
  assert.equal((await call('reviewer')).status, 200);
  assert.deepEqual((await (await call('foreign')).json()).items, []);
  const sourcesUrl = url.replace('/courses','/knowledge-sources');
  assert.equal((await fetch(sourcesUrl, { headers: { authorization:'Bearer learner' } })).status, 403);
  assert.equal((await fetch(sourcesUrl, { headers: { authorization:'Bearer author' } })).status, 200);
  assert.equal((await fetch(sourcesUrl+'?after=%3Cinvalid%3E', { headers: { authorization:'Bearer author' } })).status, 422);
  assert.equal((await fetch(sourcesUrl+'/missing', { headers: { authorization:'Bearer learner' } })).status, 403);
  assert.equal((await fetch(sourcesUrl+'/missing', { headers: { authorization:'Bearer author' } })).status, 404);
  console.log('Course library passed: atomic creation, duplicate replay, mismatch rejection, cursor paging, tenant isolation, audit count, HTTP permissions and organization spoof denial.');
} finally {
  server.closeAllConnections();
  if (server.listening) await new Promise(r => server.close(r));
  for (const table of ['audit_events','course_versions','courses']) await pool.query(`DELETE FROM ${table} WHERE organization_id=$1`, [organizationId]);
  await pool.end();
}
