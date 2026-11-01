export type SemanticActionType =
  | "select_component"
  | "transform_component"
  | "open_component"
  | "inspect_component"
  | "complete_step"
  | "acknowledge_fault"
  | "diagnose_fault"
  | "resolve_fault"
  | "request_hint";

export { evaluateCertification, validCertificationPolicy, type CertificationPolicy, type PolicyActivity, type PolicyEvidence } from "./certification.js";
export {previewSimulationPaths,type SimulationPathReport,type SimulationPathCase} from './path-preview.js';

export interface SimulationActionRequirement {
  type: SemanticActionType;
  componentId?: string;
  value?: string;
  stepId?: string;
  transform?: { rotationY?: number; translationX?: number };
}

export interface SimulationComponentDefinition {
  componentId: string;
  initialState: string;
  allowedActions: SemanticActionType[];
  interactionVolume?: { shape: "box" | "sphere"; size: [number, number, number] };
}

export interface SimulationStepDefinition {
  setVariables?: Record<string, string | number | boolean>;
  stepId: string;
  title: string;
  action: SimulationActionRequirement;
  nextStepIds: string[];
  points: number;
  preconditions?: Array<{ variable: string; equals: string | number | boolean }>;
  hints?: string[];
  triggerFaultId?: string;
}

export interface SimulationFaultDefinition {
  setVariables?: Record<string, string | number | boolean>;
  faultId: string;
  title: string;
  triggerStepId: string;
  diagnosis: SimulationActionRequirement;
  resolution: SimulationActionRequirement;
  points: number;
  failureRule: "REJECT_AND_REMAIN" | "INVALIDATE_SESSION";
}

export interface SimulationDefinition {
  schemaVersion: "simulation-definition.v1";
  simulationDefinitionId: string;
  version: number;
  model: { modelVersionId: string; manifestHash: string; componentIds: string[] };
  components: SimulationComponentDefinition[];
  initialState: {
    currentStepId: string;
    variables: Record<string, string | number | boolean>;
    componentStates: Record<string, string>;
  };
  steps: SimulationStepDefinition[];
  faults: SimulationFaultDefinition[];
  scoring: {
    maxScore: number;
    passScore: number;
    stepPoints: Record<string, number>;
    faultPoints: Record<string, number>;
    penalties: Record<string, number>;
  };
  completion: { requiredStepIds: string[]; requiredFaultIds: string[]; terminalStepIds: string[] };
  equivalentPath: {
    mode: "TEXT_KEYBOARD";
    instructions: Array<{ stepId: string; text: string }>;
    faultInstructions: Array<{ faultId: string; text: string }>;
  };
}

export interface SimulationValidationFinding {
  code: string;
  severity: "error" | "warning" | "info";
  path: string;
  message: string;
}

export interface SimulationValidationReport {
  valid: boolean;
  findings: SimulationValidationFinding[];
}

export interface SimulationState {
  invalidated?: boolean;
  currentStepId?: string;
  variables: Record<string, string | number | boolean>;
  componentStates: Record<string, string>;
  activeFaultId?: string;
  faultStage?: "DIAGNOSIS" | "RESOLUTION";
  completedStepIds: string[];
  resolvedFaultIds: string[];
  diagnosedFaultIds?: string[];
  score: number;
  nextSequence: number;
  acceptedActionIds: string[];
  acceptedNonces: string[];
}

export interface SimulationAction {
  actionId: string;
  sequence: number;
  nonce: string;
  type: SemanticActionType;
  payload: Record<string, unknown>;
}

export interface SimulationTraceEntry {
  actionId: string;
  sequence: number;
  accepted: boolean;
  scoreDelta: number;
  code?: string;
}

export interface SimulationTransition {
  accepted: boolean;
  state: SimulationState;
  scoreDelta: number;
  feedback: string;
  failure?: { class: "VALIDATION"; code: string; message: string };
}

export interface SimulationReplay {
  state: SimulationState;
  trace: SimulationTraceEntry[];
  completed: boolean;
  passed: boolean;
  score: number;
}

export interface PublicationValidationInput {
  course: unknown;
  approvedSourceArtifactIds: readonly string[];
  approvedMediaAssets?: readonly import('./media.js').ApprovedMediaAsset[];
  approvedReviewTargets?: readonly string[];
  aiWarnings?: readonly { code: string; severity: "info" | "warning" | "error"; message?: string }[];
}

export interface PublicationValidationReport {
  valid: boolean;
  findings: SimulationValidationFinding[];
}

export class CoursePublicationValidationError extends Error {
  readonly code = "COURSE_PUBLICATION_BLOCKED";
  readonly findings: SimulationValidationFinding[];

  constructor(findings: SimulationValidationFinding[]) {
    super("COURSE_PUBLICATION_BLOCKED");
    this.name = "CoursePublicationValidationError";
    this.findings = findings;
  }
}

type JsonRecord = Record<string, unknown>;

const supportedActivityTypes = new Set([
  "rich_text", "image", "video", "3d_viewer", "hotspot", "guided_procedure",
  "manipulation", "assembly", "fault_troubleshooting", "simulation",
  "multiple_choice", "multi_select", "ordered_step", "simulation_outcome"
]);

export function isSupportedCourseActivityType(value: unknown): value is string {
  return typeof value === "string" && supportedActivityTypes.has(value);
}

const forbiddenKey = /^(script|javascript|code|eval|sql|query)$/i;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function number(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function finding(findings: SimulationValidationFinding[], code: string, path: string, message: string, severity: SimulationValidationFinding["severity"] = "error"): void {
  findings.push({ code, severity, path, message });
}

function walkForForbiddenKeys(value: unknown, path: string, findings: SimulationValidationFinding[], seen = new WeakSet<object>()): void {
  if (!value || typeof value !== "object") return;
  if (seen.has(value)) {
    finding(findings, "CIRCULAR_CONFIGURATION", path, "Configuration must be JSON-serializable.");
    return;
  }
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkForForbiddenKeys(item, `${path}[${index}]`, findings, seen));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (forbiddenKey.test(key)) finding(findings, "ARBITRARY_EXECUTION_FORBIDDEN", childPath, "Executable code, queries, and scripts are not allowed in a simulation definition.");
    walkForForbiddenKeys(child, childPath, findings, seen);
  }
}

