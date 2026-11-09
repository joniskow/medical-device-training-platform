import {currentPreviewAccepted, isCurrentLessonRenderManifest, lessonRenderRevision, type LessonRenderManifest} from '@medical-device/contracts';
import {getSessionIdentity} from './auth-session.js';

/** Imported local media stays local; only review metadata participates in existing draft autosave. */
export function renderLessonRoughCutEditor(parent: HTMLElement, lesson: Record<string, unknown>, onChange: () => void, onFinalImported?: () => void): void {
  const root = document.createElement('fieldset'); root.dataset.roughCutEditor = 'true';
  const legend = document.createElement('legend'); legend.textContent = 'Narrated rough cut'; root.append(legend); parent.append(root);
  const help = document.createElement('p'); help.textContent = 'Export this lesson, run the developer render command, then import the resulting manifest and matching MP4. Review sound and motion, record timestamped corrections, then accept the current preview. Local media must be reopened after reload.'; root.append(help);
  const exportButton = document.createElement('button'); exportButton.type = 'button'; exportButton.textContent = 'Export lesson for rendering';
  exportButton.onclick = () => { const url = URL.createObjectURL(new Blob([JSON.stringify({videoLessons:[lesson]}, null, 2)], {type:'application/json'})); const a = document.createElement('a'); a.href = url; a.download = 'lesson-draft.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 0); }; root.append(exportButton);
  const command = document.createElement('pre'); command.textContent = `node tools/render-video-lesson.mjs --draft lesson-draft.json --lesson ${String(lesson.lessonId)} --output output/lesson --mode rough-cut --assets assets.json --recordings recordings.json`; root.append(command);
  const label = document.createElement('label'); label.textContent = 'Render manifest JSON'; const manifestInput = document.createElement('input'); manifestInput.type = 'file'; manifestInput.accept = '.json,application/json'; label.append(manifestInput); root.append(label);
  const mediaLabel = document.createElement('label'); mediaLabel.textContent = 'Matching rough-cut or final MP4'; const mediaInput = document.createElement('input'); mediaInput.type = 'file'; mediaInput.accept = 'video/mp4'; mediaLabel.append(mediaInput); root.append(mediaLabel);
  const player = document.createElement('video'); player.controls = true; player.preload = 'metadata'; player.style.maxWidth = '100%'; player.setAttribute('aria-label', 'Narrated rough cut playback'); root.append(player);
  const status = document.createElement('p'); status.setAttribute('role', 'status'); root.append(status);
  const accept = document.createElement('button'); accept.type = 'button'; accept.textContent = 'Accept reviewed rough cut'; accept.disabled = true; root.append(accept);
  let manifest: LessonRenderManifest | undefined, playbackUrl = '', importEpoch = 0, disposed = false;
  const identity = getSessionIdentity();
  const active = (epoch: number) => !disposed && root.isConnected && epoch === importEpoch && identity === getSessionIdentity();
  const dispose = () => {
    if (disposed) return;
    disposed = true; importEpoch++; accept.disabled = true;
    player.pause(); player.removeAttribute('src'); player.load();
    if (playbackUrl) URL.revokeObjectURL(playbackUrl);
    playbackUrl = ''; observer.disconnect(); window.removeEventListener('pagehide', dispose);
  };
  const observer = new MutationObserver(() => { if (!root.isConnected) dispose(); });
  observer.observe(document.body, {childList: true, subtree: true});
  window.addEventListener('pagehide', dispose, {once: true});
  const refresh = () => { const existing = lesson.roughCut as LessonRenderManifest | undefined; status.textContent = existing ? existing.inputRevision === lessonRenderRevision(lesson) ? 'Preview matches current production inputs. Open its matching MP4 to review.' : 'Preview is stale. Render again after edits.' : 'No rough cut imported.'; accept.disabled = true; };
  const load = async () => {
    const epoch = ++importEpoch; accept.disabled = true;
    try {
      const manifestFile = manifestInput.files?.[0], mediaFile = mediaInput.files?.[0];
      if (!manifestFile || !mediaFile) return;
      const parsed = JSON.parse(await manifestFile.text()) as LessonRenderManifest;
      if (!active(epoch)) return;
      if (!isCurrentLessonRenderManifest(parsed, lesson)) throw Error('Import a complete render manifest matching the current scene timeline and lesson inputs.');
      if (parsed.mode === 'final' && (parsed.placeholders.length || !currentPreviewAccepted(lesson))) throw Error('Final imports require an accepted current rough cut and no unfinished shots.');
      const bytes = await mediaFile.arrayBuffer(); const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2,'0')).join('');
      if (!active(epoch)) return;
      if (hash !== parsed.sha256) throw Error('The MP4 does not match the render manifest hash.');
      if (parsed.inputRevision !== lessonRenderRevision(lesson)) throw Error('Lesson changed during import. Render again.');
      if (parsed.mode === 'final') {
        if (!currentPreviewAccepted(lesson)) throw Error('Preview acceptance changed during import. Review and accept the current rough cut before importing final output.');
        lesson.renderArtifact = parsed; delete lesson.finalReview; onChange();
        status.textContent = 'Final artifact verified and imported. Upload this exact MP4 through media review, then record its independent audiovisual review.';
        onFinalImported?.(); return;
      }
      manifest = parsed; lesson.roughCut = parsed; delete lesson.previewAcceptance; delete lesson.finalReview; onChange();
      if (playbackUrl) URL.revokeObjectURL(playbackUrl); playbackUrl = URL.createObjectURL(mediaFile); player.src = playbackUrl;
      status.textContent = `Verified rough cut. ${parsed.placeholders.length ? `Unfinished shots: ${parsed.placeholders.join(', ')}.` : 'All source shots present.'} Inspect the complete sound and motion before acceptance.`;
      accept.disabled = false;
    } catch (error) { if (!active(epoch)) return; manifest = undefined; status.textContent = error instanceof Error ? error.message : String(error); }
  };
  manifestInput.onchange = () => { void load(); }; mediaInput.onchange = () => { void load(); };
  accept.onclick = () => { if (!active(importEpoch)) return; if (!manifest || manifest.inputRevision !== lessonRenderRevision(lesson)) {refresh(); return;} lesson.previewAcceptance = {inputRevision: manifest.inputRevision, artifactId: manifest.artifactId}; onChange(); status.textContent = 'Current rough cut accepted. Any production-input edit makes this acceptance stale. Final output still needs independent review.'; };
  const defectLabel = document.createElement('label'); defectLabel.textContent = 'Timestamped correction (pacing, framing or instruction)'; const correction = document.createElement('textarea'); defectLabel.append(correction); root.append(defectLabel);
  const flag = document.createElement('button'); flag.type = 'button'; flag.textContent = 'Flag current playback timestamp';
  flag.onclick = () => {if (!manifest || !correction.value.trim()) return; const defects = (lesson.roughCutDefects ??= []) as unknown[]; defects.push({artifactId: manifest.artifactId, inputRevision: manifest.inputRevision, atSeconds: player.currentTime, correction: correction.value.trim()}); delete lesson.previewAcceptance; onChange(); correction.value = ''; status.textContent = `Correction saved at ${player.currentTime.toFixed(2)}s. Revise the script, shot or observation hold, then render again.`;}; root.append(flag);
  const transition = document.createElement('p'); transition.textContent = 'Assembly uses clean cuts. Edit result observation holds and scene timings in the shot plan; narration must fit before the required result hold. Mandatory evidence and warnings remain required.'; root.append(transition);
  const scenes = lesson.scenes as Array<{sceneId: string; startSeconds: number; endSeconds: number}>;
  for (const scene of scenes ?? []) {
    const durationLabel = document.createElement('label'); durationLabel.textContent = `Scene ${scene.sceneId} duration (seconds; following scenes shift together)`;
    const duration = document.createElement('input'); duration.type = 'number'; duration.min = '2'; duration.max = '300'; duration.step = '0.1'; duration.value = String(scene.endSeconds-scene.startSeconds); durationLabel.append(duration); root.append(durationLabel);
    duration.onchange = () => {
      const next = Number(duration.value), previous = scene.endSeconds-scene.startSeconds;
      const beat = (lesson.direction as {beats?:Array<{sceneId:string;observationHoldSeconds:number}>})?.beats?.find(b=>b.sceneId===scene.sceneId);
      if (!Number.isFinite(next) || next <= (beat?.observationHoldSeconds ?? 1) || next < 2 || Number(lesson.durationSeconds)+next-previous > 300 || Number(lesson.durationSeconds)+next-previous < 30) {duration.value=String(previous);status.textContent='Keep a 30–300 second lesson and preserve the required result observation hold.';return;}
      const difference=next-previous; let after=false;
      for (const entry of scenes) {if (entry===scene) {entry.endSeconds+=difference;after=true;} else if (after) {entry.startSeconds+=difference;entry.endSeconds+=difference;}}
      lesson.durationSeconds=Number(lesson.durationSeconds)+difference;
      delete lesson.previewAcceptance; delete lesson.renderArtifact; delete lesson.finalReview; manifest=undefined; accept.disabled=true; onChange(); refresh();
    };
  }
  refresh();
}
