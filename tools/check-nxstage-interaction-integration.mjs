import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { dirname } from 'node:path';

// Compare the concurrently maintained app binding with the isolated review.
// This check never rewrites either fixture or proposes semantic remappings.
const readJson = async path => JSON.parse(await readFile(path, 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const activePath = 'fixtures/nxstage-system-one-interactive';
const reviewPath = process.env.NXSTAGE_INTEGRATION_REVIEW_FOLDER ?? 'fixtures/nxstage-system-one-interaction-review';
const reportPath = process.env.NXSTAGE_INTEGRATION_REPORT ?? 'output/nxstage-interaction-review/integration-report.json';
const [active, review, activeScene, reviewScene, activeGlb, reviewGlb] = await Promise.all([
  readJson(`${activePath}/model-manifest.json`), readJson(`${reviewPath}/model-manifest.json`),
  readJson('apps/web/src/model/nxstage-training-scene-manifest.json'), readJson(`${reviewPath}/office-scene-review.json`),
  readFile(`${activePath}/nxstage-system-one.glb`), readFile(`${reviewPath}/nxstage-system-one.glb`)
]);
for (const [label, manifest, scene, bytes] of [['active', active, activeScene, activeGlb], ['review', review, reviewScene, reviewGlb]]) {
  assert.equal(hash(bytes), manifest.sourceHash, `${label} GLB and manifest must match`);
  assert.equal(scene.model.sourceHash, manifest.sourceHash, `${label} scene and manifest must match`);
  assert.equal(scene.model.modelVersionId, manifest.modelVersionId, `${label} scene and model version must match`);
  const targets = new Set(manifest.components.flatMap(c => (c.interactionTargets ?? []).map(t => `${c.componentId}:${t.targetId}`)));
  for (const cue of scene.interaction?.cues ?? []) assert(targets.has(`${cue.componentId}:${cue.targetId}`), `${label} scene references an unknown target`);
}
const targets = manifest => new Map(manifest.components.flatMap(c => (c.interactionTargets ?? []).map(t => [`${c.componentId}:${t.targetId}`, {componentId:c.componentId, ...t}])));
const current = targets(active), proposed = targets(review);
const missing = [...current].filter(([key]) => !proposed.has(key)).map(([, value]) => value);
const added = [...proposed].filter(([key]) => !current.has(key)).map(([, value]) => value);
// A reused ID is not proof that interaction semantics or physical motion match.
// Compare all target properties while reporting node bindings separately: a
// renamed mesh alone does not establish that a control has changed meaning.
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const equal = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const changed = [...current].flatMap(([key, before]) => {
  const after = proposed.get(key);
  if (!after) return [];
  const fields = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(field => !['componentId', 'targetId', 'nodePath'].includes(field));
  const differences = Object.fromEntries(fields.filter(field => !equal(before[field], after[field])).map(field => [field, {active: before[field] ?? null, review: after[field] ?? null}]));
  return Object.keys(differences).length || before.nodePath !== after.nodePath ? [{componentId: before.componentId, targetId: before.targetId, differences, ...(before.nodePath !== after.nodePath ? {nodePaths: {active: before.nodePath, review: after.nodePath}} : {})}] : [];
});
const reviewComponents = new Map(review.components.map(component => [component.componentId, component]));
const changedComponents = active.components.flatMap(before => {
  const after = reviewComponents.get(before.componentId);
  if (!after) return [];
  const fields = ['nodePath', 'permittedTransforms'];
  const differences = Object.fromEntries(fields.filter(field => !equal(before[field], after[field])).map(field => [field, {active:before[field] ?? null, review:after[field] ?? null}]));
  return Object.keys(differences).length ? [{componentId:before.componentId,differences}] : [];
});
const scenePlacementDifferences = Object.fromEntries(['translationMeters','rotationRadians','scale'].filter(field => !equal(activeScene.model[field],reviewScene.model[field])).map(field => [field,{active:activeScene.model[field] ?? null,review:reviewScene.model[field] ?? null}]));
const incompatibleCues = (activeScene.interaction?.cues ?? []).filter(c => !proposed.has(`${c.componentId}:${c.targetId}`)).map(c => ({componentId:c.componentId,targetId:c.targetId}));
const report = {
  status: active.sourceHash === review.sourceHash && active.modelVersionId === review.modelVersionId && missing.length === 0 && added.length === 0 && changed.length === 0 && changedComponents.length === 0 && !Object.keys(scenePlacementDifferences).length && incompatibleCues.length === 0 ? 'MATCHED' : 'RECONCILIATION_REQUIRED',
  active: {modelVersionId:active.modelVersionId, sourceHash:active.sourceHash},
  review: {modelVersionId:review.modelVersionId, sourceHash:review.sourceHash},
  activeTargetsNotInReview: missing,
  additionalReviewTargets: added,
  sharedTargetsWithChanges: changed,
  sharedComponentsWithChanges: changedComponents,
  scenePlacementDifferences,
  activeSceneCuesNotInReview: incompatibleCues,
  notes: [
    'Review asset is unmeasured and is not a production or clinical release.',
    'Target IDs absent from the review require source-grounded reconciliation; do not infer a replacement from similar wording.',
    'Shared IDs and matching metadata do not establish equivalent geometry or clinical meaning; inspect changed node paths and interaction properties before migration.',
    'The model version, scene binding, target cues, application static assets, and any persisted sessions or course references must be reconciled together.'
  ]
};
await mkdir(dirname(reportPath), {recursive:true});
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(`Active ${current.size} targets; review ${proposed.size}; ${missing.length} missing active targets, ${incompatibleCues.length} incompatible cues, ${changed.length} shared targets and ${changedComponents.length} shared components with changes. Both model/scene hashes verified.`);
console.log(`Report: ${reportPath}`);