function actionValid(action: unknown, path: string, modelComponents: Set<string>, findings: SimulationValidationFinding[]): action is SimulationActionRequirement {
  if (!isRecord(action)) {
    finding(findings, "ACTION_INVALID", path, "An action requirement must be an object.");
    return false;
  }
  if (!text(action.type) || !["select_component", "transform_component", "open_component", "inspect_component", "complete_step", "acknowledge_fault", "diagnose_fault", "resolve_fault", "request_hint"].includes(action.type)) {
    finding(findings, "ACTION_TYPE_INVALID", `${path}.type`, "The action type is not supported.");
  }
  if (action.componentId !== undefined && (!text(action.componentId) || action.componentId.length>200 || !modelComponents.has(action.componentId))) {
    finding(findings, "MODEL_COMPONENT_UNKNOWN", `${path}.componentId`, "The action references a component that is not in the bound model manifest.");
  }
  if (action.value !== undefined && (!text(action.value)||action.value.length>2000)) finding(findings, "ACTION_VALUE_INVALID", `${path}.value`, "Action values must be non-empty strings of at most 2000 characters.");
  if (action.stepId !== undefined && (!text(action.stepId)||action.stepId.length>2000)) finding(findings, "ACTION_STEP_INVALID", `${path}.stepId`, "Action step references must be non-empty strings of at most 2000 characters.");
  if((['select_component','transform_component'].includes(String(action.type))||action.transform!==undefined)&&!text(action.componentId))finding(findings,'ACTION_COMPONENT_REQUIRED',`${path}.componentId`,'Selection and transform actions require a component.');
  if(action.type==='transform_component'&&(!isRecord(action.transform)||Object.keys(action.transform).length===0))finding(findings,'ACTION_TRANSFORM_REQUIRED',`${path}.transform`,'Transform actions require at least one transform value.');
  if (action.transform !== undefined && (!isRecord(action.transform) || Object.keys(action.transform).length===0 || Object.entries(action.transform).some(([key, value]) => !["rotationY", "translationX"].includes(key) || !number(value)))) finding(findings, "ACTION_TRANSFORM_INVALID", `${path}.transform`, "Action transforms must contain only finite rotationY or translationX numbers.");
  return true;
}

function asSimulationDefinition(value: unknown): SimulationDefinition | null {
  return isRecord(value) && value.schemaVersion === "simulation-definition.v1" ? value as unknown as SimulationDefinition : null;
}

