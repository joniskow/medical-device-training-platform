import {assertStoryActivityAccess} from '@medical-device/db';
import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { TenantContext } from "@medical-device/contracts";
import { withTenantTransaction } from "@medical-device/db";
import { applyPermittedTransform, interactionStateViolation, validateAuthoritativeModelState, validateBrowserModelManifest, type AuthoritativeModelState, type ModelComponentManifest } from "@medical-device/model-runtime";
import { applySimulationAction, createInitialSimulationState, validateSimulationDefinition, type SimulationAction, type SimulationDefinition, type SimulationState } from "@medical-device/simulation-schema";
import { sameModelSessionAction, type ModelSessionActionRequest, type ModelSessionActionResult, type ModelSessionService, type ModelSessionStartRequest, type ModelSessionStartResult } from "./model-session-service.js";
import { issueCredentialInTransaction } from "./credential-service.js";

type JsonObject = Record<string, unknown>;
async function sessionAccessActive(client: PoolClient, tenant: TenantContext, sessionId: string): Promise<boolean> {
  const access = await client.query(`SELECT e.enrollment_id,s.release_id,s.activity_id FROM simulation_sessions s
    JOIN enrollments e ON e.organization_id=s.organization_id AND e.enrollment_id=s.enrollment_id AND e.learner_id=s.learner_id
    JOIN simulation_attempts a ON a.organization_id=s.organization_id AND a.simulation_attempt_id=s.attempt_id
      AND a.enrollment_id=e.enrollment_id AND a.learner_id=s.learner_id AND a.release_id=s.release_id
      AND a.activity_id=s.activity_id AND a.simulation_definition_id=s.simulation_definition_id
      AND a.model_version_id=s.model_version_id AND a.policy_id=s.policy_id
    JOIN release_manifests r ON r.organization_id=s.organization_id AND r.release_id=s.release_id AND r.course_version_id=e.course_version_id
    JOIN certification_policies p ON p.organization_id=s.organization_id AND p.policy_id=s.policy_id
      AND p.course_version_id=e.course_version_id AND p.version=s.policy_version
    WHERE s.organization_id=$1 AND s.simulation_session_id=$2 AND s.learner_id=$3
      AND s.status='ACTIVE' AND s.expires_at>CURRENT_TIMESTAMP AND e.status='ACTIVE'
      AND (a.status='ACTIVE' OR (a.status='COMPLETED' AND COALESCE(s.state->'modelState',s.state)->>'completed'='true')) AND r.status='PUBLISHED' AND p.status='PUBLISHED'
      AND a.started_at+COALESCE((p.policy->>'attemptTtlSeconds')::integer,86400)*interval '1 second'>CURRENT_TIMESTAMP
    FOR SHARE OF e,r,p FOR UPDATE OF a`,[tenant.organizationId,sessionId,tenant.actorId]);
  if(!access.rowCount)return false;
  try{await assertStoryActivityAccess(client,tenant,access.rows[0].enrollment_id,access.rows[0].release_id,access.rows[0].activity_id,true);}
  catch(error){if(error instanceof Error&&error.message==='STORY_ACTIVITY_UNAVAILABLE')return false;throw error;}
  return true;
}
type Transform = { rotationY: number; translationX: number };
type ModelState = {
  releaseBindingId: string;
  modelVersionId: string;
  sequence: number;
  nextSequence: number;
  selectedComponentId?: string;
  transforms: Record<string, Transform>;
  scorePoints: number;
  completed: boolean;
  activeStepId?: string;
  activeStepTitle?: string;
  activeFaultId?: string;
  activeFaultTitle?: string;
  allowedActions: string[];
  simulationState?: SimulationState;
};

