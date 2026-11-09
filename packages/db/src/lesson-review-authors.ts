import { lessonRenderRevision } from '@medical-device/contracts';

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
export interface LessonAuthorHistoryRow { created_by: string; actor_id?: string | null; details?: unknown }
/** Only authoritative audit snapshots count. Saving a scorecard is not authoring instructions. */
export function lessonInstructionAuthors(lesson: Record<string, unknown>, history: LessonAuthorHistoryRow[]): string[] {
  const ids = new Set<unknown>([lesson.lessonId]);
  if (object(lesson.variantIdentity)) ids.add(lesson.variantIdentity.sourceLessonId);
  const authors = new Set(history.map(row => row.created_by).filter(Boolean));
  const revisions = (content: unknown) => {
    const lessons = object(content) && Array.isArray(content.videoLessons) ? content.videoLessons.filter(object) : [];
    return JSON.stringify([...ids].map(id => lessons.find(item => item.lessonId === id)).map(item => item ? lessonRenderRevision(item) : null));
  };
  for (const row of history) {
    if (!row.actor_id || !object(row.details) || !object(row.details.before) || !object(row.details.after)) continue;
    if (revisions(row.details.before) !== revisions(row.details.after)) authors.add(row.actor_id);
  }
  return [...authors];
}
