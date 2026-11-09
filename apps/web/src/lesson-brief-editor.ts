import {validateLessonBrief, invalidateBriefArtifacts} from '@medical-device/simulation-schema';

/** All controls are native labeled fields; applying participates in normal draft autosave. */
export function renderLessonBriefEditor(root: HTMLElement, content: Record<string, unknown>, onChange: () => void): void {
  const box = document.createElement('fieldset'), legend = document.createElement('legend');
  legend.textContent = 'Instructional brief and reference pack'; box.append(legend);
  const saved = content.lessonBrief && typeof content.lessonBrief === 'object' && !Array.isArray(content.lessonBrief) ? content.lessonBrief as Record<string, unknown> : {};
  const brief: Record<string, any> = structuredClone({schemaVersion:'lesson-brief.v1',format:'orientation', ...saved,referencePack:{approvedViewIds:[],sourceArtifactIds:[],exactLabels:[],permittedStates:[],permittedActions:[],terminology:[],...(saved.referencePack && typeof saved.referencePack === 'object' && !Array.isArray(saved.referencePack) ? saved.referencePack : {})}});
  const pack = brief.referencePack;
  const field = (labelText: string, value: unknown, update: (value: string) => void) => {
    const label = document.createElement('label'), input = document.createElement('textarea');
    label.append(document.createTextNode(labelText)); input.value = typeof value === 'string' ? value : ''; input.maxLength = 12000;
    input.oninput = () => update(input.value); label.append(input); box.append(label);
  };
  for (const [key,label] of [['audience','Audience'],['priorKnowledge','Prior knowledge'],['task','Task or opening problem'],['objective','Learning objective'],['deviceRevision','Device / source revision'],['setting','Teaching setting']]) field(label,brief[key],value=>brief[key]=value);
  const formatLabel = document.createElement('label'), format = document.createElement('select'); formatLabel.append(document.createTextNode('Teaching format'));
  for (const name of ['orientation','procedure','troubleshooting','refresher']) format.add(new Option(name,name));
  format.value = brief.format; format.onchange = () => {brief.format=format.value;}; formatLabel.append(format); box.append(formatLabel);
  for (const [key,label] of [['sourceArtifactIds','Reviewed source version IDs'],['approvedViewIds','Approved reference view media version IDs'],['exactLabels','Exact label / display text'],['permittedStates','Permitted states'],['permittedActions','Permitted actions'],['terminology','Reviewed terminology / pronunciation']]) field(`${label} (one per line)`,Array.isArray(pack[key])?pack[key].join('\n'):'',value=>pack[key]=value.split('\n').map(item=>item.trim()).filter(Boolean));
  field('Visual conventions: palette, typography, lighting, camera and orientation',pack.visualConventions,value=>pack.visualConventions=value);
  const note = document.createElement('p'); note.textContent='Bind reviewed source versions and approved views selected for generation. Photos support orientation; procedure, troubleshooting and refresher demonstrations require approved video evidence. Applying changes makes generated lessons stale and requires regeneration.';
  const status = document.createElement('p'); status.setAttribute('role','status');
  const apply = document.createElement('button'); apply.type='button'; apply.textContent='Apply instructional brief';
  apply.onclick=()=>{
    const validation=validateLessonBrief(brief);
    if(!validation.valid){status.textContent=validation.findings.map(item=>item.message).join(' ');return;}
    const next=invalidateBriefArtifacts(content,{...content,lessonBrief:brief}); Object.assign(content,next); onChange(); status.textContent='Brief applied. Save completes through the draft autosave; generation uses this saved revision.';
  };
  box.append(note,apply,status);root.append(box);
}
