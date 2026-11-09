import { validateLessonDirection, lessonDirectionRevision, type LessonDirection, type VideoLessonScene } from '@medical-device/simulation-schema';

/** Inline controls participate in the existing draft autosave and revision conflict handling. */
export function renderLessonDirectionEditor(parent: HTMLElement, lesson: Record<string, unknown>, onChange: () => void): void {
  const root = document.createElement('fieldset');
  root.dataset.lessonDirectionEditor = 'true';
  const legend = document.createElement('legend'); legend.textContent = 'Script and shot plan'; root.append(legend); parent.append(root);
  const direction = lesson.direction as LessonDirection | undefined;
  const scenes = Array.isArray(lesson.scenes) ? lesson.scenes as VideoLessonScene[] : [];
  if (!direction || !Array.isArray(direction.beats)) { const p = document.createElement('p'); p.textContent = 'Generate a source-linked shot plan with the saved instructional brief before rendering.'; root.append(p); return; }
  const status = document.createElement('p'); status.setAttribute('role', 'status');
  const review = document.createElement('input'); review.type = 'checkbox';
  const report = () => { const validation = validateLessonDirection(direction, scenes); status.textContent = validation.findings.length ? validation.findings.map(f => `${f.path}: ${f.message}`).join(' ') : 'Script and shot plan are structurally valid. Compare every instruction with the source before review.'; review.disabled = !validation.valid; return validation; };
  const invalidate = () => {
    for (const key of ['directionReview', 'render', 'renderOutput', 'roughCut', 'audio', 'captions', 'finalReview', 'acceptedTake', 'renderArtifact', 'previewAcceptance']) delete lesson[key];
    review.checked = false; report(); onChange();
  };
  const field = (host: HTMLElement, title: string, value: string, update: (value: string) => void, numeric = false) => {
    const label = document.createElement('label'); label.textContent = title;
    const input = document.createElement(numeric ? 'input' : 'textarea'); input.value = value;
    if (numeric) { (input as HTMLInputElement).type = 'number'; (input as HTMLInputElement).min = '0'; (input as HTMLInputElement).step = '0.1'; }
    input.oninput = () => { update(input.value); invalidate(); }; label.append(input); host.append(label);
  };
  field(root, 'Opening problem', direction.openingProblem, value => { direction.openingProblem = value; });
  field(root, 'Intended outcome', direction.outcome, value => { direction.outcome = value; });
  for (const beat of direction.beats) {
    const scene = scenes.find(scene => scene.sceneId === beat.sceneId); if (!scene) continue;
    const group = document.createElement('fieldset'); group.dataset.directionScene = beat.sceneId;
    const title = document.createElement('legend'); title.textContent = `Scene ${beat.sceneId}: ${scene.startSeconds}–${scene.endSeconds}s`; group.append(title); root.append(group);
    const evidence = document.createElement('pre'); evidence.textContent = beat.sourceEvidence.map(item => `${JSON.stringify(item.citation)}\n${item.quote}`).join('\n\n'); group.append(evidence);
    const constraints = document.createElement('p'); constraints.textContent = `Preserve prerequisites: ${beat.prerequisites.join(' ')} Warnings: ${beat.warnings.join(' ')} Exact labels: ${beat.exactLabels.join(', ')}`; group.append(constraints);
    field(group, 'Narration (orient → observe → act → verify → explain)', beat.narration, value => { beat.narration = value; scene.narration = value; });
    for (const [key, title] of [['startingCondition', 'Starting condition'], ['subject', 'Shot subject'], ['attentionTarget', 'Attention target'], ['action', 'Source-supported action'], ['result', 'Visible result']] as const) field(group, title, beat[key], value => { beat[key] = value; });
    const framingLabel = document.createElement('label'); framingLabel.textContent = 'Framing'; const framing = document.createElement('select');
    for (const name of ['context', 'operator', 'detail', 'action', 'result']) framing.add(new Option(name, name)); framing.value = beat.framing;
    framing.onchange = () => { beat.framing = framing.value as typeof beat.framing; invalidate(); }; framingLabel.append(framing); group.append(framingLabel);
    field(group, 'Result observation hold (seconds)', String(beat.observationHoldSeconds), value => { beat.observationHoldSeconds = Number(value); }, true);
    for (const callout of beat.callouts) {
      field(group, 'Callout text', callout.text, value => { callout.text = value; });
      field(group, 'Callout target', callout.target, value => { callout.target = value; });
      field(group, 'Callout start (seconds within scene)', String(callout.startSeconds), value => { callout.startSeconds = Number(value); }, true);
      field(group, 'Callout end (seconds within scene)', String(callout.endSeconds), value => { callout.endSeconds = Number(value); }, true);
    }
  }
  root.append(status);
  const label = document.createElement('label'); label.textContent = 'I compared the complete script and shot plan with the source evidence.';
  const previous = lesson.directionReview as { revision?: string } | undefined;
  review.checked = previous?.revision === lessonDirectionRevision(direction);
  review.onchange = () => { if (review.checked && report().valid) lesson.directionReview = { revision: lessonDirectionRevision(direction) }; else delete lesson.directionReview; onChange(); };
  label.append(review); root.append(label); report();
}
