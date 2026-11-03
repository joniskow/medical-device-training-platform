import { isSupportedCourseActivityType, validateAssessmentDefinition, validateModelExploration, validateMediaActivity, type ApprovedMediaAsset, validateSimulationDefinition, type SimulationDefinition, validCertificationPolicy, validateCourseStory, courseStoryFaultContext, type PolicyActivity, validateVideoLesson } from "@medical-device/simulation-schema";
import type { AiGatewayResult } from "@medical-device/contracts";

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const canonical = (value: unknown): string => JSON.stringify(value, Object.keys(value as object).sort());

// Match exact supplied locators, not merely an approved document ID. No semantic
// claim-support inference is made here; that remains an evaluation/review task.
export function validateDraftGrounding(result: AiGatewayResult, sources: Array<{ assetVersionId: string; citation: unknown }>, mediaAssets: readonly ApprovedMediaAsset[] = []): AiGatewayResult {
  if (result.status !== "DRAFT") return result;
  const reject = (code: string, message: string): AiGatewayResult => ({
    ...result, status: "REJECTED", output: undefined, citations: [],
    warnings: [...result.warnings, { code, severity: "error", message }],
    failure: { class: "VALIDATION", code, message }
  });
  const allowed = new Map<string, string>();
  for (const source of sources) {
    if (!record(source.citation) || !Number.isSafeInteger(source.citation.page) || Number(source.citation.page) < 1) continue;
    const citation = { ...source.citation, assetVersionId: source.assetVersionId };
    allowed.set(canonical(citation), source.assetVersionId);
  }
  const used = new Set<string>();
  const validCitations = (value: unknown): boolean => {
    if (!Array.isArray(value) || !value.length || value.length > 128) return false;
    return value.every(citation => {
      if (!record(citation) || Object.values(citation).some(item => item !== null && typeof item === "object")) return false;
      const asset = allowed.get(canonical(citation));
      if (!asset) return false;
      used.add(asset); return true;
    });
  };
  const course = result.output;
  if (!record(course) || course.schemaVersion !== "course-draft.v1" || typeof course.title !== "string" || !course.title.trim() || course.title.length > 240 || !Array.isArray(course.modules) || !course.modules.length || course.modules.length > 100) {
    return reject("AI_DRAFT_STRUCTURE_INVALID", "Generated course must contain a title and bounded, nonempty modules and activities.");
  }
  if (!validCitations(course.citations)) return reject("AI_CITATION_INVALID", "Course citations must exactly match supplied source passage locators.");
  const assessmentIds = new Set<string>();
  const activityIds = new Set<string>();
  const simulationActivities: Record<string, unknown>[] = [];
  for (const module of course.modules) {
    if (!record(module) || typeof module.title !== "string" || !module.title.trim() || !Array.isArray(module.activities) || !module.activities.length || module.activities.length > 200) return reject("AI_DRAFT_STRUCTURE_INVALID", "Every generated module needs a title and bounded, nonempty activities.");
    for (const activity of module.activities) {
      if (!record(activity) || typeof activity.type !== "string" || !activity.type.trim()) return reject("AI_DRAFT_STRUCTURE_INVALID", "Every generated activity needs a type.");
      if (typeof activity.activityId === "string") {
        if (activityIds.has(activity.activityId)) return reject("AI_DRAFT_STRUCTURE_INVALID", "Generated activity identifiers must be unique across the course.");
        activityIds.add(activity.activityId);
      }
      if (!isSupportedCourseActivityType(activity.type)) return reject("AI_ACTIVITY_TYPE_INVALID", "Generated activity type is not in the supported course catalog.");
      if (["multiple_choice", "multi_select", "ordered_step"].includes(activity.type)) {
        if (!validateAssessmentDefinition(activity.assessment).valid || !record(activity.assessment)) return reject("AI_ASSESSMENT_INVALID", "Generated assessment does not satisfy the assessment schema, answer or scoring rules.");
        const assessmentId = activity.assessment.assessmentId as string;
        if (assessmentIds.has(assessmentId)) return reject("AI_ASSESSMENT_INVALID", "Generated assessment identifiers must be unique across the course.");
        assessmentIds.add(assessmentId);
      } else if (activity.assessment !== undefined) {
        return reject("AI_ASSESSMENT_INVALID", "Assessment definitions must belong to an assessment activity.");
      }
      if (["image", "video"].includes(activity.type)) {
        if (!validateMediaActivity(activity, mediaAssets).valid) return reject("AI_MEDIA_INVALID", "Generated media must bind an approved asset of the matching type and include a valid image description or video transcript.");
      } else if (activity.media !== undefined) return reject("AI_MEDIA_INVALID", "Media bindings must belong to an image or video activity.");
      if (["3d_viewer", "hotspot"].includes(activity.type)) {
        const model = course.model;
        if (!record(model) || !record(model.manifest) || !Array.isArray(model.manifest.components)) return reject("AI_EXPLORATION_INVALID", "Generated model inspection requires an approved bound model.");
        const componentIds = model.manifest.components.filter(record).map(component=>component.componentId).filter((id): id is string=>typeof id === "string");
        if (!validateModelExploration(activity.type, activity.exploration, componentIds).valid) return reject("AI_EXPLORATION_INVALID", "Generated inspection needs a bounded overview and valid, unique component hotspots with equivalent text.");
      } else if (activity.exploration !== undefined) {
        return reject("AI_EXPLORATION_INVALID", "Model inspection content must belong to a viewer or hotspot activity.");
      }
      if (["simulation", "simulation_outcome", "fault_troubleshooting", "guided_procedure", "manipulation", "assembly"].includes(activity.type)) simulationActivities.push(activity);
      if (!validCitations(activity.citations)) return reject("AI_CITATION_INVALID", "Every generated activity must cite supplied source passage locators.");
    }
  }
  if (course.videoLessons !== undefined) {
    if (!Array.isArray(course.videoLessons) || course.videoLessons.length > 8) return reject("AI_VIDEO_LESSON_INVALID", "Generated video lessons must be a bounded list.");
    const approvedMedia = new Set(mediaAssets.map(asset => asset.assetVersionId));
    for (const lesson of course.videoLessons) {
      const report = validateVideoLesson(lesson);
      if (!report.valid) return reject("AI_VIDEO_LESSON_INVALID", report.findings[0]?.message ?? "Generated video lesson is invalid.");
      const scenes = (lesson as Record<string, unknown>).scenes as Array<Record<string, unknown>>;
      for (const scene of scenes) {
        const visual = scene.visual as Record<string, unknown>;
        if (typeof visual.assetVersionId === "string" && !approvedMedia.has(visual.assetVersionId)) return reject("AI_VIDEO_LESSON_MEDIA_INVALID", "Video lesson visuals must bind selected approved media.");
        if (scene.checkpointActivityId !== undefined && (typeof scene.checkpointActivityId !== "string" || !activityIds.has(scene.checkpointActivityId))) return reject("AI_VIDEO_LESSON_CHECKPOINT_INVALID", "Video lesson checkpoints must link to activities in the same course.");
        if (!validCitations(scene.citations)) return reject("AI_CITATION_INVALID", "Every video scene must cite supplied source passage locators.");
      }
      if (!validCitations((lesson as Record<string, unknown>).citations)) return reject("AI_CITATION_INVALID", "Every video lesson must cite supplied source passage locators.");
    }
  }
  // Also inspect citations on questions, steps and other nested blocks. Bound
  // traversal so malformed provider results cannot exhaust the call stack.
  const pending: Array<{ value: unknown; depth: number }> = [{ value: course, depth: 0 }];
  let visited = 0;
  while (pending.length) {
    const { value, depth } = pending.pop()!;
    if (++visited > 20_000 || depth > 32) return reject("AI_DRAFT_STRUCTURE_INVALID", "Generated course exceeded validation limits.");
    if (!value || typeof value !== "object") continue;
    for (const [key, item] of Object.entries(value)) {
      if (/^(script|javascript|code|eval|sql|query|__proto__|constructor|prototype)$/i.test(key) || key === "_source" || key === "_lineage") return reject("AI_DRAFT_FIELD_FORBIDDEN", "Generated content contains a protected or executable field.");
      if (key === "citations") {
        if (!validCitations(item)) return reject("AI_CITATION_INVALID", "A nested citation does not match a supplied source passage locator.");
      } else pending.push({ value: item, depth: depth + 1 });
    }
  }
  if (simulationActivities.length || course.simulation !== undefined) {
    const binding = course.simulation;
    if (!record(binding) || !validateSimulationDefinition(binding.definition).valid) return reject("AI_SIMULATION_INVALID", "Generated simulation does not satisfy the runtime procedure, fault, scoring or equivalent-path rules.");
    const definition = binding.definition as SimulationDefinition;
    if (binding.simulationDefinitionId !== definition.simulationDefinitionId || simulationActivities.some(activity => activity.simulationDefinitionId !== definition.simulationDefinitionId)) return reject("AI_SIMULATION_BINDING_INVALID", "Generated simulation activities and course binding must identify the exact generated definition.");
    if (!record(course.model) || course.model.modelVersionId !== definition.model.modelVersionId || course.model.manifestHash !== definition.model.manifestHash) return reject("AI_SIMULATION_BINDING_INVALID", "Generated simulation must match the course model version and manifest hash.");
    if (!record(course.model.manifest) || !Array.isArray(course.model.manifest.components)) return reject("AI_SIMULATION_BINDING_INVALID", "Generated simulation requires course model component metadata.");
    const components = new Set(course.model.manifest.components.filter(record).map(component => component.componentId));
    if (definition.model.componentIds.some(id => !components.has(id))) return reject("AI_SIMULATION_BINDING_INVALID", "Generated simulation references a component absent from the course model.");
  }
  if (course.policy !== undefined || course.story !== undefined) {
    const simulation = record(course.simulation) && record(course.simulation.definition) ? course.simulation.definition : {};
    const activities: PolicyActivity[] = (course.modules as Record<string, unknown>[]).flatMap(module => (module.activities as Record<string, unknown>[]).map(activity => ({
      activityId: String(activity.activityId ?? ""),
      moduleId: String(module.moduleId ?? ""),
      kind: ["multiple_choice", "multi_select", "ordered_step"].includes(String(activity.type)) ? "assessment" : simulationActivities.includes(activity) ? "simulation" : "content",
      passScore: Number(record(activity.assessment) ? activity.assessment.passScore : simulationActivities.includes(activity) && record(simulation.scoring) ? simulation.scoring.passScore : 0)
    })));
    if (!validCertificationPolicy(course.policy, activities)) return reject("AI_POLICY_INVALID", "Generated certification policy must reference valid activities and satisfy scoring, evidence and attempt rules.");
    if (course.story !== undefined) {
      const policy = course.policy;
      const required = [...new Set([...policy.requiredActivityIds, ...activities.filter(activity => policy.requiredModuleIds.includes(activity.moduleId)).map(activity=>activity.activityId)])];
      if (!validateCourseStory(course.story, activities.map(activity=>activity.activityId), required, courseStoryFaultContext(course)).valid) return reject("AI_STORY_INVALID", "Generated story must have valid bounded paths and recorded-fact conditions without bypassing required activities.");
    }
  }
  return { ...result, citations: [...used] };
}

