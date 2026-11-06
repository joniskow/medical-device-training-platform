// This contract describes the learner integration surface, not every administration endpoint.
const string = { type: 'string' };
const integer = { type: 'integer' };
const boolean = { type: 'boolean' };
const number = { type: 'number' };
const id = { type: 'string', pattern: '^[A-Za-z0-9._:-]{1,128}$' };
const modelId = { type: 'string', pattern: '^[A-Za-z0-9._:-]{1,200}$' };
const componentId = { type: 'string', minLength: 1, maxLength: 200, pattern: '\\S' };
const actionText = { type: 'string', minLength: 1, maxLength: 2000, pattern: '\\S' };
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const array = (items: object) => ({ type: 'array', items });
const object = (properties: Record<string, object>, required = Object.keys(properties), additionalProperties = false) => ({ type: 'object', properties, required, additionalProperties });
const path = (name: string) => ({ name, in: 'path', required: true, schema: id });
const organization = { name: 'X-Organization-Id', in: 'header', required: true, schema: id, description: 'Selected active organization. Membership and resource ownership are checked by the server.' };
const key = { name: 'Idempotency-Key', in: 'header', required: true, schema: modelId, description: 'Generate once per intent; retain on interrupted response. Changed intent requires a new key. For model actions this must equal clientActionId.' };
const cursor = { name: 'after', in: 'query', required: false, schema: string, description: 'Opaque nextCursor from the previous page.' };
const json = (schema: object) => ({ 'application/json': { schema } });
const response = (schema: object) => ({ description: 'Success. Inspect semantic status as well as HTTP status for model actions.', content: json(schema) });
const operation = (operationId: string, summary: string, schema: object, parameters: object[] = [], body?: object) => ({
  operationId, summary, tags: ['Learner'], parameters,
  ...(body ? { requestBody: { required: true, content: json(body) } } : {}),
  responses: { '200': response(schema), default: { description: 'Structured failure. 401: sign in; 403: access lost; 404: unavailable; 409: conflict; 422: invalid input; 429: wait; 5xx: transient server failure. Never automatically replay mutations.',
    headers: { 'X-Correlation-Id': { schema: string }, 'Retry-After': { schema: string } }, content: json(ref('ApiError')) } }
});
const transform = { ...object({ rotationY: number, translationX: number }, []), minProperties: 1 };
const stateProperties = {
  releaseBindingId: id, modelVersionId: id, sequence: { ...integer, minimum: 0 }, nextSequence: { ...integer, minimum: 1 },
  selectedComponentId: id, transforms: { type: 'object', additionalProperties: object({ rotationY: number, translationX: number }) },
  scorePoints: number, completed: boolean, activeStepId: id, activeStepTitle: string, activeStepInstructions: string, focusComponentId: id, activeFaultId: id, activeFaultTitle: string,
  allowedActions: array(string), interactionOptions: array(ref('InteractionOption'))
};
const enrollmentProperties = { enrollmentId: id, releaseId: id, courseVersionId: id, title: string, status: string };

