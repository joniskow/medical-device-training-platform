export type RuntimeBudget = { minimumFps: number; interactiveWithinMs: number; maxMemoryMb: number };
export type StableRuntimePhase = "READY" | "REDUCED_COMPLEXITY";

export function phaseAfterContextRestore(previousPhase: StableRuntimePhase, loadDurationMs: number, measuredFps: number | undefined, budget: RuntimeBudget): StableRuntimePhase {
  if (previousPhase === "REDUCED_COMPLEXITY") return "REDUCED_COMPLEXITY";
  if (loadDurationMs > budget.interactiveWithinMs || (measuredFps !== undefined && measuredFps < budget.minimumFps)) return "REDUCED_COMPLEXITY";
  return "READY";
}