export function validateSimulationDefinition(value: unknown): SimulationValidationReport {
  const findings: SimulationValidationFinding[] = [];
  walkForForbiddenKeys(value, "simulation", findings);
  const definition = asSimulationDefinition(value);
  if (!definition) {
    finding(findings, "SCHEMA_VERSION_INVALID", "simulation.schemaVersion", "The simulation must use simulation-definition.v1.");
    return { valid: false, findings };
  }

  if (!text(definition.simulationDefinitionId)) finding(findings, "ID_REQUIRED", "simulation.simulationDefinitionId", "A simulation definition ID is required.");
  if (!Number.isInteger(definition.version) || definition.version < 1) finding(findings, "VERSION_INVALID", "simulation.version", "Simulation versions must be positive integers.");
  if (!text(definition.model?.modelVersionId) || !text(definition.model?.manifestHash)) finding(findings, "MODEL_BINDING_REQUIRED", "simulation.model", "A simulation must bind to a model version and manifest hash.");

  const modelComponents = new Set<string>();
  if (!Array.isArray(definition.model?.componentIds) || definition.model.componentIds.length === 0) finding(findings, "MODEL_COMPONENTS_REQUIRED", "simulation.model.componentIds", "A simulation must bind to at least one stable model component.");
  else for (const componentId of definition.model.componentIds) {
    if (!text(componentId)) finding(findings, "MODEL_COMPONENT_ID_INVALID", "simulation.model.componentIds", "Model component IDs must be non-empty strings.");
    else if (modelComponents.has(componentId)) finding(findings, "MODEL_COMPONENT_DUPLICATE", "simulation.model.componentIds", `Model component ${componentId} is listed more than once.`);
    else modelComponents.add(componentId);
  }

  const componentIds = new Set<string>();
  for (const [index, component] of (Array.isArray(definition.components) ? definition.components : []).entries()) {
    const path = `simulation.components[${index}]`;
    if (!isRecord(component) || !text(component.componentId)) {
      finding(findings, "COMPONENT_INVALID", path, "Each simulation component needs a componentId.");
      continue;
    }
    if (!modelComponents.has(component.componentId)) finding(findings, "MODEL_COMPONENT_UNKNOWN", `${path}.componentId`, "The simulation component is not in the bound model manifest.");
    if (componentIds.has(component.componentId)) finding(findings, "COMPONENT_DUPLICATE", `${path}.componentId`, `Simulation component ${component.componentId} is duplicated.`);
    else componentIds.add(component.componentId);
    if (!text(component.initialState)) finding(findings, "COMPONENT_STATE_REQUIRED", `${path}.initialState`, "Each component needs an initial state.");
    if (!Array.isArray(component.allowedActions) || component.allowedActions.length === 0) finding(findings, "COMPONENT_ACTIONS_REQUIRED", `${path}.allowedActions`, "Each component needs at least one allowed semantic action.");
    for (const action of component.allowedActions ?? []) if (!text(action)) finding(findings, "ACTION_TYPE_INVALID", `${path}.allowedActions`, "Allowed actions must be strings.");
    const volume = component.interactionVolume;
    if (volume !== undefined && (!isRecord(volume) || !["box", "sphere"].includes(String(volume.shape)) || !Array.isArray(volume.size) || volume.size.length !== 3 || volume.size.some((item) => !number(item) || item <= 0))) {
      finding(findings, "INTERACTION_VOLUME_INVALID", `${path}.interactionVolume`, "Interaction volumes must use positive box or sphere dimensions.");
    }
  }
  for (const componentId of modelComponents) if (!componentIds.has(componentId)) finding(findings, "COMPONENT_DEFINITION_MISSING", "simulation.components", `Bound model component ${componentId} has no simulation definition.`);

  const steps = Array.isArray(definition.steps) ? definition.steps : [];
  const variables=definition.initialState?.variables;
  const scalar=(v:unknown):v is string|number|boolean=>typeof v==='string'||typeof v==='boolean'||number(v);
  const variableName=(v:string)=>/^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/.test(v)&&!['__proto__','constructor','prototype'].includes(v);
  if(!isRecord(variables)||Object.entries(variables).some(([key,value])=>!variableName(key)||!scalar(value)))finding(findings,'VARIABLES_INVALID','simulation.initialState.variables','Variables need safe names and finite number, string or boolean values.');
  const assignmentValid=(key:string,value:unknown)=>isRecord(variables)&&Object.hasOwn(variables,key)&&scalar(value)&&typeof value===typeof variables[key];
  function validateEffects(value:unknown,path:string){
    if(value!==undefined&&(!isRecord(value)||Object.entries(value).some(([key,v])=>!assignmentValid(key,v))))finding(findings,'VARIABLE_EFFECT_INVALID',path,'Effects must assign declared variables without changing their types.');
  }
  const stepIds = new Set<string>();
  const stepById = new Map<string, SimulationStepDefinition>();
  for (const [index, step] of steps.entries()) {
    const path = `simulation.steps[${index}]`;
    if (!isRecord(step) || !text(step.stepId)) {
      finding(findings, "STEP_INVALID", path, "Each step needs a stepId.");
      continue;
    }
    if (stepIds.has(step.stepId)) finding(findings, "STEP_DUPLICATE", `${path}.stepId`, `Step ${step.stepId} is duplicated.`);
    else { stepIds.add(step.stepId); stepById.set(step.stepId, step as unknown as SimulationStepDefinition); }
    if (!text(step.title)) finding(findings, "STEP_TITLE_REQUIRED", `${path}.title`, "Each step needs a learner-visible title.");
    actionValid(step.action, `${path}.action`, modelComponents, findings);
    if (!Array.isArray(step.nextStepIds)) finding(findings, "STEP_TRANSITIONS_REQUIRED", `${path}.nextStepIds`, "Each step must declare bounded next-step transitions, including an empty terminal list.");
    else for (const nextStepId of step.nextStepIds) if (!text(nextStepId)) finding(findings, "STEP_TRANSITION_INVALID", `${path}.nextStepIds`, "Step transitions must be non-empty step IDs.");
    if (!number(step.points) || step.points < 0) finding(findings, "STEP_POINTS_INVALID", `${path}.points`, "Step points must be non-negative numbers.");
    if(step.preconditions!==undefined&&(!Array.isArray(step.preconditions)||step.preconditions.some(p=>!isRecord(p)||!text(p.variable)||!assignmentValid(p.variable,p.equals))))finding(findings,'PRECONDITION_INVALID',`${path}.preconditions`,'Preconditions must compare declared variables with values of the same type.');
    validateEffects(step.setVariables,`${path}.setVariables`);
    for (const hint of step.hints ?? []) if (!text(hint)) finding(findings, "HINT_INVALID", `${path}.hints`, "Hints must be non-empty text.");
  }
  if (stepIds.size === 0) finding(findings, "STEPS_REQUIRED", "simulation.steps", "A simulation needs at least one procedure step.");
  if (!isRecord(definition.initialState) || !text(definition.initialState.currentStepId)) finding(findings, "INITIAL_STATE_INVALID", "simulation.initialState.currentStepId", "The initial state must name a starting step.");
  else if (!stepIds.has(definition.initialState.currentStepId)) finding(findings, "STEP_UNKNOWN", "simulation.initialState.currentStepId", "The initial state references an unknown step.");
  for (const componentId of Object.keys(definition.initialState?.componentStates ?? {})) if (!modelComponents.has(componentId)) finding(findings, "MODEL_COMPONENT_UNKNOWN", `simulation.initialState.componentStates.${componentId}`, "Initial state references an unknown model component.");

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (stepId: string): void => {
    if (visiting.has(stepId)) {
      finding(findings, "GRAPH_CYCLE", `simulation.steps.${stepId}`, "Simulation paths must be bounded and cannot contain cycles.");
      return;
    }
    if (visited.has(stepId)) return;
    const step = stepById.get(stepId);
    if (!step) return;
    visiting.add(stepId);
    for (const nextStepId of (Array.isArray(step.nextStepIds) ? step.nextStepIds : [])) {
      if (!stepIds.has(nextStepId)) finding(findings, "STEP_UNKNOWN", `simulation.steps.${stepId}.nextStepIds`, `Step transition points to unknown step ${nextStepId}.`);
      else visit(nextStepId);
    }
    visiting.delete(stepId);
    visited.add(stepId);
  };
  if (text(definition.initialState?.currentStepId)) visit(definition.initialState.currentStepId);
  for (const stepId of stepIds) if (!visited.has(stepId)) finding(findings, "STEP_UNREACHABLE", `simulation.steps.${stepId}`, `Step ${stepId} cannot be reached from the initial state.`);
  for(const step of stepById.values()){
    if(!Array.isArray(step.nextStepIds)) continue;
    if(new Set(step.nextStepIds).size!==step.nextStepIds.length)finding(findings,'BRANCH_DUPLICATE',`simulation.steps.${step.stepId}`,'Successor steps must be unique.');
    if(step.nextStepIds.length>1){
      const targets=step.nextStepIds.map(id=>stepById.get(id));
      for(let i=0;i<targets.length;i++)for(let j=i+1;j<targets.length;j++){
        const a=targets[i]?.preconditions,b=targets[j]?.preconditions;
        if(!Array.isArray(a)||!Array.isArray(b)||!a.some(x=>isRecord(x)&&b.some(y=>isRecord(y)&&x.variable===y.variable&&x.equals!==y.equals)))finding(findings,'BRANCH_AMBIGUOUS',`simulation.steps.${step.stepId}.nextStepIds`,'Each pair of branch destinations must have mutually exclusive variable preconditions.');
      }
    }
  }

  const faultIds = new Set<string>();
  const faultById = new Map<string, SimulationFaultDefinition>();
  for (const [index, fault] of (Array.isArray(definition.faults) ? definition.faults : []).entries()) {
    const path = `simulation.faults[${index}]`;
    if (!isRecord(fault) || !text(fault.faultId)) {
      finding(findings, "FAULT_INVALID", path, "Each fault needs a faultId.");
      continue;
    }
    if (faultIds.has(fault.faultId)) finding(findings, "FAULT_DUPLICATE", `${path}.faultId`, `Fault ${fault.faultId} is duplicated.`);
    else { faultIds.add(fault.faultId); faultById.set(fault.faultId, fault as unknown as SimulationFaultDefinition); }
    if (!stepIds.has(fault.triggerStepId)) finding(findings, "STEP_UNKNOWN", `${path}.triggerStepId`, "Fault trigger step is unknown.");
    actionValid(fault.diagnosis, `${path}.diagnosis`, modelComponents, findings);
    actionValid(fault.resolution, `${path}.resolution`, modelComponents, findings);
    if (!number(fault.points) || fault.points < 0) finding(findings, "FAULT_POINTS_INVALID", `${path}.points`, "Fault points must be non-negative numbers.");
    if (!["REJECT_AND_REMAIN", "INVALIDATE_SESSION"].includes(fault.failureRule)) finding(findings, "FAILURE_RULE_INVALID", `${path}.failureRule`, "Faults need an explicit safe failure rule.");
    validateEffects(fault.setVariables,`${path}.setVariables`);
  }
  for (const step of stepById.values()) if (step.triggerFaultId && !faultIds.has(step.triggerFaultId)) finding(findings, "FAULT_UNKNOWN", `simulation.steps.${step.stepId}.triggerFaultId`, "Step references an unknown fault.");

  const scoring = definition.scoring;
  if (!isRecord(scoring) || !number(scoring.maxScore) || scoring.maxScore <= 0 || !number(scoring.passScore) || scoring.passScore < 0 || scoring.passScore > 1) finding(findings, "SCORING_INVALID", "simulation.scoring", "Scoring needs a positive maxScore and a passScore between 0 and 1.");
  for (const [stepId, points] of Object.entries(scoring?.stepPoints ?? {})) if (!stepIds.has(stepId) || !number(points) || points < 0) finding(findings, "SCORING_REFERENCE_INVALID", `simulation.scoring.stepPoints.${stepId}`, "Step scoring must reference a known step with non-negative points.");
  for (const [faultId, points] of Object.entries(scoring?.faultPoints ?? {})) if (!faultIds.has(faultId) || !number(points) || points < 0) finding(findings, "SCORING_REFERENCE_INVALID", `simulation.scoring.faultPoints.${faultId}`, "Fault scoring must reference a known fault with non-negative points.");

  const completion = definition.completion;
  if (!isRecord(completion) || !Array.isArray(completion.requiredStepIds) || !Array.isArray(completion.requiredFaultIds) || !Array.isArray(completion.terminalStepIds)) finding(findings, "COMPLETION_INVALID", "simulation.completion", "Completion must name required steps, faults, and terminal steps.");
  else {
    for (const stepId of completion.requiredStepIds) if (!stepIds.has(stepId)) finding(findings, "STEP_UNKNOWN", "simulation.completion.requiredStepIds", `Required step ${stepId} is unknown.`);
    for (const faultId of completion.requiredFaultIds) if (!faultIds.has(faultId)) finding(findings, "FAULT_UNKNOWN", "simulation.completion.requiredFaultIds", `Required fault ${faultId} is unknown.`);
    for (const terminalStepId of completion.terminalStepIds) {
      const step = stepById.get(terminalStepId);
      if (!step) finding(findings, "STEP_UNKNOWN", "simulation.completion.terminalStepIds", `Terminal step ${terminalStepId} is unknown.`);
      else if (Array.isArray(step.nextStepIds) && step.nextStepIds.length > 0) finding(findings, "TERMINAL_STEP_HAS_TRANSITION", `simulation.completion.terminalStepIds.${terminalStepId}`, "Terminal steps cannot have outgoing transitions.");
    }
  }

  const equivalent = definition.equivalentPath;
  if (!isRecord(equivalent) || equivalent.mode !== "TEXT_KEYBOARD" || !Array.isArray(equivalent.instructions) || !Array.isArray(equivalent.faultInstructions)) finding(findings, "EQUIVALENT_PATH_REQUIRED", "simulation.equivalentPath", "A text/keyboard equivalent path is required.");
  else {
    const equivalentSteps = new Set(equivalent.instructions.map((item) => isRecord(item) ? item.stepId : undefined));
    for (const stepId of stepIds) if (!equivalentSteps.has(stepId)) finding(findings, "EQUIVALENT_STEP_MISSING", "simulation.equivalentPath.instructions", `Equivalent path is missing required step ${stepId}.`);
    for (const instruction of equivalent.instructions) if (!isRecord(instruction) || !text(instruction.stepId) || !text(instruction.text)) finding(findings, "EQUIVALENT_INSTRUCTION_INVALID", "simulation.equivalentPath.instructions", "Equivalent instructions need a step ID and text.");
    const equivalentFaults = new Set(equivalent.faultInstructions.map((item) => isRecord(item) ? item.faultId : undefined));
    for (const faultId of faultIds) if (!equivalentFaults.has(faultId)) finding(findings, "EQUIVALENT_FAULT_MISSING", "simulation.equivalentPath.faultInstructions", `Equivalent path is missing required fault ${faultId}.`);
    for (const instruction of equivalent.faultInstructions) if (!isRecord(instruction) || !text(instruction.faultId) || !faultIds.has(instruction.faultId) || !text(instruction.text)) finding(findings, "EQUIVALENT_FAULT_INSTRUCTION_INVALID", "simulation.equivalentPath.faultInstructions", "Equivalent fault instructions need a known fault ID and non-empty text.");
  }

  return { valid: findings.every((item) => item.severity !== "error"), findings };
}