export const learnerOpenApi = {
  openapi: '3.1.1',
  info: { title: 'Medical Device Training — Learner API', version: '0.1.0', description: 'Azure-hosted same-origin /api/v1 integration. Entra API access tokens are required except auth/config. The API owns progress, scores and model state. Model actions use HTTP 200 for accepted and rejected semantic outcomes. This document is generated with the application build; deployment and physical-device evidence are tracked separately.' },
  servers: [{ url: '/' }], security: [{ bearerAuth: [] }],
  paths: {
    '/api/v1/auth/config': { get: { ...operation('getAuthConfig', 'Read public Microsoft sign-in configuration', ref('AuthConfig')), security: [] } },
    '/api/v1/account': { get: operation('getAccount', 'Validate the signed-in personal account', object({account:{anyOf:[ref('Account'),{type:'null'}]}})) },
    '/api/v1/organization-contexts': { get: operation('listOrganizations', 'List active organization contexts', object({ items: array(ref('Organization')) })) },
    '/api/v1/organization-contexts/{organizationId}/select': { post: operation('selectOrganization', 'Select an active organization', object({ organizationId: id }), [path('organizationId'), key], object({})) },
    '/api/v1/enrollments': { get: operation('listEnrollments', 'List the current learner’s active enrollments', object({ items: array(ref('EnrollmentSummary')), nextCursor: { type: ['string', 'null'] } }), [organization, cursor]) },
    '/api/v1/enrollments/{enrollmentId}': { get: operation('getEnrollment', 'Read course content, activity IDs and recorded progress', ref('Enrollment'), [organization, path('enrollmentId')]) },
    '/api/v1/enrollments/{enrollmentId}/activities/{activityId}/start': { post: {
      ...operation('startActivity', 'Launch or resume the release-bound interactive attempt', ref('ModelSession'), [organization, path('enrollmentId'), path('activityId')], object({})),
      description: 'The server derives release, model, policy and attempt bindings. Retries resume the active attempt. Do not send forged binding fields or start a replacement attempt automatically after expiry.'
    } },
    '/api/v1/releases/{releaseId}/model-assets/{modelVersionId}': { get: {
      ...operation('getModelAsset', 'Obtain the approved model descriptor or private content', ref('ModelAsset'), [organization, path('releaseId'), path('modelVersionId'),
        { name: 'variant', in: 'query', schema: string }, { name: 'content', in: 'query', schema: { type: 'string', enum: ['model', 'manifest'] } }]),
      responses: { ...operation('', '', {}).responses, '200': { description: 'Descriptor by default; content=manifest returns JSON manifest, content=model returns GLB bytes.', content: {
        'application/json': { schema: { anyOf: [ref('ModelAsset'), { type: 'object', additionalProperties: true }] } },
        'model/gltf-binary': { schema: { type: 'string', format: 'binary' } }
      } } }
    } },
    '/api/v1/model-sessions': { post: operation('startModelSession', 'Low-level release-bound start; prefer activity start', ref('ModelSession'), [organization, key], ref('ModelSessionStartRequest')) },
    '/api/v1/model-sessions/{sessionId}': { get: operation('resumeModelSession', 'Restore authoritative model state', ref('ModelActionResult'), [organization, path('sessionId'),
      ...['releaseBindingId', 'modelVersionId'].map(name => ({ name, in: 'query', required: true, schema: id })),
      { name: 'nextSequence', in: 'query', required: true, schema: { ...integer, minimum: 1 } }]) },
    '/api/v1/model-sessions/{sessionId}/actions': { post: operation('submitModelAction', 'Submit one semantic action', ref('ModelActionResult'), [organization, path('sessionId'), key], ref('ModelAction')) },
    '/api/v1/model-sessions/{sessionId}/debrief': { get: operation('getModelDebrief', 'Read the owner’s recorded activity debrief, including after expiry', ref('ModelDebrief'), [organization, path('sessionId')]) }
  },
  components: {
    securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'Microsoft Entra API access token. An ID token is not an API access token.' } },
    schemas: {
      ApiError: object({ error: object({ code: string, message: string }) }),
      Account: object({userId:string,displayName:string,locale:string,status:{type:'string',enum:['ACTIVE','LOCKED']},revision:integer,emailVerified:boolean}),
      AuthConfig: object({ clientId: string, tenantId: string, authority: string, apiScope: string, applicationOrigin: string, knownAuthorities: array(string) }),
      Organization: object({ organizationId: id, name: string, role: string, roles: array(string) }, ['organizationId'], true),
      EnrollmentSummary: object(enrollmentProperties),
      Enrollment: object({ ...enrollmentProperties,
        content: object({ title: string, hasStory: boolean, modules: array(object({ moduleId: id, title: string, activities: array(object({ activityId: id, type: string, title: string, instructions: string, text: string }, ['activityId','type','title','instructions'])) })) }),
        progress: array(object({ activityId: id, status: string, score: number, maxScore: number }, ['activityId','status'])),
        eligibility: { type: 'object', additionalProperties: true }, assessmentSessions: array(object({ activityId: id, sessionId: id, status: string }))
      }),
      ModelAsset: object({ releaseId: id, releaseHash: string, modelVersionId: id, releaseBindingId: id, variantId: string, manifestHash: string, manifestUrl: string, modelUrl: string, fallbackManifest: { type: 'object', additionalProperties: true }, cacheControl: string }),
      InteractionOption: object({ componentId: id, targetId: id, label: string, type: { type: 'string', enum: ['activate_target','transform_component'] }, transform, enabled: boolean, blockedReason: string }, ['componentId','targetId','label','type','enabled']),
      ModelState: object(stateProperties, ['releaseBindingId','modelVersionId','sequence','nextSequence','transforms','scorePoints','completed','allowedActions']),
      ModelSessionStartRequest: object({ releaseId: id, activityId: id, simulationDefinitionId: id, modelVersionId: id, enrollmentId: id, attemptId: id, policyId: id, expiresInSeconds: { ...integer, minimum: 60, maximum: 86400 } }, ['releaseId','activityId','simulationDefinitionId','modelVersionId','enrollmentId','attemptId','policyId']),
      ModelSession: object({ sessionId: id, releaseId: id, activityId: id, simulationDefinitionId: id, enrollmentId: id, attemptId: id, policyId: id, policyVersion: integer, releaseBindingId: id, modelVersionId: id, expiresAt: { type: 'string', format: 'date-time' }, nextSequence: integer, allowedActions: array(string), state: ref('ModelState') }),
      ModelAction: {...object({ clientActionId: modelId, releaseBindingId: modelId, modelVersionId: modelId, expectedSequence: { ...integer, minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
        type: { type: 'string', enum: ['select_component','activate_target','transform_component','reset_component','request_hint','open_component','inspect_component','complete_step','acknowledge_fault','diagnose_fault','resolve_fault'] },
        componentId, targetId: componentId, source: { type: 'string', enum: ['CANVAS','COMPONENT_LIST','KEYBOARD'] }, value: actionText, stepId: actionText, transform
      }, ['clientActionId','releaseBindingId','modelVersionId','expectedSequence','type']),allOf:[
        {if:{properties:{type:{enum:['select_component','activate_target','transform_component','reset_component']}}},then:{required:['componentId']}},
        {if:{properties:{type:{const:'select_component'}}},then:{required:['source']}},
        {if:{properties:{type:{const:'activate_target'}}},then:{required:['targetId']}},
        {if:{properties:{type:{const:'transform_component'}}},then:{required:['transform']}},
        {if:{required:['transform']},then:{required:['componentId']}},
        {if:{properties:{type:{const:'reset_component'}}},then:{not:{anyOf:[{required:['transform']},{required:['value']},{required:['stepId']}]}}}
      ]},
      ModelActionResult: object({ status: { type: 'string', enum: ['accepted','invalid_precondition','stale_sequence','expired_session','unknown_component','version_mismatch','retryable_network_failure'] },
        clientActionId: id, nextSequence: integer, state: ref('ModelState'), feedback: string, scoreDelta: number, retryable: boolean
      }, ['status','nextSequence','feedback']),
      ModelDebrief: object({ sessionId: id, releaseId: id, modelVersionId: id, status: { type: 'string', enum: ['ACTIVE','COMPLETED','EXPIRED','INVALIDATED'] }, completed: boolean, scorePoints: number,
        steps: array(object({ stepId: id, title: string, completed: boolean, explanation: string })),
        events: array(object({ actionId: id, sequence: integer, occurredAt: { type: 'string', format: 'date-time' }, type: string, componentId: id, targetId: id, stepId: id, outcome: { type: 'string', enum: ['accepted','rejected','invalidated'] }, feedback: string }, ['actionId','sequence','occurredAt','type','outcome','feedback'])),
        hintsUsed: integer, rejectedAttempts: integer, eventsTruncated: boolean
      })
    }
  }
};
