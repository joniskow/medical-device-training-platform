import { addSceneTake, sceneTakeBinding, sceneTakeState, selectSceneTake, validateSceneTakeState, type SceneTake, type SceneTakeState, type TakeLesson } from '@medical-device/simulation-schema';

/** Alternate manifests and selection are saved by the existing revision-checked draft API. */
export function renderLessonSceneRevisionEditor(parent: HTMLElement, value: Record<string, unknown>, onChange: () => void): void {
  const lesson = value as TakeLesson;
  if (!Array.isArray(lesson.scenes) || !lesson.direction?.beats) return;
  const root = document.createElement('fieldset'), title = document.createElement('legend'); title.textContent = 'Compare takes and correct individual scenes'; root.append(title); parent.append(root);
  const note = document.createElement('p'); note.textContent = 'Generate a bounded alternate from approved source footage using the scene-take command, import its manifest, then load the matching video to compare. Only the selected visual changes; narration and source claims stay bound to the reviewed shot. A detail crop requires careful label and warning inspection.'; root.append(note);
  const download = document.createElement('button'); download.type = 'button'; download.textContent = 'Export current lesson for scene generation';
  download.onclick = () => { const url = URL.createObjectURL(new Blob([JSON.stringify(lesson, null, 2)], { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = 'lesson-for-scene-takes.json'; link.click(); URL.revokeObjectURL(url); }; root.append(download);
  const command = document.createElement('code'); command.textContent = 'node tools/generate-lesson-scene-take.mjs lesson.json correction.json approved-assets.json output/scenes'; root.append(command);
  const status = document.createElement('p'); status.setAttribute('role', 'status'); root.append(status);
  const updateStatus = () => { const state = lesson.sceneTakes as SceneTakeState | undefined; status.textContent = state ? `${state.attempts.length}/${state.budget} generation attempts used; up to ${state.maxPerScene} per scene. Failed attempts also count.` : 'Default budget: 12 attempts total, at most 3 per scene. Limits may be reduced in the exported lesson before generation.'; };
  const importLabel = document.createElement('label'); importLabel.textContent = 'Import generated take manifest'; const importer = document.createElement('input'); importer.type = 'file'; importer.accept = '.json,application/json'; importLabel.append(importer); root.append(importLabel);
  importer.onchange = async () => {
    try {
      const file = importer.files?.[0]; if (!file || file.size > 2 * 1024 * 1024) throw Error('Choose a take manifest smaller than 2 MB.');
      const manifest = JSON.parse(await file.text()) as { schemaVersion: string; take: SceneTake; attempts: SceneTakeState['attempts']; maxPerScene: number; budget: number };
      if (manifest.schemaVersion !== 'scene-take-import.v1' || !Array.isArray(manifest.attempts)) throw Error('Use the manifest emitted by scene generation.');
      const candidate = structuredClone(lesson), state = sceneTakeState(candidate);
      // Import can never reset consumed attempts or increase a saved budget.
      if (manifest.maxPerScene > state.maxPerScene || manifest.budget > state.budget) throw Error('The imported manifest cannot increase the saved budget.');
      state.maxPerScene = manifest.maxPerScene; state.budget = manifest.budget;
      for (const attempt of manifest.attempts) { const previous = state.attempts.find(a => a.attemptId === attempt.attemptId); if (previous && JSON.stringify(previous) !== JSON.stringify(attempt)) throw Error('Attempt identity conflict.'); if (!previous) state.attempts.push(attempt); }
      addSceneTake(candidate, manifest.take);
      const report = validateSceneTakeState(candidate); if (!report.valid) throw Error(report.findings.map(f => f.message).join(' '));
      lesson.sceneTakes = candidate.sceneTakes; onChange(); renderTakes(); updateStatus();
    } catch (error) { status.textContent = error instanceof Error ? error.message : 'Take import failed.'; }
  };
  const list = document.createElement('div'); root.append(list);
  const renderTakes = () => {
    list.replaceChildren();
    const state = lesson.sceneTakes as SceneTakeState | undefined;
    for (const scene of lesson.scenes) {
      const box = document.createElement('fieldset'), legend = document.createElement('legend'); legend.textContent = `Scene ${scene.sceneId}: ${scene.startSeconds}–${scene.endSeconds}s`; box.append(legend); list.append(box);
      const example = document.createElement('pre'); example.textContent = JSON.stringify({ sceneId: scene.sceneId, framing: 'fit', correction: { atSeconds: scene.startSeconds, defect: 'Describe the observed defect', requestedCorrection: 'Describe the bounded framing correction' } }, null, 2); box.append(example);
      for (const take of state?.takes.filter(t => t.sceneId === scene.sceneId) ?? []) {
        const row = document.createElement('fieldset'), name = document.createElement('legend'); name.textContent = `${take.takeId}${state!.selected[scene.sceneId] === take.takeId ? ' (selected)' : ''}`; row.append(name); box.append(row);
        const provenance = document.createElement('pre'); provenance.textContent = `${JSON.stringify(take.provenance, null, 2)}\nAt ${take.correction.atSeconds}s: ${take.correction.defect}\nCorrection: ${take.correction.requestedCorrection}\nSHA-256: ${take.artifact.sha256}`; row.append(provenance);
        const inputLabel = document.createElement('label'); inputLabel.textContent = 'Load matching take video for comparison'; const file = document.createElement('input'); file.type = 'file'; file.accept = 'video/mp4'; inputLabel.append(file); row.append(inputLabel);
        const video = document.createElement('video'); video.controls = true; video.preload = 'metadata'; video.width = 480; row.append(video);
        const checkedLabel = document.createElement('label'), checked = document.createElement('input'); checked.type = 'checkbox'; checked.disabled = true; checkedLabel.append(checked, document.createTextNode('I inspected the complete motion, labels and transitions against this shot/source.')); row.append(checkedLabel);
        const select = document.createElement('button'); select.type = 'button'; select.textContent = 'Select this take'; select.disabled = true; row.append(select);
        let binding = ''; try { binding = sceneTakeBinding(lesson, scene.sceneId); } catch { /* stale shot */ }
        let url: string | undefined;
        file.onchange = async () => { try { select.disabled = true; checked.checked = false; checked.disabled = true; const clip = file.files?.[0]; if (!clip || clip.size > 128 * 1024 * 1024) throw Error('Choose a matching MP4 smaller than 128 MB.'); const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await clip.arrayBuffer()))].map(v => v.toString(16).padStart(2, '0')).join(''); if (hash !== take.artifact.sha256) throw Error('Video hash differs from the generated take.'); if (url) URL.revokeObjectURL(url); url = URL.createObjectURL(clip); video.src = url; checked.disabled = false; } catch (error) { status.textContent = String(error); } };
        checked.onchange = () => { select.disabled = !checked.checked; };
        select.onclick = () => { try { selectSceneTake(lesson, scene.sceneId, take.takeId, binding); onChange(); status.textContent = 'Take selected. Final assembly and audiovisual review are now stale; render a new rough cut and review it.'; renderTakes(); } catch (error) { status.textContent = String(error); } };
        window.addEventListener('pagehide', () => { if (url) URL.revokeObjectURL(url); }, { once: true });
      }
    }
  };
  renderTakes(); updateStatus();
}