function object(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function modelStateFrom(value: unknown): ModelState | null {
  const root = object(value);
  const candidate = object(root?.modelState) ?? root;
  const releaseBindingId = candidate ? text(candidate.releaseBindingId) : null;
  const modelVersionId = candidate ? text(candidate.modelVersionId) : null;
  const sequence = candidate && Number.isSafeInteger(candidate.sequence) ? candidate.sequence as number : null;
  const nextSequence = candidate && Number.isSafeInteger(candidate.nextSequence) ? candidate.nextSequence as number : null;
  const transformObject = candidate ? object(candidate.transforms) : null;
  const allowedActions = candidate && Array.isArray(candidate.allowedActions) && candidate.allowedActions.every((item) => typeof item === "string" && item.length > 0)
    ? candidate.allowedActions as string[]
    : null;
  if (!candidate
    || !releaseBindingId
    || !modelVersionId
    || sequence === null
    || sequence < 0
    || nextSequence === null
    || nextSequence !== sequence + 1
    || !transformObject
    || !finite(candidate.scorePoints)
    || (candidate.scorePoints as number) < 0
    || typeof candidate.completed !== "boolean"
    || !allowedActions) return null;
  const transforms: Record<string, Transform> = {};
  for (const [componentId, raw] of Object.entries(transformObject)) {
    const item = object(raw);
    if (!item || !finite(item.rotationY) || !finite(item.translationX)) return null;
    transforms[componentId] = { rotationY: item.rotationY, translationX: item.translationX };
  }
  const simulation = object(candidate.simulationState);
  const simulationState = simulation
    && Number.isSafeInteger(simulation.nextSequence)
    && Array.isArray(simulation.completedStepIds)
    && Array.isArray(simulation.resolvedFaultIds)
    && (simulation.diagnosedFaultIds===undefined||(Array.isArray(simulation.diagnosedFaultIds)&&simulation.diagnosedFaultIds.every(id=>typeof id==='string')&&new Set(simulation.diagnosedFaultIds).size===simulation.diagnosedFaultIds.length))
    && Array.isArray(simulation.acceptedActionIds)
    && Array.isArray(simulation.acceptedNonces)
    && object(simulation.variables)
    && object(simulation.componentStates)
    ? simulation as unknown as SimulationState
    : undefined;
  return {
    releaseBindingId,
    modelVersionId,
    sequence,
    nextSequence,
    ...(typeof candidate.selectedComponentId === "string" ? { selectedComponentId: candidate.selectedComponentId } : {}),
    transforms,
    scorePoints: candidate.scorePoints as number,
    completed: candidate.completed,
    ...(typeof candidate.activeStepId === "string" ? { activeStepId: candidate.activeStepId } : {}),
    ...(typeof candidate.activeStepTitle === "string" ? { activeStepTitle: candidate.activeStepTitle } : {}),
    ...(typeof candidate.activeFaultId === "string" ? { activeFaultId: candidate.activeFaultId } : {}),
    ...(typeof candidate.activeFaultTitle === "string" ? { activeFaultTitle: candidate.activeFaultTitle } : {}),
    allowedActions,
    ...(simulationState ? { simulationState } : {})
  };
}

function stateWithModel(original: unknown, model: ModelState): unknown {
  const root = object(original);
  if (root && root.modelState && typeof root.modelState === "object") return { ...root, modelState: model };
  return model;
}

function publicModelState(model: ModelState): Omit<ModelState, "simulationState"> {
  const { simulationState: _simulationState, ...publicState } = model;
  return publicState;
}

function stateMatchesManifest(model: ModelState, value: unknown): boolean {
  try {
    const manifest = validateBrowserModelManifest(value);
    return validateAuthoritativeModelState(manifest, publicModelState(model) as AuthoritativeModelState);
  } catch {
    return false;
  }
}

function result(status: ModelSessionActionResult["status"], nextSequence: number, feedback: string, state?: ModelState, extras?: Partial<ModelSessionActionResult>): ModelSessionActionResult {
  return { status, nextSequence, feedback, ...(state ? { state: publicModelState(state) } : {}), ...extras };
}

function simulationCompleted(definition: SimulationDefinition, state: SimulationState): boolean {
  return state.currentStepId === undefined && state.activeFaultId === undefined
    && definition.completion.requiredStepIds.every((stepId) => state.completedStepIds.includes(stepId))
    && definition.completion.requiredFaultIds.every((faultId) => state.resolvedFaultIds.includes(faultId));
}

function simulationProjection(definition: SimulationDefinition, state: SimulationState): Pick<ModelState, "activeStepId" | "activeStepTitle" | "activeFaultId" | "activeFaultTitle" | "allowedActions"> {
  const step = state.currentStepId ? definition.steps.find((item) => item.stepId === state.currentStepId) : undefined;
  const fault = state.activeFaultId ? definition.faults.find((item) => item.faultId === state.activeFaultId) : undefined;
  const requirement = fault
    ? (state.faultStage === "DIAGNOSIS" ? fault.diagnosis : fault.resolution)
    : step?.action;
  return {
    ...(step ? { activeStepId: step.stepId, activeStepTitle: step.title } : {}),
    ...(fault ? { activeFaultId: fault.faultId, activeFaultTitle: fault.title } : {}),
    allowedActions: requirement ? [requirement.type] : []
  };
}

function requestHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function modelStartResult(row: {
  simulation_session_id: string;
  release_id: string;
  activity_id: string;
  simulation_definition_id: string;
  enrollment_id: string;
  attempt_id: string;
  policy_id: string;
  policy_version: number;
  release_binding_id: string;
  model_version_id: string;
  expires_at: Date | string;
  state: unknown;
}): ModelSessionStartResult {
  const state = modelStateFrom(row.state);
  if (!state) throw new Error("MODEL_SESSION_STATE_INVALID");
  return {
    sessionId: row.simulation_session_id,
    releaseId: row.release_id,
    activityId: row.activity_id,
    simulationDefinitionId: row.simulation_definition_id,
    enrollmentId: row.enrollment_id,
    attemptId: row.attempt_id,
    policyId: row.policy_id,
    policyVersion: row.policy_version,
    releaseBindingId: row.release_binding_id,
    modelVersionId: row.model_version_id,
    expiresAt: new Date(row.expires_at).toISOString(),
    nextSequence: state.nextSequence,
    allowedActions: state.allowedActions,
    state: publicModelState(state)
  };
}

/**
 * Durable model-session adapter. Session start validates the existing
 * enrollment/attempt/release/policy bindings, then action mutation persists
 * the authoritative model state and idempotent action record atomically.
 */
export function createPostgresModelSessionService(input: { pool: Pool }): ModelSessionService {
  return {
    async start(tenant: TenantContext, request: ModelSessionStartRequest, idempotencyKey: string) {
      if (!tenant.actorId) throw new Error("MODEL_SESSION_ACTOR_REQUIRED");
      return withTenantTransaction(input.pool, tenant, async (client) => {
        const access=await client.query(`SELECT enrollment.enrollment_id FROM enrollments enrollment
          JOIN release_manifests release ON release.organization_id=enrollment.organization_id AND release.course_version_id=enrollment.course_version_id
          WHERE enrollment.organization_id=$1 AND enrollment.enrollment_id=$2 AND enrollment.learner_id=$3 AND enrollment.status='ACTIVE'
            AND release.release_id=$4 AND release.status='PUBLISHED' FOR UPDATE OF enrollment FOR SHARE OF release`,[tenant.organizationId,request.enrollmentId,tenant.actorId,request.releaseId]);
        if(!access.rows[0])throw new Error('ENROLLMENT_NOT_ACTIVE_FOR_RELEASE');
        await assertStoryActivityAccess(client,tenant,request.enrollmentId,request.releaseId,request.activityId,true);
        const startHash = requestHash({ actorId: tenant.actorId, request });
        const existing = await client.query<{
          simulation_session_id: string; release_id: string; activity_id: string; simulation_definition_id: string;
          enrollment_id: string; attempt_id: string; policy_id: string; policy_version: number; release_binding_id: string;
          model_version_id: string; expires_at: Date | string; state: unknown; start_request_hash: string | null; learner_id: string;
        }>(
          `SELECT simulation_session_id, release_id, activity_id, simulation_definition_id,
                  enrollment_id, attempt_id, policy_id, policy_version, release_binding_id, model_version_id,
                  expires_at, state, start_request_hash, learner_id
           FROM simulation_sessions
           WHERE organization_id = $1 AND idempotency_key = $2`,
          [tenant.organizationId, idempotencyKey]
        );
        if (existing.rows[0]) {
          if (existing.rows[0].learner_id !== tenant.actorId) throw new Error("IDEMPOTENCY_KEY_REUSED");
          if (existing.rows[0].start_request_hash !== startHash) throw new Error("IDEMPOTENCY_KEY_REUSED");
          if (!await sessionAccessActive(client,tenant,existing.rows[0].simulation_session_id)) throw new Error("ENROLLMENT_NOT_ACTIVE_FOR_RELEASE");
          return modelStartResult(existing.rows[0]);
        }
        const binding = await client.query<{ release_binding_id: string; model_version_id: string; manifest: unknown }>(
          `SELECT binding.release_binding_id, binding.model_version_id, binding.manifest
           FROM release_model_bindings binding
           JOIN release_manifests release ON release.organization_id = binding.organization_id AND release.release_id = binding.release_id
           WHERE binding.organization_id = $1 AND binding.release_id = $2 AND binding.model_version_id = $3 AND release.status = 'PUBLISHED'`,
          [tenant.organizationId, request.releaseId, request.modelVersionId]
        );
        const bindingRow = binding.rows[0];
        if (!bindingRow) throw new Error("MODEL_RELEASE_BINDING_NOT_FOUND");
        const manifest = object(bindingRow.manifest);
        const components = Array.isArray(manifest?.components) ? manifest.components.map(object).filter((item): item is JsonObject => Boolean(item)) : [];
        if (bindingRow.release_binding_id !== `releasebind:${request.releaseId}:${request.modelVersionId}`) throw new Error("MODEL_RELEASE_BINDING_INVALID");
        const enrollment = await client.query<{ enrollment_id: string }>(
          `SELECT enrollment.enrollment_id
           FROM enrollments enrollment
           JOIN release_manifests release ON release.organization_id = enrollment.organization_id AND release.course_version_id = enrollment.course_version_id
           WHERE enrollment.organization_id = $1 AND enrollment.enrollment_id = $2 AND enrollment.learner_id = $3
             AND enrollment.status = 'ACTIVE'
             AND release.release_id = $4 AND release.status = 'PUBLISHED'`,
          [tenant.organizationId, request.enrollmentId, tenant.actorId, request.releaseId]
        );
        if (!enrollment.rows[0]) throw new Error("ENROLLMENT_NOT_ACTIVE_FOR_RELEASE");
        const activity = await client.query<{ activity_id: string }>(
          `SELECT activity.activity_id
           FROM activities activity
           JOIN modules module ON module.organization_id = activity.organization_id AND module.module_id = activity.module_id
           JOIN release_manifests release ON release.organization_id = module.organization_id AND release.course_version_id = module.course_version_id
           WHERE activity.organization_id = $1 AND activity.activity_id = $2 AND release.release_id = $3 AND release.status = 'PUBLISHED'
             AND activity.content->>'simulationDefinitionId' = $4`,
          [tenant.organizationId, request.activityId, request.releaseId, request.simulationDefinitionId]
        );
        if (!activity.rows[0]) throw new Error("ACTIVITY_NOT_IN_RELEASE");
        const policy = await client.query<{ policy_id: string; version: number }>(
          `SELECT policy.policy_id, policy.version
           FROM certification_policies policy
           JOIN release_manifests release ON release.organization_id = policy.organization_id AND release.course_version_id = policy.course_version_id
           WHERE policy.organization_id = $1 AND policy.policy_id = $2 AND policy.status = 'PUBLISHED'
             AND release.release_id = $3 AND release.status = 'PUBLISHED'`,
          [tenant.organizationId, request.policyId, request.releaseId]
        );
        if (!policy.rows[0]) throw new Error("POLICY_NOT_PUBLISHED_FOR_RELEASE");
        const attempt = await client.query<{ simulation_attempt_id: string }>(
          `SELECT simulation_attempt_id
           FROM simulation_attempts
           WHERE organization_id = $1 AND simulation_attempt_id = $2 AND enrollment_id = $3
             AND learner_id = $4 AND release_id = $5 AND activity_id = $6
             AND simulation_definition_id = $7 AND model_version_id = $8 AND policy_id = $9 AND status = 'ACTIVE' FOR UPDATE`,
          [tenant.organizationId, request.attemptId, request.enrollmentId, tenant.actorId, request.releaseId, request.activityId, request.simulationDefinitionId, request.modelVersionId, request.policyId]
        );
        if (!attempt.rows[0]) throw new Error("SIMULATION_ATTEMPT_NOT_ACTIVE_OR_BOUND");
        const attemptSession=await client.query<typeof existing.rows[number] & {idempotency_key:string}>(`SELECT * FROM simulation_sessions WHERE organization_id=$1 AND attempt_id=$2`,[tenant.organizationId,request.attemptId]);
        if(attemptSession.rows[0]) {
          const prior=attemptSession.rows[0];
          if(prior.idempotency_key!==idempotencyKey || prior.start_request_hash!==startHash) throw new Error("SIMULATION_ATTEMPT_ALREADY_STARTED");
          if(!await sessionAccessActive(client,tenant,prior.simulation_session_id)) throw new Error("ENROLLMENT_NOT_ACTIVE_FOR_RELEASE");
          return modelStartResult(prior);
        }
        const definition = await client.query<{ simulation_definition_id: string; definition: unknown }>(
          `SELECT simulation_definition_id, definition
           FROM simulation_definitions
           WHERE organization_id = $1 AND simulation_definition_id = $2 AND status = 'PUBLISHED'`,
          [tenant.organizationId, request.simulationDefinitionId]
        );
        const definitionValue = definition.rows[0]?.definition;
        const definitionModel = object(object(definitionValue)?.model);
        const boundManifestHash = text(manifest?.sourceHash);
        const definitionComponentIds = Array.isArray(definitionModel?.componentIds) ? definitionModel.componentIds.filter((item): item is string => typeof item === "string") : [];
        const boundComponentIds = components.map((component) => String(component.componentId)).sort();
        if (!definition.rows[0] || !definitionModel || definitionModel.modelVersionId !== request.modelVersionId
          || (typeof definitionModel.manifestHash === "string" && definitionModel.manifestHash !== boundManifestHash)
          || definitionComponentIds.slice().sort().join("|") !== boundComponentIds.join("|")) throw new Error("SIMULATION_DEFINITION_NOT_PUBLISHED_OR_BOUND");
        const definitionValidation = validateSimulationDefinition(definitionValue);
        if (!definitionValidation.valid) throw new Error("SIMULATION_DEFINITION_INVALID");
        const typedDefinition = definitionValue as SimulationDefinition;
        const expiresInSeconds = request.expiresInSeconds ?? 1_800;
        if (!Number.isSafeInteger(expiresInSeconds) || expiresInSeconds < 60 || expiresInSeconds > 86_400) throw new Error("MODEL_SESSION_EXPIRY_INVALID");
        const initialSimulationState = createInitialSimulationState(typedDefinition);
        const state: ModelState = {
          releaseBindingId: bindingRow.release_binding_id,
          modelVersionId: request.modelVersionId,
          sequence: 0,
          nextSequence: 1,
          transforms: Object.fromEntries(components.map((component) => [String(component.componentId), { rotationY: 0, translationX: 0 }])),
          scorePoints: 0,
          completed: false,
          ...simulationProjection(typedDefinition, initialSimulationState),
          simulationState: initialSimulationState
        };
        const sessionId = `simulation-session:${randomUUID()}`;
        const inserted = await client.query<{
          simulation_session_id: string; release_id: string; activity_id: string; simulation_definition_id: string;
          enrollment_id: string; attempt_id: string; policy_id: string; policy_version: number; release_binding_id: string;
          model_version_id: string; expires_at: Date | string; state: unknown;
        }>(
          `INSERT INTO simulation_sessions (
             simulation_session_id, organization_id, simulation_definition_id, learner_id, state,
             next_sequence, expires_at, release_id, activity_id, enrollment_id, attempt_id, policy_id, policy_version,
             model_version_id, release_binding_id, status, idempotency_key, start_request_hash, created_at, updated_at
           ) VALUES ($1, $2, $3, $4, $5::jsonb, 1, CURRENT_TIMESTAMP + ($6 * INTERVAL '1 second'), $7, $8, $9, $10, $11, $12, $13, $14, 'ACTIVE', $15, $16, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
           ON CONFLICT (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
           RETURNING simulation_session_id, release_id, activity_id, simulation_definition_id,
                     enrollment_id, attempt_id, policy_id, policy_version, release_binding_id, model_version_id,
                     expires_at, state`,
          [sessionId, tenant.organizationId, request.simulationDefinitionId, tenant.actorId, JSON.stringify(state), expiresInSeconds, request.releaseId, request.activityId, request.enrollmentId, request.attemptId, request.policyId, policy.rows[0].version, request.modelVersionId, bindingRow.release_binding_id, idempotencyKey, startHash]
        );
        if (inserted.rows[0]) {
          if (!await sessionAccessActive(client,tenant,inserted.rows[0].simulation_session_id)) throw new Error("ENROLLMENT_NOT_ACTIVE_FOR_RELEASE");
          return modelStartResult(inserted.rows[0]);
        }
        const raced = await client.query<{
          simulation_session_id: string; release_id: string; activity_id: string; simulation_definition_id: string;
          enrollment_id: string; attempt_id: string; policy_id: string; policy_version: number; release_binding_id: string;
          model_version_id: string; expires_at: Date | string; state: unknown; start_request_hash: string | null;
        }>(
          `SELECT simulation_session_id, release_id, activity_id, simulation_definition_id,
                  enrollment_id, attempt_id, policy_id, policy_version, release_binding_id, model_version_id,
                  expires_at, state, start_request_hash
           FROM simulation_sessions
           WHERE organization_id = $1 AND idempotency_key = $2`,
          [tenant.organizationId, idempotencyKey]
        );
        if (!raced.rows[0]) throw new Error("MODEL_SESSION_START_CONFLICT");
        if (raced.rows[0].start_request_hash !== startHash) throw new Error("IDEMPOTENCY_KEY_REUSED");
        if (!await sessionAccessActive(client,tenant,raced.rows[0].simulation_session_id)) throw new Error("ENROLLMENT_NOT_ACTIVE_FOR_RELEASE");
        return modelStartResult(raced.rows[0]);
      });
    },
    async submit(tenant: TenantContext, sessionId: string, action: ModelSessionActionRequest, idempotencyKey: string) {
      return withTenantTransaction(input.pool, tenant, async (client) => {
        if (!tenant.actorId) return result("expired_session", 1, "An authenticated learner is required for this model activity.", undefined, { clientActionId: action.clientActionId });
        // Use the same enrollment-first lock order as assessment completion and credential issuance.
        const enrollment=await client.query(`SELECT e.enrollment_id FROM enrollments e JOIN simulation_sessions s ON s.organization_id=e.organization_id AND s.enrollment_id=e.enrollment_id
          WHERE s.organization_id=$1 AND s.simulation_session_id=$2 AND s.learner_id=$3 AND e.learner_id=$3 AND e.status='ACTIVE' FOR UPDATE OF e`,[tenant.organizationId,sessionId,tenant.actorId]);
        if(!enrollment.rows[0])return result("expired_session",1,"This model activity session is not available.",undefined,{clientActionId:action.clientActionId});
        const session = await client.query<{ state: unknown; next_sequence: number; expires_at: Date | string; learner_id: string; status: string; release_id: string | null; policy_id: string | null; simulation_definition_id: string }>(
          `SELECT state, next_sequence, expires_at, learner_id, status, release_id, policy_id, simulation_definition_id
           FROM simulation_sessions
           WHERE organization_id = $1 AND simulation_session_id = $2
           FOR UPDATE`,
          [tenant.organizationId, sessionId]
        );
        const row = session.rows[0];
        if(row?.learner_id===tenant.actorId&&row.status==='INVALIDATED'){
          const prior=await client.query<{payload:{request:ModelSessionActionRequest;result:ModelSessionActionResult}}>('SELECT payload FROM simulation_actions WHERE organization_id=$1 AND simulation_session_id=$2 AND nonce=$3',[tenant.organizationId,sessionId,action.clientActionId]);
          const stored=prior.rows[0]?.payload;
          if(stored?.result.status==='expired_session'&&sameModelSessionAction(stored.request,action)&&idempotencyKey===action.clientActionId)return stored.result;
        }
        if (!row || row.learner_id !== tenant.actorId || row.status !== "ACTIVE") return result("expired_session", row?.next_sequence ?? 1, "This model activity session is not available.", undefined, { clientActionId: action.clientActionId });
        if (!await sessionAccessActive(client,tenant,sessionId)) return result("expired_session",row.next_sequence,"Enrollment or attempt access is no longer active.",undefined,{clientActionId:action.clientActionId});
        const model = modelStateFrom(row.state);
        if (!model) return result("version_mismatch", row.next_sequence, "The model activity session state is invalid.", undefined, { clientActionId: action.clientActionId });
        if (new Date(row.expires_at).getTime() <= Date.now()) return result("expired_session", row.next_sequence, "This model activity session has expired.", model, { clientActionId: action.clientActionId });
        if (model.releaseBindingId !== action.releaseBindingId || model.modelVersionId !== action.modelVersionId) return result("version_mismatch", row.next_sequence, "This action does not match the approved model binding.", model, { clientActionId: action.clientActionId });
        if (idempotencyKey !== action.clientActionId) return result("invalid_precondition", row.next_sequence, "The idempotency key must match the client action ID.", model, { clientActionId: action.clientActionId });
        const activeBinding = await client.query<{ release_binding_id: string; manifest: unknown }>(
          `SELECT binding.release_binding_id, binding.manifest
           FROM release_model_bindings binding
           JOIN release_manifests release ON release.organization_id = binding.organization_id AND release.release_id = binding.release_id
           JOIN certification_policies policy ON policy.organization_id = release.organization_id AND policy.course_version_id = release.course_version_id
           WHERE binding.organization_id = $1 AND binding.release_id = $2 AND binding.release_binding_id = $3
             AND policy.policy_id = $4 AND release.status = 'PUBLISHED' AND policy.status = 'PUBLISHED'`,
          [tenant.organizationId, row.release_id, action.releaseBindingId, row.policy_id]
        );
        if (!activeBinding.rows[0]) return result("expired_session", row.next_sequence, "The release or certification policy is no longer active.", model, { clientActionId: action.clientActionId });
        if (!stateMatchesManifest(model, activeBinding.rows[0].manifest)) return result("version_mismatch", row.next_sequence, "The persisted model state no longer matches the approved model manifest.", undefined, { clientActionId: action.clientActionId });

        const duplicate = await client.query<{ payload: unknown }>(
          `SELECT payload FROM simulation_actions
           WHERE organization_id = $1 AND simulation_session_id = $2 AND nonce = $3`,
          [tenant.organizationId, sessionId, action.clientActionId]
        );
        if (duplicate.rows[0]?.payload && typeof duplicate.rows[0].payload === "object") {
          const stored = duplicate.rows[0].payload as { request?: ModelSessionActionRequest; result?: ModelSessionActionResult };
          if (stored.request && stored.result) return sameModelSessionAction(stored.request, action)
            ? stored.result
            : result("invalid_precondition", row.next_sequence, "This action ID was already used for a different action.", model, { clientActionId: action.clientActionId });
          return duplicate.rows[0].payload as ModelSessionActionResult;
        }
        if (action.expectedSequence !== row.next_sequence || action.expectedSequence !== model.nextSequence) return result("stale_sequence", row.next_sequence, "The activity state changed. Resume before trying the action again.", model, { clientActionId: action.clientActionId });
        if(model.completed) return result("invalid_precondition",row.next_sequence,"This attempt is complete. Its result cannot be changed.",model,{clientActionId:action.clientActionId});
        if (!model.simulationState || model.simulationState.nextSequence !== row.next_sequence) return result("version_mismatch", row.next_sequence, "The published simulation state is unavailable or inconsistent.", model, { clientActionId: action.clientActionId });
        const simulationState = model.simulationState;

        const modelRow = await client.query<{ manifest: unknown }>(
          `SELECT manifest FROM release_model_bindings
           WHERE organization_id = $1 AND model_version_id = $2 AND release_binding_id = $3`,
          [tenant.organizationId, action.modelVersionId, action.releaseBindingId]
        );
        if (!modelRow.rows[0]) return result("version_mismatch", row.next_sequence, "The approved model version is no longer available.", model, { clientActionId: action.clientActionId });
        const components = object(modelRow.rows[0]?.manifest)?.components;
        const componentId = action.componentId;
        const component = Array.isArray(components) ? components.map(object).find((item) => item?.componentId === componentId) : undefined;
        if ((componentId && !component) || (["select_component","activate_target","transform_component","reset_component"].includes(action.type) && !componentId)) return result("unknown_component", row.next_sequence, "That component is not part of the approved model.", model, { clientActionId: action.clientActionId });
        if (action.type === "activate_target") {
          const targets = Array.isArray(component?.interactionTargets) ? component.interactionTargets.map(object) : [];
          if (!action.targetId || !targets.some((target) => target?.targetId === action.targetId)) return result("invalid_precondition", row.next_sequence, "That interaction target is not part of the approved model component.", model, { clientActionId: action.clientActionId });
        }
        const definition = await client.query<{ definition: unknown }>(
          `SELECT definition FROM simulation_definitions
           WHERE organization_id = $1 AND simulation_definition_id = $2 AND status = 'PUBLISHED'`,
          [tenant.organizationId, row.simulation_definition_id]
        );
        const definitionValue = definition.rows[0]?.definition;
        const definitionValidation = validateSimulationDefinition(definitionValue);
        if (!definition.rows[0] || !definitionValidation.valid) return result("version_mismatch", row.next_sequence, "The published simulation definition is unavailable or invalid.", model, { clientActionId: action.clientActionId });
        const typedDefinition = definitionValue as SimulationDefinition;
        const actionDefinitionModel = typedDefinition.model;
        const actionManifest = object(modelRow.rows[0].manifest);
        const actionComponentIds = Array.isArray(actionDefinitionModel.componentIds) ? actionDefinitionModel.componentIds.slice().sort().join("|") : "";
        const boundActionComponentIds = Array.isArray(actionManifest?.components) ? actionManifest.components.map(object).flatMap((item) => typeof item?.componentId === "string" ? [item.componentId] : []).sort().join("|") : "";
        if (actionDefinitionModel.modelVersionId !== action.modelVersionId
          || actionDefinitionModel.manifestHash !== text(actionManifest?.sourceHash)
          || actionComponentIds !== boundActionComponentIds) return result("version_mismatch", row.next_sequence, "The simulation definition no longer matches the approved model binding.", model, { clientActionId: action.clientActionId });

        const next: ModelState = {
          ...model,
          sequence: row.next_sequence,
          nextSequence: row.next_sequence + 1,
          transforms: { ...model.transforms },
          scorePoints: simulationState.score,
          completed: simulationCompleted(typedDefinition, simulationState),
          ...simulationProjection(typedDefinition, simulationState),
          simulationState
        };
        let feedback = "Action accepted by the authoritative activity session.";
        if (action.type === "transform_component" || action.transform) {
          const normalized = applyPermittedTransform(component! as unknown as ModelComponentManifest, model.transforms[componentId!] ?? { rotationY: 0, translationX: 0 }, action.transform);
          if (!normalized) return result("invalid_precondition", row.next_sequence, "That transform is outside the permitted component bounds.", model, { clientActionId: action.clientActionId });
          next.transforms[componentId!] = normalized;
          next.selectedComponentId = componentId;
          feedback = "Component transform accepted.";
        } else if (action.type === "reset_component") {
          const permittedTransforms = object(component?.permittedTransforms);
          if (!permittedTransforms || (!permittedTransforms.rotationY && !permittedTransforms.translationX)) return result("invalid_precondition", row.next_sequence, "That component has no permitted reset transform.", model, { clientActionId: action.clientActionId });
          next.transforms[componentId!] = { rotationY: 0, translationX: 0 };
          next.selectedComponentId = componentId;
          feedback = "Component reset accepted.";
        } else if (action.type === "select_component") {
          next.selectedComponentId = componentId;
          feedback = "Component selected.";
        } else if(action.type === "request_hint") {
          const currentStep = simulationState.currentStepId ? typedDefinition.steps.find((step) => step.stepId === simulationState.currentStepId) : undefined;
          feedback = currentStep?.hints?.[0] ?? "Hint requested. Continue with the next permitted procedure action.";
        }
        if (action.type === "transform_component" || action.type === "reset_component" || action.transform) {
          const manifest = validateBrowserModelManifest(modelRow.rows[0].manifest);
          const violation = interactionStateViolation(manifest, next.transforms, componentId);
          if (violation) return result("invalid_precondition", row.next_sequence, violation, model, { clientActionId: action.clientActionId });
        }
        let scoreDelta = 0;
        const currentStep = simulationState.currentStepId ? typedDefinition.steps.find((step) => step.stepId === simulationState.currentStepId) : undefined;
        const activeFault=typedDefinition.faults.find(fault=>fault.faultId===simulationState.activeFaultId);
        const expectedAction=activeFault?(simulationState.faultStage==='DIAGNOSIS'?activeFault.diagnosis:activeFault.resolution):currentStep?.action;
        const advancesSimulation = action.type !== 'reset_component' && (action.type === 'select_component' || action.type === 'request_hint' ? expectedAction?.type === action.type : true);
        if (advancesSimulation) {
          const simulationActionType = action.type as SimulationAction['type'];
          const simulationAction: SimulationAction = {
            actionId: action.clientActionId,
            sequence: action.expectedSequence,
            nonce: action.clientActionId,
            type: simulationActionType,
            payload: {
              ...(componentId ? { componentId } : {}),
              ...(action.targetId!==undefined?{targetId:action.targetId}:{}),
              ...(action.value!==undefined?{value:action.value}:{}),...(action.stepId!==undefined?{stepId:action.stepId}:{}),
              ...(action.transform ? { transform: action.transform } : {})
            }
          };
          const transition = applySimulationAction(typedDefinition, simulationState, simulationAction);
          if(transition.state.invalidated){
            const terminal=result('expired_session',transition.state.nextSequence,transition.feedback,undefined,{clientActionId:action.clientActionId});
            const failedState={...model,sequence:row.next_sequence,nextSequence:transition.state.nextSequence,completed:false,allowedActions:[],simulationState:transition.state};
            await client.query("UPDATE simulation_sessions SET status='INVALIDATED',state=$3::jsonb,next_sequence=$4,updated_at=now() WHERE organization_id=$1 AND simulation_session_id=$2",[tenant.organizationId,sessionId,JSON.stringify(stateWithModel(row.state,failedState)),transition.state.nextSequence]);
            const failed=await client.query("UPDATE simulation_attempts a SET status='INVALIDATED',completed_at=now(),updated_at=now() FROM simulation_sessions s WHERE s.organization_id=$1 AND s.simulation_session_id=$2 AND a.organization_id=s.organization_id AND a.simulation_attempt_id=s.attempt_id AND a.status='ACTIVE' RETURNING a.simulation_attempt_id",[tenant.organizationId,sessionId]);
            if(failed.rowCount!==1)throw Error('SIMULATION_INVALIDATION_CONFLICT');
            await client.query(`INSERT INTO simulation_actions(simulation_action_id,organization_id,simulation_session_id,sequence,nonce,action_type,payload,created_at) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,now())`,[`model-action:${randomUUID()}`,tenant.organizationId,sessionId,action.expectedSequence,action.clientActionId,action.type,JSON.stringify({request:action,result:terminal})]);
            await client.query(`INSERT INTO audit_events(audit_event_id,organization_id,actor_id,event_type,resource_type,resource_id,details,created_at) VALUES($1,$2,$3,'SIMULATION_FAULT_INVALIDATED','simulation_attempt',$4,$5::jsonb,now())`,[`audit:${randomUUID()}`,tenant.organizationId,tenant.actorId,failed.rows[0].simulation_attempt_id,JSON.stringify({sessionId,faultId:simulationState.activeFaultId,clientActionId:action.clientActionId,reason:'Published fault failure rule'})]);
            return terminal;
          }
          if (!transition.accepted) return result("invalid_precondition", row.next_sequence, transition.feedback, model, { clientActionId: action.clientActionId });
          next.simulationState = transition.state;
          scoreDelta = transition.scoreDelta;
          next.scorePoints = transition.state.score;
          next.completed = simulationCompleted(typedDefinition, transition.state);
          Object.assign(next, simulationProjection(typedDefinition, transition.state));
          feedback = transition.feedback;
        } else {
          next.simulationState = {
            ...simulationState,
            nextSequence: simulationState.nextSequence + 1,
            acceptedActionIds: [...simulationState.acceptedActionIds, action.clientActionId],
            acceptedNonces: [...simulationState.acceptedNonces, action.clientActionId]
          };
          Object.assign(next, simulationProjection(typedDefinition, next.simulationState));
        }
        const accepted = result("accepted", next.nextSequence, feedback, next, { clientActionId: action.clientActionId, scoreDelta });
        await client.query(
          `UPDATE simulation_sessions SET state = $3::jsonb, next_sequence = $4, updated_at = CURRENT_TIMESTAMP
           WHERE organization_id = $1 AND simulation_session_id = $2`,
          [tenant.organizationId, sessionId, JSON.stringify(stateWithModel(row.state, next)), next.nextSequence]
        );
        await client.query(
          `INSERT INTO simulation_actions (simulation_action_id, organization_id, simulation_session_id, sequence, nonce, action_type, payload, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, CURRENT_TIMESTAMP)`,
          [`model-action:${randomUUID()}`, tenant.organizationId, sessionId, action.expectedSequence, action.clientActionId, action.type, JSON.stringify({ request: action, result: accepted })]
        );
        if (next.completed && !model.completed) {
          const completed=await client.query<{simulation_attempt_id:string;enrollment_id:string;activity_id:string;policy_id:string}>(`UPDATE simulation_attempts a SET status='COMPLETED',completed_at=now(),updated_at=now()
            FROM simulation_sessions s WHERE s.organization_id=$1 AND s.simulation_session_id=$2
              AND a.organization_id=s.organization_id AND a.simulation_attempt_id=s.attempt_id AND a.status='ACTIVE'
            RETURNING a.simulation_attempt_id,a.enrollment_id,a.activity_id,a.policy_id`,[tenant.organizationId,sessionId]);
          const attempt=completed.rows[0];
          if(!attempt) throw new Error("SIMULATION_COMPLETION_CONFLICT");
          const passed=next.scorePoints/typedDefinition.scoring.maxScore>=typedDefinition.scoring.passScore;
          await client.query(`INSERT INTO progress_events(progress_event_id,organization_id,enrollment_id,learner_id,event_type,payload,created_at)
            SELECT $1,$2,$3,$4,'simulation.completed',$5::jsonb || jsonb_build_object('releaseHash',r.release_hash,'policyVersion',s.policy_version),now()
            FROM simulation_sessions s JOIN release_manifests r ON r.organization_id=s.organization_id AND r.release_id=s.release_id
            WHERE s.organization_id=$2 AND s.simulation_session_id=$6`,[`progress:${attempt.simulation_attempt_id}`,tenant.organizationId,attempt.enrollment_id,tenant.actorId,JSON.stringify({
              sessionId,attemptId:attempt.simulation_attempt_id,releaseId:row.release_id,activityId:attempt.activity_id,
              simulationDefinitionId:row.simulation_definition_id,modelVersionId:model.modelVersionId,policyId:attempt.policy_id,
              score:next.scorePoints,maxScore:typedDefinition.scoring.maxScore,passed,
              completedStepIds:next.simulationState?.completedStepIds,diagnosedFaultIds:next.simulationState?.diagnosedFaultIds,resolvedFaultIds:next.simulationState?.resolvedFaultIds
            }),sessionId]);
          if(passed)await issueCredentialInTransaction(client,tenant,attempt.enrollment_id,true);
        }
        return accepted;
      });
    },

    async resume(tenant: TenantContext, sessionId: string, request) {
      return withTenantTransaction(input.pool, tenant, async (client) => {
        if (!tenant.actorId) return null;
        const session = await client.query<{ state: unknown; next_sequence: number; expires_at: Date | string; learner_id: string; status: string; release_id: string | null; policy_id: string | null; simulation_definition_id: string }>(
          `SELECT state, next_sequence, expires_at, learner_id, status, release_id, policy_id, simulation_definition_id
           FROM simulation_sessions
           WHERE organization_id = $1 AND simulation_session_id = $2`,
          [tenant.organizationId, sessionId]
        );
        const row = session.rows[0];
        if (!row || row.learner_id !== tenant.actorId) return null;
        if (!await sessionAccessActive(client,tenant,sessionId)) return result("expired_session",row.next_sequence,"Enrollment or attempt access is no longer active.");
        const model = modelStateFrom(row.state);
        if (!model || model.releaseBindingId !== request.releaseBindingId || model.modelVersionId !== request.modelVersionId) return result("version_mismatch", row.next_sequence, "The approved model binding does not match this session.");
        if (row.status !== "ACTIVE" || new Date(row.expires_at).getTime() <= Date.now()) return result("expired_session", row.next_sequence, "This model activity session has expired.", model);
        const activeBinding = await client.query<{ release_binding_id: string; manifest: unknown }>(
          `SELECT binding.release_binding_id, binding.manifest
           FROM release_model_bindings binding
           JOIN release_manifests release ON release.organization_id = binding.organization_id AND release.release_id = binding.release_id
           JOIN certification_policies policy ON policy.organization_id = release.organization_id AND policy.course_version_id = release.course_version_id
           WHERE binding.organization_id = $1 AND binding.release_id = $2 AND binding.release_binding_id = $3
             AND policy.policy_id = $4 AND release.status = 'PUBLISHED' AND policy.status = 'PUBLISHED'`,
          [tenant.organizationId, row.release_id, request.releaseBindingId, row.policy_id]
        );
        if (!activeBinding.rows[0]) return result("expired_session", row.next_sequence, "The release or certification policy is no longer active.", model);
        if (!stateMatchesManifest(model, activeBinding.rows[0].manifest)) return result("version_mismatch", row.next_sequence, "The persisted model state no longer matches the approved model manifest.");
        const definition = await client.query<{ definition: unknown }>(
          `SELECT definition FROM simulation_definitions
           WHERE organization_id = $1 AND simulation_definition_id = $2 AND status = 'PUBLISHED'`,
          [tenant.organizationId, row.simulation_definition_id]
        );
        const definitionValue = definition.rows[0]?.definition;
        const resumeDefinition = object(definitionValue);
        const resumeModel = object(resumeDefinition?.model);
        const resumeManifest = object(activeBinding.rows[0]?.manifest);
        const definitionComponentIds = Array.isArray(resumeModel?.componentIds)
          ? resumeModel.componentIds.slice().sort().join("|")
          : "";
        const boundComponentIds = Array.isArray(resumeManifest?.components)
          ? resumeManifest.components.map(object).flatMap((item) => typeof item?.componentId === "string" ? [item.componentId] : []).sort().join("|")
          : "";
        if (!definition.rows[0]
          || !activeBinding.rows[0]
          || !validateSimulationDefinition(definitionValue).valid
          || resumeModel?.modelVersionId !== request.modelVersionId
          || resumeModel.manifestHash !== text(resumeManifest?.sourceHash)
          || definitionComponentIds !== boundComponentIds
          || !model.simulationState
          || model.simulationState.nextSequence !== row.next_sequence) return result("version_mismatch", row.next_sequence, "The published simulation definition is unavailable or no longer bound to this model.", model);
        const restoredState: ModelState = {
          ...model,
          nextSequence: row.next_sequence,
          scorePoints: model.simulationState.score,
          completed: simulationCompleted(definitionValue as SimulationDefinition, model.simulationState),
          ...simulationProjection(definitionValue as SimulationDefinition, model.simulationState)
        };
        return result("accepted", row.next_sequence, "Authoritative model state restored.", restoredState);
      });
    }
  };
}
