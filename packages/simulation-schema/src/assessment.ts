export interface AssessmentQuestion {
  questionId: string;
  type: "multiple_choice" | "multi_select" | "ordered_step";
  prompt: string;
  options: Array<{ optionId: string; text: string }>;
  correctOptionIds: string[];
  points: number;
  competencyIds: string[];
  rationale: string;
  citations: Array<{ assetVersionId: string; page?: number }>;
}
export interface AssessmentDefinition {
  schemaVersion: "assessment-definition.v1";
  assessmentId: string;
  version: number;
  passScore: number;
  questions: AssessmentQuestion[];
}
type RecordValue = Record<string, unknown>;
const object = (value: unknown): value is RecordValue => !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= 4000;
const id = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9._:-]{1,128}$/.test(value);
const ids = (value: unknown): value is string[] => Array.isArray(value) && value.every(id) && new Set(value).size === value.length;

export function validateAssessmentDefinition(value: unknown): { valid: boolean; errors: Array<{ path: string; message: string }> } {
  const errors: Array<{ path: string; message: string }> = [];
  const error = (path: string, message: string) => { errors.push({ path, message }); };
  if (!object(value)) return { valid: false, errors: [{ path: "assessment", message: "An assessment definition is required." }] };
  if (value.schemaVersion !== "assessment-definition.v1" || !id(value.assessmentId) || !Number.isSafeInteger(value.version) || Number(value.version) < 1) error("assessment", "A versioned assessment identifier is required.");
  if (typeof value.passScore !== "number" || !Number.isFinite(value.passScore) || value.passScore <= 0 || value.passScore > 1) error("assessment.passScore", "Passing threshold must be greater than zero and at most one.");
  if (!Array.isArray(value.questions) || value.questions.length < 1 || value.questions.length > 100) error("assessment.questions", "Provide between one and 100 questions.");
  const questionIds = new Set<string>();
  for (const [index, question] of (Array.isArray(value.questions) ? value.questions : []).entries()) {
    const path = `assessment.questions[${index}]`;
    if (!object(question)) { error(path, "A question is required."); continue; }
    if (!id(question.questionId) || questionIds.has(question.questionId)) error(path, "Question identifiers must be valid and unique.");
    else questionIds.add(question.questionId);
    if (!["multiple_choice", "multi_select", "ordered_step"].includes(String(question.type))) error(path, "Unsupported question type.");
    if (!text(question.prompt) || !text(question.rationale)) error(path, "A prompt and answer rationale are required.");
    if (!Number.isSafeInteger(question.points) || Number(question.points) < 1 || Number(question.points) > 100) error(path, "Points must be an integer from one to 100.");
    if (!ids(question.competencyIds) || !question.competencyIds.length) error(path, "At least one unique competency is required.");
    const options = Array.isArray(question.options) ? question.options : [];
    const optionIds = options.map(option => object(option) ? option.optionId : undefined);
    if (options.length < 2 || options.length > 20 || !ids(optionIds) || options.some(option => !object(option) || !text(option.text))) error(path, "Provide two to 20 uniquely identified, labeled options.");
    const labels = options.filter(object).filter(option => typeof option.text === 'string').map(option => (option.text as string).trim().replace(/\s+/gu, ' '));
    if (new Set(labels).size !== labels.length) error(path, 'Answer options must have distinguishable text; label repeated actions by their stage or context.');
    if (!ids(question.correctOptionIds) || !question.correctOptionIds.length || question.correctOptionIds.some(option => !optionIds.includes(option))) error(path, "Correct answers must identify distinct available options.");
    else {
      if (question.type === "multiple_choice" && question.correctOptionIds.length !== 1) error(path, "Single-choice questions require exactly one correct answer.");
      if (question.type === "ordered_step" && question.correctOptionIds.length !== options.length) error(path, "The correct sequence must contain every step exactly once.");
    }
    if (!Array.isArray(question.citations) || !question.citations.length || question.citations.some(citation => !object(citation) || !id(citation.assetVersionId) || (citation.page !== undefined && (!Number.isSafeInteger(citation.page) || Number(citation.page) < 1)))) error(path, "Each question requires valid source citations.");
  }
  return { valid: !errors.length, errors };
}

/** Use only with the immutable assessment loaded by the server for the attempt. */
export function scoreAssessment(definition: AssessmentDefinition, answers: unknown) {
  if (!validateAssessmentDefinition(definition).valid) throw new Error("ASSESSMENT_INVALID");
  if (!Array.isArray(answers) || answers.length !== definition.questions.length) throw new Error("ASSESSMENT_ANSWERS_INVALID");
  const byId = new Map<string, string[]>();
  for (const answer of answers) {
    if (!object(answer) || Object.keys(answer).some(key => !["questionId", "selectedOptionIds"].includes(key)) || !id(answer.questionId) || !ids(answer.selectedOptionIds) || byId.has(answer.questionId)) throw new Error("ASSESSMENT_ANSWERS_INVALID");
    byId.set(answer.questionId, answer.selectedOptionIds);
  }
  let score = 0;
  let maxScore = 0;
  const competencies = new Map<string, boolean>();
  for (const question of definition.questions) {
    const selected = byId.get(question.questionId);
    if (!selected || selected.some(option => !question.options.some(candidate => candidate.optionId === option)) || (question.type === "multiple_choice" && selected.length > 1) || (question.type === "ordered_step" && selected.length !== question.options.length)) throw new Error("ASSESSMENT_ANSWERS_INVALID");
    const correct = selected.length === question.correctOptionIds.length && (question.type === "ordered_step" ? selected.every((option,index) => option === question.correctOptionIds[index]) : selected.every(option => question.correctOptionIds.includes(option)));
    maxScore += question.points;
    if (correct) score += question.points;
    for (const competency of question.competencyIds) competencies.set(competency, (competencies.get(competency) ?? true) && correct);
  }
  return { score, maxScore, passed: score / maxScore >= definition.passScore, demonstratedCompetencyIds: [...competencies].filter(([,passed]) => passed).map(([key]) => key), missedCompetencyIds: [...competencies].filter(([,passed]) => !passed).map(([key]) => key) };
}

export function learnerAssessment(definition: AssessmentDefinition) {
  if (!validateAssessmentDefinition(definition).valid) throw new Error("ASSESSMENT_INVALID");
  return { assessmentId: definition.assessmentId, version: definition.version, questions: definition.questions.map(question => ({ questionId: question.questionId, type: question.type, prompt: question.prompt, options: question.options.map(option => ({ optionId: option.optionId, text: option.text })).sort((a,b) => a.optionId.localeCompare(b.optionId)) })) };
}
