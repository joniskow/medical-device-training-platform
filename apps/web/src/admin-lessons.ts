import {renderVideoLessonAudioEditor} from './video-lesson-audio-editor.js';
import {renderLessonDirectionEditor} from './video-lesson-editor.js';
import {isCurrentLessonRenderManifest, lessonRenderRevision} from '@medical-device/contracts';

type Services = {
  api<T = any>(path: string, init?: RequestInit): Promise<T>;
  content(path: string): Promise<Blob>;
  wait(load: () => Promise<any>, status: string, label: string): Promise<any>;
  run(button: HTMLButtonElement, status: string, action: () => Promise<void>): void;
  signal: AbortSignal;
};
const node = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '') => { const item = document.createElement(tag); item.textContent = text; return item; };
function playbackInputs(content: any, lessonId: string): string {
  const copy = structuredClone(content);
  const lesson = copy.videoLessons?.find((item: any) => item.lessonId === lessonId);
  // A completed render updates these fields. Other content changes require reopening
  // the course, rather than rebasing stale form values onto a newer saved revision.
  if (lesson) for (const key of ['roughCut', 'renderArtifact', 'previewAcceptance', 'finalReview', 'publishBinding']) delete lesson[key];
  const canonical = (value: any): any => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)])) : value;
  return JSON.stringify(canonical(copy));
}

