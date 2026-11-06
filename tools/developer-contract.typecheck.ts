import type {components} from '../packages/api-client/src/schema.js';
import type {ModelSessionStartResult,ModelSessionActionRequest,ModelSessionActionResult} from '../apps/api/src/model-session-service.js';
import type {ModelSessionDebrief,ModelInteractionOption} from '../packages/contracts/src/model-session.js';

// The generated public shapes must accept the server's actual typed projections, and vice versa.
type Compatible<Left extends Right,Right> = Left;
type Schema=components['schemas'];
export type PublicSession=Compatible<ModelSessionStartResult,Schema['ModelSession']>;
export type ServerSession=Compatible<Schema['ModelSession'],ModelSessionStartResult>;
export type PublicAction=Compatible<ModelSessionActionRequest,Schema['ModelAction']>;
export type ServerAction=Compatible<Schema['ModelAction'],ModelSessionActionRequest>;
export type PublicResult=Compatible<ModelSessionActionResult,Schema['ModelActionResult']>;
export type ServerResult=Compatible<Schema['ModelActionResult'],ModelSessionActionResult>;
export type PublicDebrief=Compatible<ModelSessionDebrief,Schema['ModelDebrief']>;
export type ServerDebrief=Compatible<Schema['ModelDebrief'],ModelSessionDebrief>;
export type PublicOption=Compatible<ModelInteractionOption,Schema['InteractionOption']>;