export function bindTrustedGenerationModel(result: AiGatewayResult, model?: Record<string, unknown>): AiGatewayResult {
  if (result.status !== "DRAFT" || !record(result.output)) return result;
  const canonicalModel = (value: unknown): unknown => Array.isArray(value) ? value.map(canonicalModel) : record(value) ? Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,canonicalModel(item)])) : value;
  const supplied = result.output.model;
  if (supplied !== undefined && (!model || JSON.stringify(canonicalModel(supplied)) !== JSON.stringify(canonicalModel(model)))) {
    const code="AI_MODEL_CONTEXT_INVALID",message="Generated model metadata must match the approved model bound to this draft.";
    return {...result,status:"REJECTED",output:undefined,citations:[],warnings:[...result.warnings,{code,message,severity:"error"}],failure:{class:"VALIDATION",code,message}};
  }
  return model ? {...result,output:{...result.output,model:structuredClone(model)}} : result;
}

export function generatedMediaIds(result: AiGatewayResult): string[] {
  if (result.status !== "DRAFT" || !record(result.output) || !Array.isArray(result.output.modules)) return [];
  const ids = new Set<string>();
  for (const module of result.output.modules) {
    if (!record(module) || !Array.isArray(module.activities)) continue;
    for (const activity of module.activities) {
      if (!record(activity) || !["image", "video"].includes(String(activity.type)) || !record(activity.media)) continue;
      if (typeof activity.media.assetVersionId === "string" && /^[A-Za-z0-9._:-]{1,128}$/.test(activity.media.assetVersionId)) ids.add(activity.media.assetVersionId);
      if (ids.size > 128) return []; // No approved context: subsequent media validation rejects.
    }
  }
  for (const lesson of Array.isArray(result.output.videoLessons) ? result.output.videoLessons : []) {
    if (!record(lesson) || !Array.isArray(lesson.scenes)) continue;
    for (const scene of lesson.scenes) {
      const visual = record(scene) && record(scene.visual) ? scene.visual : undefined;
      if (visual && typeof visual.assetVersionId === "string" && /^[A-Za-z0-9._:-]{1,128}$/.test(visual.assetVersionId)) ids.add(visual.assetVersionId);
    }
  }
  return [...ids];
}