export function createInitialSimulationState(definition: SimulationDefinition): SimulationState {
  return {
    currentStepId: definition.initialState.currentStepId,
    variables: { ...definition.initialState.variables },
    componentStates: { ...definition.initialState.componentStates },
    completedStepIds: [],
    resolvedFaultIds: [],
    diagnosedFaultIds: [],
    score: 0,
    nextSequence: 1,
    acceptedActionIds: [],
    acceptedNonces: []
  };
}

function actionMatches(expected: SimulationActionRequirement, action: SimulationAction): boolean {
  if (expected.type !== action.type) return false;
  for (const key of ["componentId", "value", "stepId"] as const) {
    if (expected[key] !== undefined && action.payload[key] !== expected[key]) return false;
  }
  if (expected.transform !== undefined) {
    const actual = action.payload.transform;
    if (!isRecord(actual)) return false;
    for (const key of ["rotationY", "translationX"] as const) if (expected.transform[key] !== undefined && actual[key] !== expected.transform[key]) return false;
  }
  return true;
}

function rejected(state: SimulationState, code: string, message: string): SimulationTransition {
  return { accepted: false, state, scoreDelta: 0, feedback: message, failure: { class: "VALIDATION", code, message } };
}

function successor(definition:SimulationDefinition,step:SimulationStepDefinition|undefined,state:SimulationState):{id?:string;blocked?:boolean}{
  if(!step||step.nextStepIds.length<2)return {id:step?.nextStepIds[0]};
  const matches=step.nextStepIds.filter(id=>definition.steps.find(s=>s.stepId===id)?.preconditions?.every(p=>state.variables[p.variable]===p.equals));
  return matches.length===1?{id:matches[0]}:{blocked:true};
}

