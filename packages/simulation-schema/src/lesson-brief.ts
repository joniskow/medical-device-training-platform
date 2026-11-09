export interface LessonBrief {
  schemaVersion: 'lesson-brief.v1';
  audience: string;
  priorKnowledge: string;
  task: string;
  objective: string;
  deviceRevision: string;
  setting: string;
  format: 'orientation' | 'procedure' | 'troubleshooting' | 'refresher';
  referencePack: {
    approvedViewIds: string[];
    sourceArtifactIds: string[];
    exactLabels: string[];
    permittedStates: string[];
    permittedActions: string[];
    visualConventions: string;
    terminology: string[];
  };
}

export interface BriefFinding { code: string; path: string; message: string }
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const stableBrief = (value: unknown): string => JSON.stringify(value, (_key, item) => object(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const boundedText = (value: unknown): value is string => typeof value === 'string' && !!value.trim() && value.length <= 2000;
const ids = (value: unknown): value is string[] => Array.isArray(value) && value.length <= 32 && new Set(value).size === value.length && value.every(id => typeof id === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(id));

export function validateLessonBrief(value: unknown): { valid: boolean; findings: BriefFinding[] } {
  const findings: BriefFinding[] = [];
  const fail = (path: string, message: string) => findings.push({ code: 'LESSON_BRIEF_INVALID', path, message });
  if (!object(value) || value.schemaVersion !== 'lesson-brief.v1') return { valid: false, findings: [{ code: 'LESSON_BRIEF_INVALID', path: 'lessonBrief', message: 'Save an instructional brief before generating a video lesson.' }] };
  for (const key of ['audience', 'priorKnowledge', 'task', 'objective', 'deviceRevision', 'setting']) if (!boundedText(value[key])) fail(key, `Provide ${key} (at most 2,000 characters).`);
  if (!['orientation', 'procedure', 'troubleshooting', 'refresher'].includes(String(value.format))) fail('format', 'Choose a supported teaching format.');
  const pack = value.referencePack;
  if (!object(pack)) fail('referencePack', 'Bind a reference pack.');
  else {
    for (const key of ['approvedViewIds', 'sourceArtifactIds']) if (!ids(pack[key])) fail(`referencePack.${key}`, 'Use unique stable source or approved media version IDs (at most 32).');
    if (Array.isArray(pack.sourceArtifactIds) && !pack.sourceArtifactIds.length) fail('referencePack.sourceArtifactIds', 'Bind the reviewed source revision.');
    if (Array.isArray(pack.approvedViewIds) && !pack.approvedViewIds.length) fail('referencePack.approvedViewIds', 'Bind at least one approved reference view.');
    for (const key of ['exactLabels', 'permittedStates', 'permittedActions', 'terminology']) if (!Array.isArray(pack[key]) || pack[key].length > 64 || !(pack[key] as unknown[]).every(boundedText)) fail(`referencePack.${key}`, 'Provide at most 64 bounded entries.');
    if (!boundedText(pack.visualConventions)) fail('referencePack.visualConventions', 'Record lighting, camera, palette and typography conventions.');
  }
  return { valid: !findings.length, findings };
}

export function lessonBriefEvidenceFindings(brief: LessonBrief, sources: string[], media: Array<{ assetVersionId: string; sourceType: string }>): BriefFinding[] {
  const findings: BriefFinding[] = [];
  const fail = (code: string, path: string, message: string) => findings.push({ code, path, message });
  if (brief.referencePack.sourceArtifactIds.some(id => !sources.includes(id))) fail('LESSON_BRIEF_SOURCE_MISMATCH', 'referencePack.sourceArtifactIds', 'Select the exact source revisions bound in the brief.');
  if (brief.referencePack.approvedViewIds.some(id => !media.some(asset => asset.assetVersionId === id && ['image', 'video'].includes(asset.sourceType)))) fail('LESSON_BRIEF_VIEW_UNAPPROVED', 'referencePack.approvedViewIds', 'Every reference view must be selected approved image or video media.');
  if (brief.format !== 'orientation' && !media.some(asset => brief.referencePack.approvedViewIds.includes(asset.assetVersionId) && asset.sourceType === 'video')) fail('LESSON_BRIEF_FORMAT_UNSUPPORTED', 'format', 'This format needs approved motion evidence. Photos alone support orientation, not a demonstrated action sequence.');
  return findings;
}

/** Editing a brief never mutates the supplied snapshot or a published release. */
export function invalidateBriefArtifacts(previous: Record<string, unknown>, content: Record<string, unknown>): Record<string, unknown> {
  const next = structuredClone(content);
  if (stableBrief(previous.lessonBrief ?? null) === stableBrief(content.lessonBrief ?? null)) return next;
  if (Array.isArray(next.videoLessons)) next.videoLessons = next.videoLessons.map(lesson => {
    if (!object(lesson)) return lesson;
    const stale = { ...lesson, generationStatus: 'STALE', staleReason: 'Instructional brief or reference pack changed. Regenerate and review this lesson.' };
    for (const key of ['render', 'renderOutput', 'roughCut', 'audio', 'captions', 'finalReview', 'acceptedTake', 'renderArtifact', 'previewAcceptance']) delete (stale as Record<string, unknown>)[key];
    return stale;
  });
  return next;
}
