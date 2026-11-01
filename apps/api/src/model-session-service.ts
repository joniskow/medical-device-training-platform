import type { TenantContext } from "@medical-device/contracts";

export interface ModelSessionActionRequest {
  clientActionId: string;
  releaseBindingId: string;
  modelVersionId: string;
  expectedSequence: number;
  type: "select_component" | "transform_component" | "reset_component" | "request_hint" | "open_component" | "inspect_component" | "complete_step" | "acknowledge_fault" | "diagnose_fault" | "resolve_fault";
  value?: string;
  stepId?: string;
  componentId?: string;
  source?: "CANVAS" | "COMPONENT_LIST" | "KEYBOARD";
  transform?: { rotationY?: number; translationX?: number };
}

export interface ModelSessionActionResult {
  status: "accepted" | "invalid_precondition" | "stale_sequence" | "expired_session" | "unknown_component" | "version_mismatch" | "retryable_network_failure";
  clientActionId?: string;
  nextSequence: number;
  state?: {
    releaseBindingId: string;
    modelVersionId: string;
    sequence: number;
    nextSequence: number;
    selectedComponentId?: string;
    transforms: Record<string, { rotationY: number; translationX: number }>;
    scorePoints: number;
    completed: boolean;
    activeStepId?: string;
    activeStepTitle?: string;
    activeFaultId?: string;
    activeFaultTitle?: string;
    allowedActions: string[];
  };
  feedback: string;
  scoreDelta?: number;
  retryable?: boolean;
}

export interface ModelSessionStartRequest {
  releaseId: string;
  activityId: string;
  simulationDefinitionId: string;
  modelVersionId: string;
  enrollmentId: string;
  attemptId: string;
  policyId: string;
  expiresInSeconds?: number;
}

export interface ModelSessionStartResult {
  sessionId: string;
  releaseId: string;
  activityId: string;
  simulationDefinitionId: string;
  enrollmentId: string;
  attemptId: string;
  policyId: string;
  policyVersion: number;
  releaseBindingId: string;
  modelVersionId: string;
  expiresAt: string;
  nextSequence: number;
  allowedActions: string[];
  state: NonNullable<ModelSessionActionResult["state"]>;
}

export interface ModelSessionService {
  start(tenant: TenantContext, request: ModelSessionStartRequest, idempotencyKey: string): Promise<ModelSessionStartResult>;
  submit(tenant: TenantContext, sessionId: string, action: ModelSessionActionRequest, idempotencyKey: string): Promise<ModelSessionActionResult>;
  resume(tenant: TenantContext, sessionId: string, input: { releaseBindingId: string; modelVersionId: string; nextSequence: number }): Promise<ModelSessionActionResult | null>;
}