function actionFailure(state: SimulationState, action: SimulationAction, expected: SimulationActionRequirement | undefined): SimulationTransition {
  if(!isRecord(action.payload)||!['select_component','transform_component','open_component','inspect_component','complete_step','acknowledge_fault','diagnose_fault','resolve_fault','request_hint'].includes(action.type))return rejected(state,'ACTION_INVALID','The semantic action is invalid.');
  if (!text(action.actionId) || !text(action.nonce) || !Number.isInteger(action.sequence) || action.sequence < 1) return rejected(state, "ACTION_INVALID", "The action envelope is invalid.");
  if (state.acceptedActionIds.includes(action.actionId) || state.acceptedNonces.includes(action.nonce)) return rejected(state, "ACTION_REPLAYED", "The action has already been accepted.");
  if (action.sequence !== state.nextSequence) return rejected(state, "ACTION_SEQUENCE_INVALID", "The action sequence is stale or out of order.");
  if (!expected || !actionMatches(expected, action)) return rejected(state, "ACTION_NOT_ALLOWED", "The action is not allowed in the current simulation state.");
  return { accepted: true, state, scoreDelta: 0, feedback: "Action accepted." };
}

export function applySimulationAction(definition: SimulationDefinition, inputState: SimulationState, action: SimulationAction): SimulationTransition {
  if(inputState.invalidated)return rejected(inputState,'SESSION_INVALIDATED','This attempt was invalidated by the published fault rule.');
  const validation = validateSimulationDefinition(definition);
  if (!validation.valid) return rejected(inputState, "SIMULATION_INVALID", "The simulation definition is not valid for execution.");
  const state: SimulationState = {
    ...inputState,
    variables: { ...inputState.variables },
    componentStates: { ...inputState.componentStates },
    completedStepIds: [...inputState.completedStepIds],
    resolvedFaultIds: [...inputState.resolvedFaultIds],
    diagnosedFaultIds: [...(inputState.diagnosedFaultIds??[...inputState.resolvedFaultIds,...(inputState.activeFaultId&&inputState.faultStage==='RESOLUTION'?[inputState.activeFaultId]:[])])],
    acceptedActionIds: [...inputState.acceptedActionIds],
    acceptedNonces: [...inputState.acceptedNonces]
  };
  const step = state.currentStepId ? definition.steps.find((item) => item.stepId === state.currentStepId) : undefined;
  const fault = state.activeFaultId ? definition.faults.find((item) => item.faultId === state.activeFaultId) : undefined;
  const expected = fault ? (state.faultStage === "DIAGNOSIS" ? fault.diagnosis : fault.resolution) : step?.action;
  const checked = actionFailure(state, action, expected);
  if (!checked.accepted || !expected) {
    if(fault?.failureRule==='INVALIDATE_SESSION'&&checked.failure?.code==='ACTION_NOT_ALLOWED'){
      return rejected({...state,invalidated:true,nextSequence:state.nextSequence+1},'FAULT_SESSION_INVALIDATED','The action did not satisfy the published fault rule. This attempt is invalidated; return to your course for retry guidance.');
    }
    return checked;
  }

  state.acceptedActionIds.push(action.actionId);
  state.acceptedNonces.push(action.nonce);
  state.nextSequence += 1;
  let scoreDelta = 0;
  if (fault) {
    if (state.faultStage === "DIAGNOSIS") {
      if(!state.diagnosedFaultIds!.includes(fault.faultId))state.diagnosedFaultIds!.push(fault.faultId);
      state.faultStage = "RESOLUTION";
      return { accepted: true, state, scoreDelta: 0, feedback: "Fault diagnosed. Resolve the fault." };
    }
    scoreDelta = definition.scoring.faultPoints[fault.faultId] ?? fault.points;
    state.score += scoreDelta;
    state.resolvedFaultIds.push(fault.faultId);
    state.activeFaultId = undefined;
    state.faultStage = undefined;
    const trigger = definition.steps.find((item) => item.stepId === fault.triggerStepId);
    Object.assign(state.variables,fault.setVariables);
    const next=successor(definition,trigger,state);
    if(next.blocked)return rejected(inputState,'BRANCH_NOT_RESOLVED','Exactly one branch must match the current variables.');
    state.currentStepId = next.id;
    return { accepted: true, state, scoreDelta, feedback: "Fault resolved." };
  }

  if (!step) return rejected(inputState, "SIMULATION_COMPLETE", "The simulation has already reached a terminal state.");
  for (const precondition of step.preconditions ?? []) if (state.variables[precondition.variable] !== precondition.equals) return rejected(inputState, "PRECONDITION_NOT_MET", "The current procedure preconditions are not met.");
  Object.assign(state.variables,step.setVariables);
  scoreDelta = definition.scoring.stepPoints[step.stepId] ?? step.points;
  state.score += scoreDelta;
  if (!state.completedStepIds.includes(step.stepId)) state.completedStepIds.push(step.stepId);
  if (step.triggerFaultId) {
    state.activeFaultId = step.triggerFaultId;
    state.faultStage = "DIAGNOSIS";
  } else {
    const next=successor(definition,step,state);
    if(next.blocked)return rejected(inputState,'BRANCH_NOT_RESOLVED','Exactly one branch must match the current variables.');
    state.currentStepId = next.id;
  }
  return { accepted: true, state, scoreDelta, feedback: "Action accepted." };
}