/** Uses the same versioned course and private render APIs as the full editor. */
export function renderAdminLessons(host: HTMLElement, initial: any, services: Services) {
  let course = structuredClone(initial), revision = course.revision;
  const lessons = course.content?.videoLessons;
  if (!Array.isArray(lessons) || !lessons.length) return;
  const root = node('section'), urls = new Set<string>(); host.append(root);
  const active = () => { services.signal.throwIfAborted(); if (!root.isConnected) throw Error('Open the current course again before continuing.'); };
  const dispose = () => { for (const video of root.querySelectorAll('video')) { video.pause(); video.removeAttribute('src'); video.load(); } for (const url of urls) URL.revokeObjectURL(url); urls.clear(); observer.disconnect(); services.signal.removeEventListener('abort', dispose); };
  const observer = new MutationObserver(() => { if (!root.isConnected) dispose(); }); observer.observe(document.body, {childList: true, subtree: true}); services.signal.addEventListener('abort', dispose, {once: true});
  root.append(node('h3', 'Speech & narrated lessons'), node('p', 'Edit narration, pace, emphasis, pronunciation and pauses. Save, render, then listen to the actual video with captions. Default: English narration, normal pace, speech only. Emphasis uses the Azure Jane voice; normal narration uses Jenny.'));
  for (const lesson of lessons) {
    const lessonUrls = new Set<string>();
    const objectUrl = (blob: Blob) => { const url = URL.createObjectURL(blob); urls.add(url); lessonUrls.add(url); return url; };
    const details = node('details'), title = node('summary', lesson.title ?? lesson.lessonId); details.append(title); root.append(details);
    const fields = node('fieldset'); details.append(fields);
    const status = node('p', 'Review the source-linked script and shot plan before rendering.'); status.setAttribute('role', 'status');
    let dirty = false, epoch = 0;
    const player = node('video'); player.controls = true; player.preload = 'metadata'; player.hidden = true; player.style.width = '100%'; player.setAttribute('aria-label', 'Generated lesson with speech and captions');
    const transcript = node('pre'); transcript.hidden = true;
    const reviewed = node('input'); reviewed.type = 'checkbox';
    const accept = node('button', 'Accept reviewed rough cut'); accept.type = 'button'; accept.disabled = true;
    const changed = () => { dirty = true; epoch++; reviewed.checked = false; accept.disabled = true; player.pause(); player.hidden = true; transcript.hidden = true; status.textContent = 'Unsaved changes. Save and render again to refresh speech, timing and captions.'; };
    renderLessonDirectionEditor(fields, lesson, changed);
    for (const scene of lesson.scenes ?? []) {
      const group = node('details'); group.append(node('summary', `Speech for ${scene.sceneId}`)); fields.append(group);
      if (lesson.direction?.beats?.some((item: any) => item.sceneId === scene.sceneId)) {
        group.append(node('p', 'Edit the narration in Script and shot plan above. That single script supplies speech and captions.'));
      } else {
        const label = node('label', 'Narration transcript'), text = node('textarea'); text.value = scene.narration ?? ''; label.append(text); group.append(label);
        text.oninput = () => { scene.narration = text.value; delete lesson.directionReview; changed(); };
      }
      group.append(renderVideoLessonAudioEditor(scene, changed));
    }
    fields.append(node('p', 'Reviewed device-sound bindings are available above. Hosted rendering supports generated speech. Verified device-sound mixing and recorded narration currently require the advanced rendering CLI; those two workflows are not hosted on this page.'));
    const save = node('button', 'Save speech & lesson settings'); save.type = 'button';
    const saveDraft = async () => {
      active(); const result = await services.api(`/api/v1/course-versions/${encodeURIComponent(course.courseVersionId)}`, {method: 'PUT', body: JSON.stringify({revision, content: course.content})}); active();
      revision = result.revision; course.revision = revision; dirty = false;
    };
    save.onclick = () => services.run(save, 'learning-status', async () => { fields.disabled = true; try { await saveDraft(); status.textContent = `Settings saved, revision ${revision}. Render to hear the result.`; } finally { fields.disabled = false; } });
    fields.append(save);
    const reviewLabel = node('label'); reviewLabel.append(reviewed, document.createTextNode(' I watched and listened to this complete rough cut and checked pronunciation, timing and captions.'));
    reviewed.onchange = () => { accept.disabled = !reviewed.checked || Boolean(player.hidden) || dirty; };
    let currentManifest: any;
    const playback = async (jobId: string, mode: 'rough-cut' | 'final', result?: any) => {
      active();
      if (dirty) throw Error('Save your changes and render again before loading playback.');
      const attempt = epoch, expectedInputs = playbackInputs(course.content, lesson.lessonId);
      result ??= await services.api(`/api/v1/lesson-renders/${encodeURIComponent(jobId)}`);
      const prefix = `/api/v1/lesson-renders/${encodeURIComponent(jobId)}/content`;
      const [video, captions, latest] = await Promise.all([services.content(prefix + '?kind=video'), services.content(prefix + '?kind=captions'), services.api(`/api/v1/course-versions/${encodeURIComponent(course.courseVersionId)}`)]);
      active();
      if (epoch !== attempt || dirty) throw Error('Lesson changed while loading playback. Save and render the current settings.');
      const saved = latest.courseVersion.content.videoLessons.find((item: any) => item.lessonId === lesson.lessonId);
      if (!saved || !isCurrentLessonRenderManifest(result.manifest, saved)) throw Error('The generated result is stale. Open the saved course again.');
      if (expectedInputs !== playbackInputs(latest.courseVersion.content, lesson.lessonId)) throw Error('Course changed elsewhere. Reopen the saved course before editing or loading playback; your current form has not overwritten it.');
      course = latest.courseVersion; revision = course.revision;
      for (const key of Object.keys(lesson)) delete lesson[key];
      Object.assign(lesson, saved); course.content.videoLessons = course.content.videoLessons.map((item: any) => item.lessonId === lesson.lessonId ? lesson : lessons.find((old: any) => old.lessonId === item.lessonId) ?? item);
      player.pause(); for (const url of lessonUrls) { URL.revokeObjectURL(url); urls.delete(url); } lessonUrls.clear();
      player.replaceChildren(); player.src = objectUrl(video); const track = node('track'); track.kind = 'captions'; track.srclang = 'en'; track.label = 'English'; track.default = true; track.src = objectUrl(captions); player.append(track); player.hidden = false;
      transcript.textContent = await captions.text(); transcript.hidden = false; currentManifest = result.manifest;
      reviewed.checked = false; accept.disabled = true; reviewLabel.hidden = mode !== 'rough-cut';
      status.textContent = mode === 'rough-cut' ? 'Speech and captions are ready. Listen and inspect the complete result before accepting.' : 'Final video is ready. Independent audiovisual review is still required before publishing.';
    };
    const render = (mode: 'rough-cut' | 'final') => {
      const button = node('button', mode === 'rough-cut' ? 'Render speech, captions & rough cut' : 'Render final lesson'); button.type = 'button';
      button.onclick = () => services.run(button, 'learning-status', async () => {
        fields.disabled = true; reviewed.checked = false; accept.disabled = true; const attempt = ++epoch;
        try {
          active();
          if ((lesson.scenes ?? []).some((scene: any) => scene.audioMix?.speechOnly === false)) throw Error('Hosted device-sound review is not configured. Choose speech only or use the full verified-source rendering workflow.');
          if (dirty) await saveDraft();
          const signature = JSON.stringify([course.courseVersionId, lesson.lessonId, revision, mode]);
          const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(signature)))].map(byte => byte.toString(16).padStart(2, '0')).join('');
          const admitted = await services.api('/api/v1/lesson-renders', {method: 'POST', headers: {'idempotency-key': 'admin-render:' + digest}, body: JSON.stringify({courseVersionId: course.courseVersionId, revision, lessonId: lesson.lessonId, mode})});
          status.textContent = `Rendering ${admitted.jobId}. Keep this result open to load playback.`;
          const result = await services.wait(() => services.api(`/api/v1/lesson-renders/${encodeURIComponent(admitted.jobId)}`), 'learning-status', 'Narrated lesson');
          active(); if (epoch !== attempt) throw Error('Lesson changed during rendering. Open its current saved result.');
          await playback(admitted.jobId, mode, result);
        } finally { fields.disabled = false; }
      }); return button;
    };
    for (const [property, mode] of [['roughCut', 'rough-cut'], ['renderArtifact', 'final']] as const) {
      const artifact = lesson[property], match = typeof artifact?.outputPath === 'string' && /\/derived\/lessons\/([^/]+)\/lease-\d+\/lesson\.mp4$/.exec(artifact.outputPath);
      if (match) { const play = node('button', mode === 'rough-cut' ? 'Play saved rough cut' : 'Play saved final video'); play.type = 'button'; play.onclick = () => services.run(play, 'learning-status', async () => { fields.disabled = true; try { await playback(decodeURIComponent(match[1]!), mode); } finally { fields.disabled = false; } }); fields.append(play); }
    }
    accept.onclick = () => services.run(accept, 'learning-status', async () => {
      active(); if (!reviewed.checked || dirty || !currentManifest || currentManifest.mode !== 'rough-cut' || currentManifest.inputRevision !== lessonRenderRevision(lesson)) throw Error('Review a current rough cut first.');
      lesson.previewAcceptance = {inputRevision: currentManifest.inputRevision, artifactId: currentManifest.artifactId}; await saveDraft(); status.textContent = 'Current rough cut accepted. You can render the final lesson.';
    });
    fields.append(render('rough-cut'), render('final')); details.append(status, player, transcript, reviewLabel, accept);
  }
}
