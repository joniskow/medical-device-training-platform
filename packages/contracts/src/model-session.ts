/** Public learner API contracts. Browser consumers must preserve release bindings and sequence numbers. */
export interface ModelInteractionOption {
  componentId: string;
  targetId: string;
  label: string;
  type: 'activate_target' | 'transform_component';
  transform?: { rotationY?: number; translationX?: number };
  enabled: boolean;
  blockedReason?: string;
}

export interface ModelSessionDebrief {
  sessionId: string;
  releaseId: string;
  modelVersionId: string;
  status: 'ACTIVE' | 'COMPLETED' | 'EXPIRED' | 'INVALIDATED';
  completed: boolean;
  scorePoints: number;
  steps: Array<{ stepId: string; title: string; completed: boolean; explanation: string }>;
  events: Array<{
    actionId: string;
    sequence: number;
    occurredAt: string;
    type: string;
    componentId?: string;
    targetId?: string;
    stepId?: string;
    outcome: 'accepted' | 'rejected' | 'invalidated';
    feedback: string;
  }>;
  hintsUsed: number;
  rejectedAttempts: number;
  /** True when the bounded event history is incomplete. Counts always cover the full history. */
  eventsTruncated: boolean;
}
