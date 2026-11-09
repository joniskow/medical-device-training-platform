// Versioned certification and learner integration surface. Other platform surfaces are extended independently.
import {technicalOpenApiPaths,technicalOpenApiSchemas} from './technical-openapi.js';
import {machineIntegrationOpenApiPaths,machineIntegrationOpenApiSchemas,machineIntegrationOpenApiSecuritySchemes} from './machine-integration-openapi.js';
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
  info: { title: 'Medical Device Training Certification API', version: '0.2.0', description: 'Azure-hosted same-origin /api/v1 integration. Entra API access tokens are required except auth/config and public credential verification. The API owns progress, scores and model state. Model actions use HTTP 200 for accepted and rejected semantic outcomes. This document is generated with the application build; deployment and physical-device evidence are tracked separately.' },
  servers: [{ url: '/' }], security: [{ bearerAuth: [] }],
  paths: {
    ...technicalOpenApiPaths,
    ...machineIntegrationOpenApiPaths,
    '/api/v1/auth/config': { get: { ...operation('getAuthConfig', 'Read public Microsoft sign-in configuration', ref('AuthConfig')), security: [] } },
    '/api/v1/account/email-verification/start': { post: { ...operation('startEmailVerification', 'Send a bounded possession challenge for the authenticated signed identity; repeated starts may return 429', object({ challengeId: { type: 'string', format: 'uuid' }, expiresInSeconds: { type: 'integer', const: 600 } }), [], object({ email: { type: 'string', format: 'email', maxLength: 254 } })), responses: { '202': response(object({ challengeId: { type: 'string', format: 'uuid' }, expiresInSeconds: { type: 'integer', const: 600 } })), default: operation('', '', {}).responses.default } } },
    '/api/v1/account/email-verification/complete': { post: operation('completeEmailVerification', 'Consume a one-time challenge; assurance is capped by the current signed token expiry', object({ verified: { type: 'boolean', const: true }, verificationExpiresAt: { type: 'string', format: 'date-time' } }, ['verified']), [], object({ challengeId: { type: 'string', format: 'uuid' }, code: { type: 'string', pattern: '^[0-9]{6}$' } })) },
    '/api/v1/account/email-verification/revoke': { post: operation('revokeEmailVerification', 'Revoke independent possession assurance; verified remains true when the signed provider separately attests email', object({ verified: boolean }), [], object({ confirmed: { type: 'boolean', const: true } })) },
    '/api/v1/account': { get: operation('getAccount', 'Validate the signed-in personal account', object({account:{anyOf:[ref('Account'),{type:'null'}]}})) },
    '/api/v1/organization-contexts': { get: operation('listOrganizations', 'List active organization contexts', object({ items: array(ref('Organization')) })) },
    '/api/v1/organization-contexts/{organizationId}/select': { post: operation('selectOrganization', 'Select an active organization', object({ organizationId: id }), [path('organizationId'), key], object({})) },
    '/api/v1/enrollments': { post: { ...operation('assignEnrollment', 'Assign a published release to an active organization member (organization_admin/operator)', ref('EnrollmentSummary'), [organization], object({ learnerId: id, releaseId: id })), responses: { '201': response(ref('EnrollmentSummary')), default: operation('', '', {}).responses.default } }, get: operation('listEnrollments', 'List the current learner’s active enrollments', object({ items: array(ref('EnrollmentSummary')), nextCursor: { type: ['string', 'null'] } }), [organization, cursor]) },
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
    '/api/v1/course-versions/{courseVersionId}': {
      get: operation('getCourseVersion', 'Read an author/reviewer/publisher draft snapshot', ref('CourseVersionSnapshot'), [organization, path('courseVersionId')]),
      post: { ...operation('reviewCourseVersion', 'Record an independent reviewer decision bound to the current revision', ref('ReviewDecision'), [organization, path('courseVersionId'), key], ref('ReviewRequest')), responses: { '201': response(ref('ReviewDecision')), default: operation('', '', {}).responses.default } },
      put: operation('saveCourseVersion', 'Save an author draft using the current revision; stale/immutable revision returns 409', object({ revision: integer }), [organization, path('courseVersionId')], object({ revision: { ...integer, minimum: 1 }, content: { type: 'object', additionalProperties: true } }))
    },
    '/api/v1/course-versions/{courseVersionId}/publish': { post: operation('publishCourseVersion', 'Publish independently approved immutable content (publisher)', ref('Release'), [organization, path('courseVersionId'), key], object({})) },
    '/api/v1/enrollments/{enrollmentId}/activities/{activityId}/acknowledge': { post: operation('acknowledgeActivity', 'Record passive activity evidence; never substitutes for scored competency evidence', { type: 'object', additionalProperties: true }, [organization, path('enrollmentId'), path('activityId')], object({})) },
    '/api/v1/assessment-sessions': { post: { ...operation('startAssessment', 'Start a release-bound assessment; retain the key when retrying the same intent', ref('AssessmentSession'), [organization, key], object({ enrollmentId: id, releaseId: id, activityId: id })), responses: { '201': response(ref('AssessmentSession')), default: operation('', '', {}).responses.default } } },
    '/api/v1/assessment-sessions/{sessionId}': { get: operation('getAssessment', 'Read the current learner assessment without answers or private rationales', ref('AssessmentSession'), [organization, path('sessionId')]) },
    '/api/v1/assessment-sessions/{sessionId}/submit': { post: operation('submitAssessment', 'Submit answer identities; replay only identical answers to the same session', ref('AssessmentSession'), [organization, path('sessionId')], object({ answers: array(ref('AssessmentAnswer')) })) },
    '/api/v1/credentials': { get: operation('listCredentials', 'List own credentials; learnerId requires organization_admin/operator', object({ items: array(ref('Credential')), nextCursor: { type: ['string', 'null'] } }), [organization, cursor, { name: 'learnerId', in: 'query', schema: id }]) },
    '/api/v1/enrollments/{enrollmentId}/credential': { post: operation('issueCredential', 'Obtain the exactly-once credential after authoritative requirements pass', ref('Credential'), [organization, path('enrollmentId')], object({})) },
    '/api/v1/credentials/{credentialId}/sharing': { post: operation('setCredentialSharing', 'Change the owner sharing consent using the current sharing revision', ref('Credential'), [organization, path('credentialId'), key], object({ enabled: boolean, revision: { ...integer, minimum: 0 } })) },
    '/api/v1/credentials/{credentialId}/revoke': { post: operation('revokeCredential', 'Revoke a credential (organization_admin/operator); historical evidence is retained', ref('Credential'), [organization, path('credentialId'), key], object({ reason: string })) },
    '/api/v1/credentials/{credentialId}/supersede': { post: operation('supersedeCredential', 'Supersede with an eligible replacement (organization_admin/operator)', ref('Credential'), [organization, path('credentialId'), key], object({ reason: string, replacementId: id })) },
    '/api/v1/verify/{publicId}': { get: { ...operation('verifyCredential', 'Read a minimal shared credential projection; unshared or unknown IDs return 404', ref('PublicCredential'), [{ name: 'publicId', in: 'path', required: true, schema: string }]), security: [] } },
    '/api/v1/model-sessions': { post: operation('startModelSession', 'Low-level release-bound start; prefer activity start', ref('ModelSession'), [organization, key], ref('ModelSessionStartRequest')) },
    '/api/v1/model-sessions/{sessionId}': { get: operation('resumeModelSession', 'Restore authoritative model state', ref('ModelActionResult'), [organization, path('sessionId'),
      ...['releaseBindingId', 'modelVersionId'].map(name => ({ name, in: 'query', required: true, schema: id })),
      { name: 'nextSequence', in: 'query', required: true, schema: { ...integer, minimum: 1 } }]) },
    '/api/v1/model-sessions/{sessionId}/actions': { post: operation('submitModelAction', 'Submit one semantic action', ref('ModelActionResult'), [organization, path('sessionId'), key], ref('ModelAction')) },
    '/api/v1/model-sessions/{sessionId}/debrief': { get: operation('getModelDebrief', 'Read the owner’s recorded activity debrief, including after expiry', ref('ModelDebrief'), [organization, path('sessionId')]) }
  },
  components: {
    securitySchemes: { ...machineIntegrationOpenApiSecuritySchemes,bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'Microsoft Entra API access token. An ID token is not an API access token.' } },
    schemas: {
      ...technicalOpenApiSchemas,
      ...machineIntegrationOpenApiSchemas,
      AssessmentAnswer: object({ questionId: id, selectedOptionIds: { ...array(id), uniqueItems: true } }),
      AssessmentSession: object({ sessionId: id, enrollmentId: id, releaseId: id, activityId: id, attemptNumber: integer, status: { type: 'string', enum: ['IN_PROGRESS','PASSED','FAILED','EXPIRED','INVALIDATED'] }, expiresAt: { type: 'string', format: 'date-time' },
        assessment: object({ assessmentId: id, version: integer, questions: array(object({ questionId: id, type: { type: 'string', enum: ['multiple_choice','multi_select','ordered_step'] }, prompt: string, options: array(object({ optionId: id, text: string })) })) }),
        result: object({ score: number, maxScore: number, passed: boolean, demonstratedCompetencyIds: array(id), missedCompetencyIds: array(id) })
      }, ['sessionId','enrollmentId','releaseId','activityId','attemptNumber','status','expiresAt','assessment']),
      Credential: object({ courseId: id, credentialId: id, publicId: string, issuerId: id, courseVersionId: id, releaseId: id, policyVersion: integer, title: string, status: { type: 'string', enum: ['ACTIVE','EXPIRED','REVOKED','SUPERSEDED'] }, supersededBy: { type: ['string','null'] }, verificationAllowed: boolean, verificationEnabled: boolean, sharingRevision: integer, issuedAt: { type: 'string', format: 'date-time' }, expiresAt: { type: ['string','null'], format: 'date-time' }, intendedUse: string }, ['credentialId','publicId','issuerId','courseVersionId','releaseId','policyVersion','title','status','supersededBy','verificationAllowed','verificationEnabled','sharingRevision','issuedAt','expiresAt','intendedUse']),
      PublicCredential: object({ courseTitle: string, issuerName: string, status: string, issuedAt: { type: 'string', format: 'date-time' }, expiresAt: { type: ['string','null'], format: 'date-time' }, intendedUse: string, verifiedAt: { type: 'string', format: 'date-time' } }),
      CourseVersionSnapshot: object({ courseVersion: object({ courseVersionId: id, revision: integer, status: string, content: { type: 'object', additionalProperties: true } }), decisions: array(ref('ReviewDecision')), release: ref('Release') }, ['courseVersion','decisions']),
      ReviewRequest: object({ revision: { ...integer, minimum: 1 }, targetType: { type: 'string', enum: ['COURSE','AI_DRAFT','SOURCE','MODEL','SIMULATION','ASSESSMENT','POLICY','VIDEO_LESSON'] }, targetId: id, decision: { type: 'string', enum: ['APPROVE','REJECT','NEEDS_CHANGES'] }, rationale: { type: 'string', minLength: 1, maxLength: 4000 } }),
      ReviewDecision: object({ decisionId: id, courseVersionId: id, organizationId: id, actorId: id, targetType: string, targetId: id, decision: string, rationale: string, createdAt: { type: 'string', format: 'date-time' } }, ['decisionId','targetType','targetId','decision','rationale'], true),
      Release: object({ releaseId: id, organizationId: id, courseVersionId: id, status: string, releaseHash: string, manifest: { type: 'object', additionalProperties: true }, publishedBy: id, createdAt: { type: 'string', format: 'date-time' } }),
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