export function replaySimulation(definition: SimulationDefinition, actions: readonly SimulationAction[]): SimulationReplay {
  let state = createInitialSimulationState(definition);
  const trace: SimulationTraceEntry[] = [];
  for (const action of actions) {
    const transition = applySimulationAction(definition, state, action);
    trace.push({ actionId: action.actionId, sequence: action.sequence, accepted: transition.accepted, scoreDelta: transition.scoreDelta, ...(transition.failure ? { code: transition.failure.code } : {}) });
    state = transition.state;
  }
  const completed = !state.invalidated && state.currentStepId === undefined && state.activeFaultId === undefined
    && definition.completion.requiredStepIds.every((stepId) => state.completedStepIds.includes(stepId))
    && definition.completion.requiredFaultIds.every((faultId) => state.resolvedFaultIds.includes(faultId));
  return { state, trace, completed, passed: completed && state.score / definition.scoring.maxScore >= definition.scoring.passScore, score: state.score };
}

function validateModelManifest(value: unknown, path: string, findings: SimulationValidationFinding[]): Set<string> {
  const ids = new Set<string>();
  if (!isRecord(value) || value.schemaVersion !== "model-manifest.v1" || value.format !== "glb") {
    finding(findings, "MODEL_MANIFEST_INVALID", path, "An approved model-manifest.v1 GLB manifest is required.");
    return ids;
  }
  if (value.normalizationStatus !== "CANONICAL") finding(findings, "MODEL_NOT_CANONICAL", `${path}.normalizationStatus`, "The model must be normalized before publication.");
  if (!Array.isArray(value.components) || value.components.length === 0) finding(findings, "MODEL_COMPONENTS_REQUIRED", `${path}.components`, "The model manifest must expose stable components.");
  for (const [index, component] of (Array.isArray(value.components) ? value.components : []).entries()) {
    if (!isRecord(component) || !text(component.componentId)) finding(findings, "MODEL_COMPONENT_INVALID", `${path}.components[${index}]`, "Each model component needs a stable componentId.");
    else if (ids.has(component.componentId)) finding(findings, "MODEL_COMPONENT_DUPLICATE", `${path}.components[${index}].componentId`, `Model component ${component.componentId} is duplicated.`);
    else ids.add(component.componentId);
  }
  return ids;
}

