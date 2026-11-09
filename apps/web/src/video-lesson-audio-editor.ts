/** These controls save the script separately from provider pronunciation aliases. */
export function renderVideoLessonAudioEditor(scene: Record<string, unknown>, onChange: () => void): HTMLElement {
  const box = document.createElement('fieldset'), legend = document.createElement('legend'); legend.textContent = 'Narration delivery'; box.append(legend);
  const saved = scene.narrationDelivery && typeof scene.narrationDelivery === 'object' ? scene.narrationDelivery as Record<string, unknown> : {};
  const rate = document.createElement('input'); rate.type = 'number'; rate.min = '0.75'; rate.max = '1.25'; rate.step = '0.05'; rate.value = String(saved.rate ?? 1);
  const emphasis = document.createElement('select'); for (const value of ['none', 'reduced', 'moderate']) { const option = document.createElement('option'); option.value = value; option.textContent = value; emphasis.append(option); } emphasis.value = String(saved.emphasis ?? 'none');
  const pauses = document.createElement('textarea'); pauses.value = Array.isArray(saved.pauses) ? saved.pauses.map(p => `${p.afterText} | ${p.milliseconds}`).join('\n') : '';
  const glossary = document.createElement('textarea'); glossary.value = Array.isArray(saved.pronunciations) ? saved.pronunciations.map(p => `${p.term} | ${p.alias}`).join('\n') : '';
  for (const [title, input] of [['Pace (0.75 to 1.25)', rate], ['Emphasis', emphasis], ['Observation pauses: unique script phrase | milliseconds (one per line)', pauses], ['Pronunciation glossary: script term | spoken alias (one per line)', glossary]] as const) { const label = document.createElement('label'); label.append(document.createTextNode(title), input); box.append(label); }
  const note = document.createElement('p'); note.textContent = 'Delivery edits require new speech, timing, captions and listening review. Listen to actual speech against the unchanged script; silent previews cannot establish pronunciation or intelligibility.'; box.append(note);
  const parse = (input: HTMLTextAreaElement, first: string, second: string, number = false) => input.value.split('\n').filter(line => line.trim()).map(line => { const [a, ...b] = line.split('|'); return { [first]: a!.trim(), [second]: number ? Number(b.join('|').trim()) : b.join('|').trim() }; });
  const update = () => { scene.narrationDelivery = { rate: Number(rate.value), emphasis: emphasis.value, pauses: parse(pauses, 'afterText', 'milliseconds', true), pronunciations: parse(glossary, 'term', 'alias') }; onChange(); };
  for (const input of [rate, emphasis, pauses, glossary]) input.addEventListener('input', update);
  const savedMix = scene.audioMix && typeof scene.audioMix === 'object' ? scene.audioMix as Record<string, unknown> : {};
  const speechOnly = document.createElement('input'); speechOnly.type = 'checkbox'; speechOnly.checked = savedMix.speechOnly !== false;
  const soundLabel = document.createElement('label'); soundLabel.append(speechOnly, document.createTextNode('Speech only (omit device sounds)')); box.append(soundLabel);
  const visual = scene.visual && typeof scene.visual === 'object' ? scene.visual as Record<string, unknown> : {};
  if (visual.kind === 'source_video' && typeof visual.assetVersionId === 'string') {
    const assetVersionId = visual.assetVersionId;
    const citeVideo = document.createElement('button'); citeVideo.type = 'button'; citeVideo.textContent = `Cite source video ${assetVersionId} for reviewed instructional sound`;
    const cited = () => Array.isArray(scene.citations) && scene.citations.some(c => c && typeof c === 'object' && c.assetVersionId === assetVersionId);
    citeVideo.disabled = !!cited();
    citeVideo.addEventListener('click', () => { if (!cited()) { scene.citations = [...(Array.isArray(scene.citations) ? scene.citations : []), {assetVersionId}]; onChange(); } citeVideo.disabled = true; });
    box.append(citeVideo);
  }
  const sounds = document.createElement('textarea'); sounds.value = Array.isArray(savedMix.instructionalSounds) ? savedMix.instructionalSounds.map(s => `${s.assetVersionId} | ${s.evidenceId} | ${s.sourceStartSeconds} | ${s.durationSeconds} | ${s.atSeconds}`).join('\n') : '';
  const bindingLabel = document.createElement('label'); bindingLabel.append(document.createTextNode('Verified source-video sound: asset version | reviewed evidence ID | source start | duration | scene offset (seconds; one per line)'), sounds); box.append(bindingLabel);
  const soundNote = document.createElement('p'); soundNote.textContent = 'Only exact intervals independently marked as verified instructional sound in the approved asset manifest can be mixed. The video must be the cited source visual. Source start and scene offset must match to preserve synchronization; alternate takes require separate sound review. Arbitrary evidence IDs and ambient sound are rejected.'; box.append(soundNote);
  const updateMix = () => { scene.audioMix = { speechOnly: speechOnly.checked, instructionalSounds: sounds.value.split('\n').filter(line => line.trim()).map(line => { const [assetVersionId = '', evidenceId = '', sourceStartSeconds, durationSeconds, atSeconds] = line.split('|').map(v => v.trim()); return {assetVersionId, evidenceId, sourceStartSeconds: Number(sourceStartSeconds), durationSeconds: Number(durationSeconds), atSeconds: Number(atSeconds)}; }) }; onChange(); };
  speechOnly.addEventListener('change', updateMix); sounds.addEventListener('input', updateMix);
  return box;
}
