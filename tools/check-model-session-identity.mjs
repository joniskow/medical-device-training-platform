import assert from 'node:assert/strict';
import { sameModelSessionAction } from '../apps/api/dist/model-session-service.js';

const base = { clientActionId: 'action-1', releaseBindingId: 'binding-1', modelVersionId: 'model-1', expectedSequence: 1, type: 'activate_target', componentId: 'AIC-C01', targetId: 'AIC-C01-PRIME' };
assert.equal(sameModelSessionAction(base, { ...base }), true);
assert.equal(sameModelSessionAction(base, { ...base, targetId: 'AIC-C01-STOP' }), false, 'a reused action ID must not replay a different interaction target');
assert.equal(sameModelSessionAction(base, { ...base, componentId: 'AIC-C02' }), false);
console.log('Model session identity passed: target IDs participate in idempotent action equality.');