export function validateCourseForPublication(input: PublicationValidationInput): PublicationValidationReport {
  const findings: SimulationValidationFinding[] = [];
  walkForForbiddenKeys(input.course, "course", findings);
  const course = isRecord(input.course) ? input.course : {};
  if((course._lineage!==undefined||course.releaseChange!==undefined)&&!validReleaseChange(course.releaseChange,Array.isArray(course.modules)?course.modules:[]))finding(findings,'RELEASE_CHANGE_REQUIRED','course.releaseChange','Classify the changes, document the issuer requalification decision, effective date and learner message, and select valid scored update modules where applicable.');
  if (course.schemaVersion !== "course-draft.v1") finding(findings, "COURSE_SCHEMA_INVALID", "course.schemaVersion", "The course must use course-draft.v1.");
  if (!text(course.title)) finding(findings, "COURSE_TITLE_REQUIRED", "course.title", "A course title is required.");
  const approvedSources = new Set(input.approvedSourceArtifactIds);
  const citations = Array.isArray(course.citations) ? course.citations : [];
  if (citations.length === 0) finding(findings, "CITATION_REQUIRED", "course.citations", "Every publishable course needs at least one source citation.");
  for (const [index, citation] of citations.entries()) {
    if (!isRecord(citation) || !text(citation.assetVersionId)) finding(findings, "CITATION_INVALID", `course.citations[${index}]`, "Citations must identify a source asset version.");
    else if (!approvedSources.has(citation.assetVersionId)) finding(findings, "CITATION_SOURCE_NOT_APPROVED", `course.citations[${index}].assetVersionId`, "Citation source is not approved for this organization.");
  }

  const modules = Array.isArray(course.modules) ? course.modules : [];
  if (modules.length === 0) finding(findings, "MODULES_REQUIRED", "course.modules", "A publishable course needs at least one module.");
  let hasInteractive = false;
  let hasSimulation = false;
  let hasAssessment = false;
  const assessmentIds = new Set<string>();
  for (const [moduleIndex, module] of modules.entries()) {
    const activities = isRecord(module) && Array.isArray(module.activities) ? module.activities : [];
    if (activities.length === 0) finding(findings, "ACTIVITIES_REQUIRED", `course.modules[${moduleIndex}].activities`, "Each module needs at least one activity.");
    for (const [activityIndex, activity] of activities.entries()) {
      const path = `course.modules[${moduleIndex}].activities[${activityIndex}]`;
      if (!isRecord(activity) || !isSupportedCourseActivityType(activity.type)) {
        finding(findings, "ACTIVITY_TYPE_INVALID", `${path}.type`, "The activity type is not in the supported catalog.");
        continue;
      }
      if (["3d_viewer", "hotspot", "guided_procedure", "manipulation", "assembly", "fault_troubleshooting", "simulation", "simulation_outcome"].includes(activity.type)) hasInteractive = true;
      if(['image','video'].includes(activity.type)){
        for(const issue of validateMediaActivity(activity,input.approvedMediaAssets??[]).findings)finding(findings,issue.code,`${path}.media`,issue.message);
      }
      if (["simulation", "simulation_outcome", "fault_troubleshooting", "guided_procedure", "manipulation", "assembly"].includes(activity.type)) hasSimulation = true;
      if (Array.isArray(activity.citations)) for (const citation of activity.citations) if (isRecord(citation) && text(citation.assetVersionId) && !approvedSources.has(citation.assetVersionId)) finding(findings, "CITATION_SOURCE_NOT_APPROVED", `${path}.citations`, "Activity citation source is not approved for this organization.");
      if (["simulation","simulation_outcome","fault_troubleshooting","guided_procedure","manipulation","assembly"].includes(activity.type) && !text(activity.simulationDefinitionId)) finding(findings, "SIMULATION_BINDING_REQUIRED", `${path}.simulationDefinitionId`, "Simulation activities must bind to a simulation definition.");
      if (["multiple_choice", "multi_select", "ordered_step"].includes(activity.type)) {
        hasAssessment = true;
        const report = validateAssessmentDefinition(activity.assessment);
        for (const issue of report.errors) finding(findings, "ASSESSMENT_INVALID", `${path}.${issue.path}`, issue.message);
        if (isRecord(activity.assessment)) {
          const assessment = activity.assessment;
          if (text(assessment.assessmentId)) {
            if (assessmentIds.has(assessment.assessmentId)) finding(findings, "ASSESSMENT_DUPLICATE", path, "Assessment identifiers must be unique within the course.");
            assessmentIds.add(assessment.assessmentId);
            if (!(input.approvedReviewTargets ?? []).includes(`ASSESSMENT:${assessment.assessmentId}`)) finding(findings, "REVIEW_REQUIRED", path, "The assessment requires reviewer approval.");
          }
          for (const question of Array.isArray(assessment.questions) ? assessment.questions : []) {
            if (isRecord(question)) for (const citation of Array.isArray(question.citations) ? question.citations : []) {
              if (isRecord(citation) && typeof citation.assetVersionId === "string" && !approvedSources.has(citation.assetVersionId)) finding(findings, "CITATION_SOURCE_NOT_APPROVED", path, "Assessment source citations must be approved.");
            }
          }
        }
      }
    }
  }

  const model = isRecord(course.model) ? course.model : {};
  const modelComponentIds = hasInteractive ? validateModelManifest(model.manifest, "course.model.manifest", findings) : new Set<string>();
  for(const [mi,module] of modules.entries())for(const [ai,activity] of (isRecord(module)&&Array.isArray(module.activities)?module.activities:[]).entries()){
    if(isRecord(activity)&&['3d_viewer','hotspot'].includes(String(activity.type))){
      for(const issue of validateModelExploration(activity.type,activity.exploration,[...modelComponentIds]).findings)finding(findings,issue.code,`course.modules[${mi}].activities[${ai}].exploration`,issue.message);
    }
  }
  if (hasInteractive && !text(model.modelVersionId)) finding(findings, "MODEL_BINDING_REQUIRED", "course.model.modelVersionId", "Interactive activities must bind to an approved model version.");
  if (hasInteractive && !text(model.manifestHash)) finding(findings, "MODEL_HASH_REQUIRED", "course.model.manifestHash", "Interactive activities must bind to an immutable model manifest hash.");

  const approvedReviews = new Set(input.approvedReviewTargets ?? []);
  if (hasInteractive && text(model.modelVersionId) && !approvedReviews.has(`MODEL:${model.modelVersionId}`)) finding(findings, "REVIEW_REQUIRED", "course.model", "The bound model has not been approved by a reviewer.");

  const simulation = isRecord(course.simulation) ? course.simulation : {};
  if (hasSimulation) {
    if (!text(simulation.simulationDefinitionId)) finding(findings, "SIMULATION_BINDING_REQUIRED", "course.simulation.simulationDefinitionId", "Simulation activities require a bound simulation definition.");
    const definition = simulation.definition;
    const simulationReport = validateSimulationDefinition(definition);
    for (const item of simulationReport.findings) findings.push({ ...item, path: item.path.replace(/^simulation/, "course.simulation.definition") });
    const typedDefinition = asSimulationDefinition(definition);
    if (typedDefinition && text(model.modelVersionId) && typedDefinition.model.modelVersionId !== model.modelVersionId) finding(findings, "MODEL_BINDING_MISMATCH", "course.simulation.definition.model.modelVersionId", "Simulation and course model versions must match exactly.");
    if (typedDefinition && text(model.manifestHash) && typedDefinition.model.manifestHash !== model.manifestHash) finding(findings, "MODEL_HASH_MISMATCH", "course.simulation.definition.model.manifestHash", "Simulation and course model manifest hashes must match exactly.");
    if (typedDefinition && modelComponentIds.size > 0) for (const componentId of typedDefinition.model.componentIds) if (!modelComponentIds.has(componentId)) finding(findings, "MODEL_COMPONENT_UNKNOWN", "course.simulation.definition.model.componentIds", `Simulation references model component ${componentId} that is not in the manifest.`);
    if (text(simulation.simulationDefinitionId) && !approvedReviews.has(`SIMULATION:${simulation.simulationDefinitionId}`)) finding(findings, "REVIEW_REQUIRED", "course.simulation", "The bound simulation has not been approved by a reviewer.");
  }

  const policy = isRecord(course.policy) ? course.policy : {};
  if(course.story!==undefined){
    if(policy.schemaVersion!=='certification-policy.v1')finding(findings,'STORY_POLICY_REQUIRED','course.policy','Stories require a versioned certification policy with explicit activity requirements.');
    const activities=modules.flatMap(module=>isRecord(module)&&Array.isArray(module.activities)?module.activities.filter(isRecord).map(activity=>({activityId:String(activity.activityId??''),moduleId:String(module.moduleId??'')})):[]);
    const requiredActivities=Array.isArray(policy.requiredActivityIds)?policy.requiredActivityIds.filter((id):id is string=>typeof id==='string'):[];
    const requiredModules=Array.isArray(policy.requiredModuleIds)?policy.requiredModuleIds:[];
    const required=[...new Set([...requiredActivities,...activities.filter(a=>requiredModules.includes(a.moduleId)).map(a=>a.activityId)])];
    for(const issue of validateCourseStory(course.story,activities.map(a=>a.activityId),required,courseStoryFaultContext(course)).findings)finding(findings,issue.code,`course.${issue.path}`,issue.message);
  }

  if(isRecord(course.releaseChange)&&course.releaseChange.decision==='update_modules'&&policy.schemaVersion!=='certification-policy.v1')finding(findings,'UPDATE_POLICY_REQUIRED','course.policy','Selected-module requalification requires a versioned certification policy with explicit required activities.');
  if(policy.schemaVersion!==undefined){
    const descriptors=(Array.isArray(course.modules)?course.modules:[]).flatMap((module,index)=>isRecord(module)&&Array.isArray(module.activities)?module.activities.filter(isRecord).map(activity=>({activityId:String(activity.activityId??""),moduleId:String(module.moduleId??`module:${index}`),kind:(["multiple_choice","multi_select","ordered_step"].includes(String(activity.type))?"assessment":["simulation","simulation_outcome","fault_troubleshooting","guided_procedure","manipulation","assembly"].includes(String(activity.type))?"simulation":"content") as "assessment"|"simulation"|"content",passScore:Number(isRecord(activity.assessment)?activity.assessment.passScore:isRecord(course.simulation)&&isRecord(course.simulation.definition)&&isRecord(course.simulation.definition.scoring)?course.simulation.definition.scoring.passScore:0)})):[]);
    if(!validCertificationPolicy(policy,descriptors))finding(findings,"CERTIFICATION_POLICY_INVALID","course.policy","Configure valid certification requirements including at least one scored activity, result selection and bounded policy values.");
  }
  if (hasAssessment || hasSimulation) {
    if (!Number.isSafeInteger(policy.maxAttempts) || Number(policy.maxAttempts) < 1 || Number(policy.maxAttempts) > 100
      || !Number.isSafeInteger(policy.cooldownSeconds) || Number(policy.cooldownSeconds) < 0 || Number(policy.cooldownSeconds) > 604800
      || !Number.isSafeInteger(policy.attemptTtlSeconds) || Number(policy.attemptTtlSeconds) < 60 || Number(policy.attemptTtlSeconds) > 86400) finding(findings, "ASSESSMENT_POLICY_INVALID", "course.policy", "Set attempt limits (1–100), cooldown (0–604800 seconds), and attempt duration (60–86400 seconds).");
  }
  if (hasAssessment) {
    if (!text(policy.policyId) || !Number.isSafeInteger(policy.version) || Number(policy.version) < 1) finding(findings, "POLICY_BINDING_REQUIRED", "course.policy", "Assessments require a versioned certification policy.");
    if (!Array.isArray(policy.requiredEvidence) || !policy.requiredEvidence.includes("assessment.passed")) finding(findings, "POLICY_EVIDENCE_REQUIRED", "course.policy", "The policy must require a server-scored passing assessment.");
    if (text(policy.policyId) && !(input.approvedReviewTargets ?? []).includes(`POLICY:${policy.policyId}`)) finding(findings, "REVIEW_REQUIRED", "course.policy", "The policy requires reviewer approval.");
  }
  if (hasSimulation) {
    if (!text(policy.policyId) || !Number.isInteger(policy.version) || (typeof policy.version === "number" && policy.version < 1)) finding(findings, "POLICY_BINDING_REQUIRED", "course.policy", "Certification-critical activities require a versioned policy binding.");
    if (!Array.isArray(policy.requiredEvidence) || !policy.requiredEvidence.includes("simulation.completed")) finding(findings, "POLICY_EVIDENCE_REQUIRED", "course.policy.requiredEvidence", "The policy must require server-evaluated simulation evidence.");
    if (!Array.isArray(policy.requiredEvidence) || !policy.requiredEvidence.includes("simulation.equivalent-path")) finding(findings, "POLICY_EQUIVALENT_PATH_REQUIRED", "course.policy.requiredEvidence", "The policy must name the approved equivalent path evidence.");
    if (text(policy.policyId) && !approvedReviews.has(`POLICY:${policy.policyId}`)) finding(findings, "REVIEW_REQUIRED", "course.policy", "The certification policy has not been approved by a reviewer.");
  }

  for (const warning of input.aiWarnings ?? []) {
    if (["SOURCE_CONFLICT", "CONFLICTING_SOURCE", "UNSAFE_CONTENT", "UNSUPPORTED_CLAIM", "CITATION_MISSING"].includes(warning.code)) finding(findings, warning.code, "course.aiWarnings", warning.message ?? "AI warning requires resolution before publication.");
    else if (warning.severity === "error") finding(findings, "AI_WARNING_BLOCKING", "course.aiWarnings", warning.message ?? "An AI error must be resolved before publication.");
  }

  return { valid: findings.every((item) => item.severity !== "error"), findings };
}
import { validateAssessmentDefinition } from "./assessment.js";
import { validCertificationPolicy } from "./certification.js";
import { validReleaseChange } from './release-change.js';
export * from './release-change.js';
export * from "./assessment.js";

export * from './story.js';

import {validateCourseStory,courseStoryFaultContext} from './story.js';

export * from './story-preview.js';
export * from './media.js';
import {validateMediaActivity} from './media.js';
export * from './model-exploration.js';
import {validateModelExploration} from './model-exploration.js';

export {remapCourseComponents,type ComponentMapping} from "./component-remapping.js";
