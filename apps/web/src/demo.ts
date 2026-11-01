import { createBabylonModelRuntime } from './babylon-model-runtime.js';
import type { ModelRuntime } from './model-contract.js';

type View = 'creator' | 'learner' | 'lesson';
type Module = { title: string; type: string; minutes: number; description: string; completed: boolean };
type SourceStage = 'upload' | 'processing' | 'model' | 'content';
type SourceKind = 'photos' | 'pdf';
type CreatorStep = 'source' | 'convert' | 'model' | 'content' | 'build' | 'publish';
type DemoState = { view: View; published: boolean; learnerProgress: number; currentLesson: number; selectedModule: number | null; editingModule: number | null; creatorStep: CreatorStep; sourceStage: SourceStage; sourceKind: SourceKind; sourceFiles: string[]; sourcePreviewDataUrl: string; demoSource: boolean; sourceFileName: string; sourceProgress: number; videoPlaying: boolean; answer: 'idle' | 'correct' | 'incorrect'; modules: Module[] };

const defaultState: DemoState = {
  view: 'creator', published: false, learnerProgress: 33, currentLesson: 0, selectedModule: null, editingModule: null, creatorStep: 'source', sourceStage: 'upload', sourceKind: 'photos', sourceFiles: [], sourcePreviewDataUrl: '', demoSource: false, sourceFileName: '', sourceProgress: 0, videoPlaying: false, answer: 'idle',
  modules: [
    { title: 'The Aurora controller at a glance', type: 'Reading', minutes: 8, description: 'Orientation to the device, controls, and safety language.', completed: true },
    { title: 'Recognize the flow path', type: 'Interactive lesson', minutes: 12, description: 'Trace the fluid path and identify the clamp sequence.', completed: false },
    { title: 'Set up a safe infusion', type: 'Knowledge check', minutes: 10, description: 'Practice the pre-use checklist with confidence.', completed: false },
  ],
};

const app = document.querySelector<HTMLDivElement>('#app')!;
const storageKey = 'aurora-training-demo-v4';
let state = loadState();
let toastTimer: number | undefined;
let conversionTimer: number | undefined;
let demoModelRuntime: ModelRuntime | undefined;
let demoModelGeneration = 0;
let sourcePreviewUrls: string[] = [];

function loadState(): DemoState {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) ?? 'null') as Partial<DemoState> | null;
    if (saved?.modules?.length) return { ...defaultState, ...saved, selectedModule: saved.selectedModule ?? null, editingModule: null, videoPlaying: false, answer: 'idle', sourceKind: saved.sourceKind === 'pdf' ? 'pdf' : 'photos', sourceFiles: Array.isArray(saved.sourceFiles) ? saved.sourceFiles as string[] : [], sourcePreviewDataUrl: typeof saved.sourcePreviewDataUrl === 'string' ? saved.sourcePreviewDataUrl : '', demoSource: saved.demoSource === true, modules: saved.modules as Module[] };
  } catch { /* demo starts clean when storage is unavailable */ }
  return structuredClone(defaultState);
}

function saveState() {
  try { localStorage.setItem(storageKey, JSON.stringify(state)); } catch { /* optional persistence */ }
}

function icon(name: string, size = 17): string {
  const paths: Record<string, string> = {
    grid: '<rect x="3" y="3" width="6" height="6" rx="1"/><rect x="15" y="3" width="6" height="6" rx="1"/><rect x="3" y="15" width="6" height="6" rx="1"/><rect x="15" y="15" width="6" height="6" rx="1"/>',
    pen: '<path d="m4 20 4.2-1 10.6-10.6a2.5 2.5 0 0 0-3.5-3.5L4.7 15.5 4 20Z"/><path d="m14 6 4 4"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    chart: '<path d="M4 19V5M4 19h17"/><path d="m7 15 3-4 3 2 5-7"/>',
    book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    back: '<path d="m15 18-6-6 6-6"/><path d="M9 12h10"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    edit: '<path d="M12 20h9"/><path d="m16.5 3.5 4 4L12 16l-5 1 1-5 8.5-8.5Z"/>',
    play: '<path d="m8 5 11 7-11 7V5Z"/>',
    pause: '<path d="M8 5v14M16 5v14"/>',
    spark: '<path d="m12 3-1.5 6.5L4 11l6.5 1.5L12 19l1.5-6.5L20 11l-6.5-1.5L12 3Z"/>',
    shield: '<path d="M12 3 20 6v5c0 5-3.4 8.4-8 10-4.6-1.6-8-5-8-10V6l8-3Z"/><path d="m8.5 12 2.3 2.3 4.7-4.7"/>',
  };
  return `<svg aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths[name] ?? paths.grid}</svg>`;
}

function navItem(view: View, label: string, iconName: string, active: boolean, ariaLabel?: string, action: 'navigate' | 'placeholder' = 'navigate'): string {
  return `<button class="nav-item ${active ? 'active' : ''}" data-action="${action}" data-view="${view}" data-placeholder="${label}" aria-label="${ariaLabel ?? label}">${icon(iconName)}<span>${label}</span></button>`;
}

function shell(content: string, title: string): string {
  return `<div class="app-shell">
    <aside class="sidebar" aria-label="Primary navigation">
      <div class="brand"><div class="brand-mark">A</div><div class="brand-copy"><div class="brand-name">Aurora</div><div class="brand-caption">Training hub</div></div></div>
      <div><div class="nav-label">Workspace</div><div class="nav-stack">
        ${navItem('creator', 'Creator studio', 'pen', state.view === 'creator')}
        ${navItem('learner', 'Learner view', 'book', state.view === 'learner')}
      </div></div>
      <div class="sidebar-bottom"><div class="profile-chip"><div class="avatar">MC</div><div class="profile-copy"><div class="profile-name">Maya Chen</div><span class="profile-role">Training lead</span></div></div></div>
    </aside>
    <main class="main">
      <header class="topbar"><div class="crumbs"><span>Aurora Training Hub</span><span>›</span><strong>${title}</strong></div><div class="top-actions"><div class="demo-state"><span class="status-dot"></span>Local demo</div><button class="outline-btn" data-action="reset">Reset demo</button>${state.view !== 'lesson' ? `<button class="primary-btn lime" data-action="toggle-view">${state.view === 'creator' ? 'Preview as learner' : 'Open creator studio'} ${icon('arrow', 14)}</button>` : ''}</div></header>
      ${content}
    </main>
  </div>`;
}

function deviceArt(): string {
  return `<svg viewBox="0 0 480 250" role="img" aria-label="Illustration of the Aurora infusion controller">
    <path d="M58 147c0-27 22-49 49-49h48l27-43h138c18 0 32 14 32 32v85H58v-25Z" fill="#f7f3df" stroke="#173c3a" stroke-width="3"/>
    <path d="M156 98h196v74H156z" fill="#d7e7df" stroke="#173c3a" stroke-width="3"/>
    <path d="M183 116h78v39h-78z" fill="#173c3a"/><path d="M195 128h54M195 137h37" stroke="#c8ef71" stroke-width="4" stroke-linecap="round"/>
    <circle cx="296" cy="136" r="18" fill="#eb9a78" stroke="#173c3a" stroke-width="3"/><path d="M290 136h12M296 130v12" stroke="#173c3a" stroke-width="2"/>
    <path d="M352 128h48c18 0 28 14 28 28v22h-76" fill="none" stroke="#173c3a" stroke-width="3"/>
    <path d="M112 196c-5 22-24 29-45 29M422 197c4 21 19 28 38 28" fill="none" stroke="#173c3a" stroke-width="3" stroke-linecap="round"/>
    <path d="M87 225h65M394 225h66" stroke="#173c3a" stroke-width="3" stroke-linecap="round"/>
    <circle cx="122" cy="124" r="8" fill="#c8ef71" stroke="#173c3a" stroke-width="2"/><path d="M122 116v16M114 124h16" stroke="#173c3a" stroke-width="1.5"/>
  </svg>`;
}

function sourceStepIndex(): number { return ({ upload: 0, processing: 1, model: 2, content: 3 } as Record<SourceStage, number>)[state.sourceStage]; }

function renderSourcePipeline(): string {
  const active = sourceStepIndex();
  const stages: Array<[SourceStage, string, string]> = [['upload', 'Upload source', 'PDF / images'], ['processing', 'Convert', 'Extract + structure'], ['model', '3D model', 'Interactive preview'], ['content', 'Training content', 'Generated lesson']];
  const stageButtons = stages.map(([stage, label, detail], index) => `<button class="source-step ${state.sourceStage === stage ? 'current' : ''} ${index < active ? 'done' : ''}" data-action="source-stage" data-stage="${stage}" aria-current="${state.sourceStage === stage ? 'step' : 'false'}"><span class="source-step-number">${index < active ? icon('check', 11) : index + 1}</span><span><strong>${label}</strong><small>${detail}</small></span></button>`).join('');
  let body = '';
  if (state.sourceStage === 'upload') body = `<div class="source-upload"><label class="source-dropzone" for="source-file"><span class="upload-icon">${icon('plus', 19)}</span><span><strong>Drop a product source here</strong><small>PDF, image, or scanned guide · up to 50 MB</small></span><input id="source-file" type="file" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg" /></label><div class="source-upload-actions"><span class="muted">No source selected yet</span><button class="primary-btn" data-action="simulate-upload">${icon('spark', 14)} Use demo PDF</button></div></div>`;
  if (state.sourceStage === 'processing') body = `<div class="processing-panel"><div class="processing-header"><div><p class="eyebrow">Converting source</p><h3>${escapeHtml(state.sourceFileName || 'Aurora setup guide.pdf')}</h3><p class="muted">Building a source-grounded learning experience from the uploaded guide.</p></div><strong class="processing-percent">${state.sourceProgress}%</strong></div><div class="progress-track processing-track"><div class="progress-bar" style="width:${state.sourceProgress}%"></div></div><div class="processing-steps"><span class="${state.sourceProgress >= 28 ? 'done' : ''}">${icon(state.sourceProgress >= 28 ? 'check' : 'spark', 13)} Extracting sections</span><span class="${state.sourceProgress >= 55 ? 'done' : ''}">${icon(state.sourceProgress >= 55 ? 'check' : 'spark', 13)} Mapping device components</span><span class="${state.sourceProgress >= 82 ? 'done' : ''}">${icon(state.sourceProgress >= 82 ? 'check' : 'spark', 13)} Generating lesson structure</span></div></div>`;
  if (state.sourceStage === 'model') body = `<div class="model-preview-panel"><div class="model-canvas-wrap"><canvas id="demo-model-canvas" aria-label="Interactive 3D Aurora infusion controller model"></canvas><span class="model-badge">${icon('spark', 12)} Live 3D preview</span></div><div class="model-preview-copy"><p class="eyebrow">Converted model</p><h3>Aurora infusion controller</h3><p class="muted">The source guide is now connected to a selectable, interactive 3D model with named components.</p><div class="component-chips"><button class="component-chip" data-action="select-demo-component" data-component="AIC-C01">Control panel</button><button class="component-chip" data-action="select-demo-component" data-component="AIC-C02">Safety cover</button><button class="component-chip" data-action="select-demo-component" data-component="AIC-C03">Line sensor</button></div><div class="model-actions"><button class="outline-btn" data-action="reset-demo-model">Reset view</button><button class="primary-btn" data-action="source-stage" data-stage="content">Continue to training content ${icon('arrow', 14)}</button></div><p id="demo-model-status" class="model-status" role="status" aria-live="polite">Loading approved model…</p></div></div>`;
  if (state.sourceStage === 'model' && state.demoSource) body = `${renderNxStageReference()}${body}`;
  if (state.sourceStage === 'content') body = `<div class="content-preview-panel"><div class="generated-video ${state.videoPlaying ? 'playing' : ''}"><div class="video-topline"><span class="tag lime">Generated lesson video</span><span class="mono">02:14</span></div>${renderTrainingScene()}<div class="video-controls"><span class="video-progress"><span style="width:${state.videoPlaying ? '46%' : '18%'}"></span></span><span class="mono">00:${state.videoPlaying ? '59' : '24'}</span></div></div><div class="content-preview-copy"><p class="eyebrow">Generated from ${escapeHtml(state.sourceFileName || 'Aurora setup guide.pdf')}</p><h3>Ready-to-teach content, grounded in the source</h3><p class="muted">The lesson now uses a real video plate with the approved Babylon model composited above it. Production camera pose, scale, and reviewer sign-off stay bound to the scenario manifest.</p><div class="generated-list"><span>${icon('check', 13)} 1 source-bound video/model scene</span><span>${icon('check', 13)} 3-step guided procedure</span><span>${icon('check', 13)} 1 knowledge check with feedback</span></div><button class="primary-btn" data-action="open-generated-lesson">Open as learner ${icon('arrow', 14)}</button></div></div>`;
  return `<section class="card source-pipeline"><div class="source-pipeline-header"><div><p class="eyebrow">From source to learning</p><h2>Turn a product guide into training people can use.</h2><p class="muted">Upload a source, watch the conversion, then hand the result to your learner.</p></div><span class="tag ${state.sourceStage === 'content' ? 'lime' : 'yellow'}">${state.sourceStage === 'upload' ? 'Start with a source' : state.sourceStage === 'processing' ? 'Converting now' : state.sourceStage === 'model' ? 'Model ready' : 'Content ready'}</span></div><div class="source-steps">${stageButtons}</div><div class="source-pipeline-body">${body}</div></section>`;
}

const creatorFlow: Array<[CreatorStep, string, string]> = [
  ['source', 'Start with the source', 'Upload the product guide that contains the knowledge your team needs.'],
  ['convert', 'Convert the source', 'We extract the important sections and map them to the device.'],
  ['model', 'Inspect the 3D model', 'Explore the converted model before you build the lesson.'],
  ['content', 'Review generated content', 'See the lesson video, procedure, and knowledge check together.'],
  ['build', 'Shape the course', 'Edit the learning path and make the course feel like yours.'],
  ['publish', 'Publish to learners', 'Review the release summary, then make it available.'],
];

function creatorStepIndex(): number { return creatorFlow.findIndex(([step]) => step === state.creatorStep); }

function renderSourceUpload(): string {
  const photos = state.sourceKind === 'photos';
  const files = state.sourceFiles.length ? `<div class="source-file-list"><div class="source-file-list-head"><strong>${state.sourceFiles.length} ${photos ? 'photos' : 'source file'} selected</strong><span class="muted">${photos ? 'Ready for reconstruction' : 'Ready for conversion'}</span></div><div class="source-file-chips">${state.sourceFiles.slice(0, 8).map((file) => `<span class="source-file-chip">${escapeHtml(file)}</span>`).join('')}${state.sourceFiles.length > 8 ? `<span class="source-file-chip more">+${state.sourceFiles.length - 8} more</span>` : ''}</div></div>` : '';
  return `<div class="focus-upload"><div class="source-mode-picker" role="group" aria-label="Choose a source type"><button class="source-mode ${photos ? 'active' : ''}" data-action="choose-source-kind" data-kind="photos">${icon('grid', 14)} Product photos <small>3D reconstruction</small></button><button class="source-mode ${!photos ? 'active' : ''}" data-action="choose-source-kind" data-kind="pdf">${icon('book', 14)} Guide PDF <small>Video + lesson</small></button></div><label class="focus-dropzone" for="source-file"><span class="upload-icon">${icon('plus', 19)}</span><span><strong>${photos ? 'Upload multiple product photos' : 'Upload a product guide PDF'}</strong><small>${photos ? 'Use 20–100 overlapping views for the strongest reconstruction.' : 'PDF guide · up to 50 MB'}</small></span><input id="source-file" type="file" ${photos ? 'multiple' : ''} accept="${photos ? '.png,.jpg,.jpeg,image/png,image/jpeg' : '.pdf,application/pdf'}" /></label>${files}<div class="focus-upload-footer"><span class="muted">${state.sourceFileName ? escapeHtml(state.sourceFileName) : photos ? 'Use the sample photo set to see a matched 3D result.' : 'Use the sample guide for the demo.'}</span><div class="source-demo-actions">${photos ? `<button class="outline-btn" data-action="simulate-upload" data-kind="photos">${icon('spark', 14)} Use demo photo set</button>` : ''}<button class="primary-btn" data-action="simulate-upload" data-kind="pdf">${icon('spark', 14)} Use demo PDF</button></div></div></div>`;
}

function currentPhotoPreviewUrls(): string[] {
  return sourcePreviewUrls.length ? sourcePreviewUrls : state.demoSource ? Array.from({ length: 8 }, (_, index) => `/demo-assets/view-${String(index).padStart(3, '0')}.png`) : [];
}

function renderNxStageReference(): string {
  if (!state.demoSource) return '';
  return `<div class="nxstage-reference-card"><div class="nxstage-reference-image"><img src="/demo-assets/nxstage-system-one-preview.png" alt="Generated NxStage System One preview based on the uploaded reference photos" /><span class="model-badge">${icon('spark', 12)} Generated visual preview</span></div><div class="nxstage-reference-copy"><p class="eyebrow">Photo-grounded reference</p><h3>NxStage System One preview</h3><p class="muted">This is the generated image from the photo review. It is a 2D reference inside the demo; the Babylon canvas below is still the existing interactive Aurora model.</p></div></div>`;
}

function renderTrainingScene(): string {
  return `<div class="training-scene" data-scene-manifest="/model/aurora-training-scene-manifest.json"><video id="training-video" class="training-scene-video" src="/demo-assets/aic-priming-demo.mp4" muted loop playsinline preload="metadata" aria-label="Aurora priming video plate"></video><canvas id="demo-scene-canvas" class="training-scene-model" aria-label="Approved Aurora model composited over the training video"></canvas><span class="video-caption">How to prime the Aurora controller</span><button class="video-play" data-action="toggle-video" aria-label="${state.videoPlaying ? 'Pause' : 'Play'} generated lesson">${icon(state.videoPlaying ? 'pause' : 'play', 20)}</button><span class="scene-status" id="demo-model-status" role="status" aria-live="polite">Loading source-bound scene…</span></div>`;
}

function renderPhotoEvidence(): string {
  const firstPreview = currentPhotoPreviewUrls()[0];
  const preview = firstPreview ? `<img src="${firstPreview}" alt="Uploaded product photo" />` : `<div class="photo-placeholder">${icon('grid', 26)}<span>Uploaded photos are available for reconstruction.</span></div>`;
  return `<div class="photo-reconstruction"><div class="photo-evidence"><div class="photo-evidence-label">Source evidence</div>${preview}<span class="photo-count">${state.sourceFiles.length} photos</span></div><div class="photo-reconstruction-copy"><p class="eyebrow">Custom photo set</p><h3>Photos received. Reconstruction is queued.</h3><p class="muted">This preview stays tied to your actual upload. A production run would now align the views, generate a mesh, and return it for review.</p><div class="reconstruction-status"><span class="status-dot"></span><strong>Awaiting reconstruction worker</strong><small>Review required before publishing</small></div><div class="source-file-chips">${state.sourceFiles.slice(0, 5).map((file) => `<span class="source-file-chip">${escapeHtml(file)}</span>`).join('')}</div></div></div>`;
}

function renderPhotoModelDraft(): string {
  const preview = currentPhotoPreviewUrls()[0] || state.sourcePreviewDataUrl;
  return `<div class="photo-model-draft"><div class="photo-model-stage"><div class="photo-model-shell">${preview ? `<img src="${preview}" alt="Generated preview from uploaded product photo" />` : `<div class="photo-placeholder">${icon('grid', 26)}<span>Re-upload a photo to show the source-bound preview.</span></div>`}</div><span class="model-badge">${icon('spark', 12)} Photo-linked model draft</span></div><div class="photo-model-copy"><p class="eyebrow">Generated from your upload</p><h3>Your source is now visible in the model step.</h3><p class="muted">This draft keeps the uploaded image attached to the reconstruction while the full photogrammetry worker generates reviewable geometry.</p><div class="reconstruction-status"><span class="status-dot"></span><strong>Draft preview ready</strong><small>${state.sourceFiles.length} source photos · review required</small></div><button class="outline-btn" data-action="back-to-source">Replace photo set</button></div></div>`;
}

function renderCreatorRail(): string {
  const active = creatorStepIndex();
  return `<nav class="focus-rail" aria-label="Course creation steps">${creatorFlow.map(([step, label], index) => `<button class="focus-rail-step ${state.creatorStep === step ? 'current' : ''} ${index < active ? 'done' : ''}" data-action="go-creator-step" data-step="${step}" aria-current="${state.creatorStep === step ? 'step' : 'false'}"><span>${index < active ? icon('check', 11) : index + 1}</span><strong>${label}</strong></button>`).join('')}</nav>`;
}

function renderCreator(): string {
  const index = Math.max(0, creatorStepIndex());
  const [, title, description] = creatorFlow[index];
  const selected = state.selectedModule === null ? undefined : state.modules[state.selectedModule];
  const editing = selected && state.editingModule === state.selectedModule;
  const moduleEditor = !selected ? `<div class="focus-empty"><span class="module-num">+</span><div><strong>Choose a module to edit</strong><p>Select a row and its fields will open here.</p></div></div>` : editing ? `<div class="focus-editor"><p class="eyebrow">Editing module ${String((state.selectedModule ?? 0) + 1).padStart(2, '0')}</p><label class="edit-field">Module title<input id="edit-module-title" maxlength="120" value="${escapeHtml(selected.title)}" /></label><label class="edit-field">Description<textarea id="edit-module-description" maxlength="240">${escapeHtml(selected.description)}</textarea></label><div class="focus-actions"><button class="outline-btn" data-action="cancel-edit">Cancel</button><button class="primary-btn" data-action="save-module" data-index="${state.selectedModule}">${icon('check', 13)} Save changes</button></div></div>` : `<div class="focus-selection"><div><p class="eyebrow">Selected module</p><h3>${escapeHtml(selected.title)}</h3><p>${escapeHtml(selected.description)}</p></div><button class="outline-btn" data-action="edit-module" data-index="${state.selectedModule}">${icon('edit', 13)} Edit details</button></div>`;
  let body = '';
  if (state.creatorStep === 'source') body = renderSourceUpload();
  if (state.creatorStep === 'convert') body = state.sourceProgress < 100 ? `<div class="focus-processing"><div class="processing-header"><div><p class="eyebrow">Converting source</p><h3>${escapeHtml(state.sourceFileName || 'Aurora setup guide.pdf')}</h3></div><strong class="processing-percent">${state.sourceProgress}%</strong></div><div class="progress-track processing-track"><div class="progress-bar" style="width:${state.sourceProgress}%"></div></div><div class="processing-steps"><span class="${state.sourceProgress >= 28 ? 'done' : ''}">${icon(state.sourceProgress >= 28 ? 'check' : 'spark', 13)} Extracting sections</span><span class="${state.sourceProgress >= 55 ? 'done' : ''}">${icon(state.sourceProgress >= 55 ? 'check' : 'spark', 13)} Mapping device components</span><span class="${state.sourceProgress >= 82 ? 'done' : ''}">${icon(state.sourceProgress >= 82 ? 'check' : 'spark', 13)} Generating lesson structure</span></div></div>` : `<div class="focus-complete"><span class="complete-mark">${icon('check', 20)}</span><div><p class="eyebrow">Conversion complete</p><h3>${escapeHtml(state.sourceFileName || 'Aurora setup guide.pdf')} is ready.</h3><p class="muted">The source is structured and connected to the next two steps.</p></div><button class="primary-btn" data-action="creator-next">Open 3D model ${icon('arrow', 14)}</button></div>`;
  if (state.creatorStep === 'model') body = state.sourceKind === 'photos' && !state.demoSource ? renderPhotoModelDraft() : `${renderNxStageReference()}<div class="focus-model"><div class="model-canvas-wrap"><canvas id="demo-model-canvas" aria-label="Interactive 3D Aurora infusion controller model"></canvas><span class="model-badge">${icon('spark', 12)} ${state.demoSource ? 'Matched demo reconstruction' : 'Reference 3D preview'}</span></div><div class="focus-model-copy"><p class="eyebrow">${state.demoSource ? 'Reconstructed from the sample photo set' : 'Reference model'}</p><h3>Aurora training controller</h3><p class="muted">Drag to rotate, use the wheel to zoom, or select a component to inspect it.</p><div class="component-chips"><button class="component-chip" data-action="select-demo-component" data-component="AIC-C01">Control panel</button><button class="component-chip" data-action="select-demo-component" data-component="AIC-C02">Safety cover</button><button class="component-chip" data-action="select-demo-component" data-component="AIC-C03">Line sensor</button></div><p id="demo-model-status" class="model-status" role="status" aria-live="polite">Loading approved model…</p>${state.demoSource ? `<div class="demo-photo-strip">${currentPhotoPreviewUrls().slice(0, 3).map((url, photoIndex) => `<img src="${url}" alt="Sample reconstruction source view ${photoIndex + 1}" />`).join('')}<span>24 source views</span></div>` : ''}</div></div>`;
  if (state.creatorStep === 'content') body = `<div class="focus-content"><div class="generated-video ${state.videoPlaying ? 'playing' : ''}"><div class="video-topline"><span class="tag lime">Generated lesson video</span><span class="mono">02:14</span></div>${renderTrainingScene()}<div class="video-controls"><span class="video-progress"><span style="width:${state.videoPlaying ? '46%' : '18%'}"></span></span><span class="mono">00:${state.videoPlaying ? '59' : '24'}</span></div></div><div class="focus-content-copy"><p class="eyebrow">Generated from ${escapeHtml(state.sourceFileName || 'Aurora setup guide.pdf')}</p><h3>Ready-to-teach content, grounded in the source</h3><p class="muted">The approved model is rendered by Babylon over the source-bound video plate. The scenario manifest carries asset hashes and camera data; production pose and physical validation remain required.</p><div class="generated-list"><span>${icon('check', 13)} 1 source-bound video/model scene</span><span>${icon('check', 13)} 3-step guided procedure</span><span>${icon('check', 13)} 1 knowledge check with feedback</span></div></div></div>`;
  if (state.creatorStep === 'build') body = `<div class="focus-build"><div class="focus-build-head"><div><h3>Course modules</h3><p class="muted">Keep the path short and focused. Click one module to edit it.</p></div><button class="outline-btn" data-action="add-module">${icon('plus', 14)} Add module</button></div><div class="module-list compact">${state.modules.map((module, moduleIndex) => `<article class="module-row clickable ${state.selectedModule === moduleIndex ? 'selected' : ''}" tabindex="0" role="button" data-action="select-module" data-index="${moduleIndex}" aria-label="Edit module ${moduleIndex + 1}: ${escapeHtml(module.title)}"><div class="module-num">${String(moduleIndex + 1).padStart(2, '0')}</div><div><h3>${escapeHtml(module.title)}</h3><p>${escapeHtml(module.description)}</p></div><span class="tag ${module.completed ? 'lime' : 'gray'}">${module.completed ? 'Complete' : module.type}</span></article>`).join('')}</div>${moduleEditor}</div>`;
  if (state.creatorStep === 'publish') body = `<div class="focus-publish"><div class="publish-summary"><span class="course-icon">${icon('shield', 22)}</span><div><p class="eyebrow">Release summary</p><h3>Aurora infusion controller · Fundamentals</h3><p class="muted">${state.modules.length} modules · ${state.modules.reduce((total, module) => total + module.minutes, 0)} minutes · Clinical specialists</p></div></div><div class="publish-checks"><span>${icon('check', 13)} Source evidence connected</span><span>${icon('check', 13)} 3D model preview approved</span><span>${icon('check', 13)} Learner knowledge check ready</span></div>${state.published ? `<div class="focus-complete"><span class="complete-mark">${icon('check', 20)}</span><div><p class="eyebrow">Published</p><h3>Your course is ready for learners.</h3><p class="muted">The published release is now visible in Learner view.</p></div><button class="primary-btn" data-action="toggle-view">Preview learner view ${icon('arrow', 14)}</button></div>` : `<button class="primary-btn" data-action="publish">Approve & publish course ${icon('arrow', 14)}</button>`}</div>`;
  const footer = state.creatorStep === 'source' ? '' : `<div class="focus-footer"><button class="text-btn" data-action="creator-back">${icon('back', 14)} Back</button>${state.creatorStep === 'build' ? `<button class="primary-btn" data-action="creator-next">Continue to publish ${icon('arrow', 14)}</button>` : state.creatorStep === 'publish' ? '' : `<button class="primary-btn" data-action="creator-next">Continue ${icon('arrow', 14)}</button>`}</div>`;
  return shell(`<div class="page focus-page"><div class="focus-heading"><div><p class="eyebrow">Creator studio · Step ${index + 1} of ${creatorFlow.length}</p><h1>${title}</h1><p class="lede">${description}</p></div><span class="tag ${state.published ? 'lime' : 'yellow'}">${state.published ? 'Published release' : 'Draft in progress'}</span></div><div class="focus-layout"><section class="card focus-card"><div class="focus-card-top">${renderCreatorRail()}</div><div class="focus-body">${body}</div>${footer}</section><aside class="focus-aside"><div class="focus-aside-block"><p class="eyebrow">What this step proves</p><strong>${state.creatorStep === 'source' ? 'Your source is the starting point.' : state.creatorStep === 'convert' ? 'The source can become structured learning.' : state.creatorStep === 'model' && state.sourceKind === 'photos' && !state.demoSource ? 'Your uploaded photos stay attached to the generated preview.' : state.creatorStep === 'model' ? 'The product can be explored in 3D.' : state.creatorStep === 'content' ? 'The output is ready to teach.' : state.creatorStep === 'build' ? 'The course reflects your expertise.' : 'Learners can start immediately.'}</strong></div><div class="focus-aside-block muted">You can revisit any completed step from the rail.</div></aside></div></div>`, 'Creator studio');
}

function renderLearner(): string {
  const nextIndex = state.modules.findIndex((module) => !module.completed);
  const currentIndex = nextIndex < 0 ? 0 : nextIndex;
  const next = state.modules[currentIndex] ?? defaultState.modules[1];
  const completed = state.modules.filter((module) => module.completed).length;
  return shell(`<div class="page learner-focus-page"><div class="focus-heading"><div><p class="eyebrow">Learner view · Maya Chen</p><h1>Your next step is clear.</h1><p class="lede">One lesson at a time. Finish the next activity, get feedback, and keep moving.</p></div><span class="tag lime">${state.published ? 'Published release' : 'Preview release'}</span></div><div class="learner-focus-layout"><section class="card learner-next-card"><div class="learner-next-copy"><p class="eyebrow">Up next · Module ${currentIndex + 1}</p><h2>${escapeHtml(next.title)}</h2><p>${escapeHtml(next.description)}</p><div class="next-meta"><span class="tag gray">${next.type}</span><span class="muted">${next.minutes} minutes</span></div><button class="primary-btn" data-action="open-module" data-index="${currentIndex}">${next.completed ? 'Review lesson' : 'Start lesson'} ${icon('arrow', 14)}</button></div><div class="learner-next-art">${deviceArt()}</div></section><aside class="learner-progress-card card"><p class="eyebrow">Your progress</p><strong class="progress-big">${state.learnerProgress}%</strong><div class="progress-track" style="margin:12px 0 17px"><div class="progress-bar" style="width:${state.learnerProgress}%"></div></div><p class="muted">${completed} of ${state.modules.length} lessons complete</p><div class="mini-course-map">${state.modules.map((module, index) => `<button class="mini-course-row ${index === currentIndex ? 'current' : ''}" data-action="open-module" data-index="${index}"><span class="lesson-state ${module.completed ? 'complete' : ''}">${module.completed ? icon('check', 11) : index + 1}</span><span>${escapeHtml(module.title)}</span></button>`).join('')}</div></aside></div><div class="learner-note">${icon('shield', 16)} <span>Complete the course and pass the knowledge check to earn the <strong>Device ready</strong> credential.</span></div></div>`, 'Learner view');
}

function renderLesson(): string {
  const index = state.currentLesson;
  const module = state.modules[index] ?? defaultState.modules[1];
  const lesson = index === 0 ? { label: 'Orientation', intro: 'Start with the parts of the Aurora controller you will use most often. A clear mental model makes every later setup step easier to verify.', points: [['01 · Screen', 'Read the current rate and status.'], ['02 · Controls', 'Use the dial to move through the setup.'], ['03 · Status', 'Use the light to confirm device state.']], question: 'Which area shows the current infusion rate?', answers: ['The status display', 'The docking clip', 'The power cable'], feedback: 'Correct. The status display is your source of truth.' } : index === 2 ? { label: 'Knowledge check', intro: 'Use the pre-use checklist to prepare a safe, repeatable infusion setup before connecting to a patient.', points: [['01 · Prime', 'Confirm the line is filled and air-free.'], ['02 · Open', 'Release the clamp before starting flow.'], ['03 · Confirm', 'Check the on-screen rate and status light.']], question: 'Which sequence is safe before starting flow?', answers: ['Prime, open, then confirm', 'Start, clamp, then disconnect', 'Skip the check when the screen is green'], feedback: 'Correct. Prime, open, then confirm is the safe sequence.' } : { label: 'Interactive lesson', intro: 'Before you touch the controls, orient yourself to the complete flow path. The Aurora controller uses a simple visual sequence so a specialist can confirm the setup at a glance.', points: [['01 · Prime', 'Confirm the line is filled and air-free.'], ['02 · Open', 'Release the clamp before starting flow.'], ['03 · Confirm', 'Check the on-screen rate and status light.']], question: 'What should you confirm before starting the flow?', answers: ['The screen is dimmed to save battery.', 'The clamp is open and the line is primed.', 'The device is disconnected from power.'], feedback: 'Correct. A primed, open flow path is the safe starting point.' };
  return shell(`<div class="page"><button class="text-btn" data-action="back-learner" style="margin-bottom:20px">${icon('back', 15)} Back to my course</button><div class="lesson-layout"><section class="card lesson-main"><div class="lesson-visual">${deviceArt()}</div><div class="lesson-body"><p class="eyebrow">Module ${index + 1} · ${lesson.label} · ${module.minutes} min</p><h2>${escapeHtml(module.title)}</h2><p>${lesson.intro}</p><div class="key-points">${lesson.points.map((point) => `<div class="key-point"><strong>${point[0]}</strong><span>${point[1]}</span></div>`).join('')}</div><div class="lesson-nav"><span class="muted">Lesson ${index + 1} of ${state.modules.length}</span>${state.answer === 'correct' ? `<button class="primary-btn" data-action="complete-lesson">Mark lesson complete ${icon('check', 14)}</button>` : `<span class="tag gray">Answer the check to continue</span>`}</div></div></section><aside class="card check-card"><div class="question-label">Knowledge check</div><h3>${lesson.question}</h3><div class="answer-list">${lesson.answers.map((answer, answerIndex) => `<button class="answer ${state.answer === 'incorrect' && answerIndex === 0 ? 'incorrect' : ''} ${state.answer === 'correct' && answerIndex === 0 ? 'correct' : ''}" data-action="answer" data-correct="${index === 0 ? answerIndex === 0 : index === 2 ? answerIndex === 0 : answerIndex === 1}">${answer}</button>`).join('')}</div>${state.answer === 'correct' ? `<div class="feedback success">${icon('check', 14)} ${lesson.feedback}</div>` : state.answer === 'incorrect' ? `<div class="feedback error">Not quite. Revisit the three-step flow path, then try again.</div>` : '<p class="muted" style="margin-top:14px">One answer · no penalty</p>'}</aside></div></div>`, `Lesson ${index + 1} · ${lesson.label}`);
}

function escapeHtml(value: string): string { return value.replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character] ?? character)); }
function persistPhotoPreview(file: File) {
  const save = (dataUrl: string) => { state.sourcePreviewDataUrl = dataUrl; saveState(); render(); };
  if (typeof createImageBitmap === 'function') {
    void createImageBitmap(file).then((bitmap) => { const canvas = document.createElement('canvas'); const scale = Math.min(1, 720 / Math.max(bitmap.width, bitmap.height)); canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale)); canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close(); save(canvas.toDataURL('image/jpeg', 0.72)); }).catch(() => undefined);
    return;
  }
  const reader = new FileReader(); reader.addEventListener('load', () => { if (typeof reader.result === 'string') save(reader.result); }); reader.readAsDataURL(file);
}
function startConversion(fileNames: string[], kind: SourceKind, previewUrls: string[] = [], demoSource = false) {
  window.clearInterval(conversionTimer);
  sourcePreviewUrls.forEach((url) => { if (url.startsWith('blob:')) URL.revokeObjectURL(url); });
  sourcePreviewUrls = previewUrls;
  state.sourceKind = kind;
  state.sourceFiles = fileNames;
  state.sourcePreviewDataUrl = '';
  state.demoSource = demoSource;
  state.sourceFileName = kind === 'photos' ? `${fileNames.length} product photos` : fileNames[0] ?? 'Aurora setup guide.pdf';
  state.creatorStep = 'convert';
  state.sourceStage = 'processing';
  state.sourceProgress = 12;
  state.videoPlaying = false;
  saveState();
  render();
  showToast(`${state.sourceFileName} uploaded — conversion started`);
  conversionTimer = window.setInterval(() => {
    state.sourceProgress = Math.min(100, state.sourceProgress + 22);
    if (state.sourceProgress >= 100) {
      window.clearInterval(conversionTimer);
      state.sourceStage = kind === 'photos' ? 'model' : 'content';
      saveState();
      render();
      showToast('Conversion complete — interactive model and lessons generated');
      return;
    }
    saveState();
    render();
  }, 600);
}

async function initDemoModel() {
  const canvas = app.querySelector<HTMLCanvasElement>('#demo-model-canvas, #demo-scene-canvas');
  if (!canvas) return;
  const generation = ++demoModelGeneration;
  const status = app.querySelector<HTMLElement>('#demo-model-status');
  const composite = canvas.id === 'demo-scene-canvas';
  const video = app.querySelector<HTMLVideoElement>('#training-video');
  const trainingModel = composite || state.demoSource;
  try {
    const runtime = await createBabylonModelRuntime({ canvas, manifestUrl: trainingModel ? '/model/aurora-training-manifest.json' : '/model-manifest.json', modelUrl: trainingModel ? '/model/aurora-training.glb' : '/model/aurora-infusion-controller.glb', transparentBackground: composite, interactiveCamera: !composite, camera: composite ? { alpha: -0.8, beta: Math.PI / 2.8, radius: 3, target: [0, 0, 0] } : undefined, onStateChange: (modelState) => {
      if (generation !== demoModelGeneration || !status) return;
      status.textContent = modelState.phase === 'READY' ? (composite ? 'Scene ready · source-bound video + Babylon model.' : 'Ready · drag to rotate, wheel to zoom, or select a component.') : modelState.phase === 'LOADING' ? 'Loading approved 3D model…' : `${modelState.phase}: ${modelState.errorMessage ?? 'Model preview unavailable.'}`;
    } });
    if (generation !== demoModelGeneration) { runtime.dispose(); return; }
    demoModelRuntime = runtime;
    if (composite && state.videoPlaying) void video?.play().catch(() => undefined);
  } catch (error) {
    if (generation === demoModelGeneration && status) status.textContent = `3D preview unavailable · ${error instanceof Error ? error.message : 'runtime error'}`;
  }
}

function render() {
  if (demoModelRuntime) { demoModelRuntime.dispose(); demoModelRuntime = undefined; demoModelGeneration += 1; }
  app.innerHTML = state.view === 'creator' ? renderCreator() : state.view === 'learner' ? renderLearner() : renderLesson();
  bindActions();
  void initDemoModel();
}
function showToast(message: string) { document.querySelector('.toast')?.remove(); const node = document.createElement('div'); node.className = 'toast'; node.setAttribute('role', 'status'); node.innerHTML = `${icon('check', 15)}<span>${escapeHtml(message)}</span>`; document.body.append(node); window.clearTimeout(toastTimer); toastTimer = window.setTimeout(() => node.remove(), 3300); }

function bindActions() {
  app.querySelectorAll<HTMLElement>('[data-action]').forEach((element) => element.addEventListener('click', (event) => {
    const action = element.dataset.action;
    if (action === 'choose-source-kind') {
      sourcePreviewUrls.forEach((url) => { if (url.startsWith('blob:')) URL.revokeObjectURL(url); });
      sourcePreviewUrls = [];
      state.sourceKind = element.dataset.kind === 'pdf' ? 'pdf' : 'photos';
      state.sourceFiles = [];
      state.sourcePreviewDataUrl = '';
      state.sourceFileName = '';
      state.demoSource = false;
      saveState();
      render();
    }
    if (action === 'simulate-upload') {
      if (element.dataset.kind === 'photos') {
        const names = Array.from({ length: 24 }, (_, index) => `aurora-view-${String(index + 1).padStart(2, '0')}.png`);
        const previews = Array.from({ length: 8 }, (_, index) => `/demo-assets/view-${String(index).padStart(3, '0')}.png`);
        startConversion(names, 'photos', previews, true);
      } else startConversion(['Aurora setup guide.pdf'], 'pdf');
    }
    if (action === 'go-creator-step') {
      const nextStep = element.dataset.step as CreatorStep;
      const nextIndex = creatorFlow.findIndex(([step]) => step === nextStep);
      if (nextIndex < 0) return;
      if (nextIndex >= 1 && !state.sourceFileName) { showToast('Upload a source before opening this step'); return; }
      if (nextIndex >= 2 && state.sourceProgress < 100) { showToast('Finish conversion before opening this step'); return; }
      state.creatorStep = nextStep;
      state.sourceStage = nextIndex >= 3 ? 'content' : nextIndex >= 2 ? 'model' : nextIndex === 1 ? 'processing' : 'upload';
      state.videoPlaying = false;
      saveState();
      render();
    }
    if (action === 'creator-next') {
      const currentIndex = Math.max(0, creatorStepIndex());
      const nextStep = creatorFlow[currentIndex + 1]?.[0];
      if (!nextStep) return;
      if (currentIndex === 0 && !state.sourceFileName) { showToast('Upload a source before continuing'); return; }
      if (currentIndex === 1 && state.sourceProgress < 100) { showToast('Finish conversion before continuing'); return; }
      state.creatorStep = nextStep;
      state.sourceStage = currentIndex + 1 >= 3 ? 'content' : currentIndex + 1 >= 2 ? 'model' : 'processing';
      state.videoPlaying = false;
      saveState();
      render();
    }
    if (action === 'creator-back') {
      const currentIndex = Math.max(0, creatorStepIndex());
      const previousStep = creatorFlow[currentIndex - 1]?.[0];
      if (!previousStep) return;
      state.creatorStep = previousStep;
      state.sourceStage = currentIndex - 1 >= 3 ? 'content' : currentIndex - 1 >= 2 ? 'model' : currentIndex - 1 === 1 ? 'processing' : 'upload';
      state.videoPlaying = false;
      saveState();
      render();
    }
    if (action === 'back-to-source') {
      state.creatorStep = 'source';
      state.sourceStage = 'upload';
      saveState();
      render();
    }
    if (action === 'select-module') { state.selectedModule = Number(element.dataset.index); state.editingModule = state.selectedModule; saveState(); render(); showToast('Inline editor opened'); }
    if (action === 'source-stage') { const nextStage = element.dataset.stage as SourceStage; const nextIndex = ({ upload: 0, processing: 1, model: 2, content: 3 } as Record<SourceStage, number>)[nextStage]; if (nextStage !== 'upload' && !state.sourceFileName) { showToast('Upload a source before opening this stage'); return; } if (nextIndex > sourceStepIndex() && state.sourceProgress < 100) { showToast('Conversion is still running'); return; } state.sourceStage = nextStage === 'processing' && state.sourceProgress >= 100 ? 'model' : nextStage; state.videoPlaying = false; saveState(); render(); }
    if (action === 'select-demo-component') { const component = element.dataset.component; if (component && demoModelRuntime) demoModelRuntime.selectComponent(component, 'COMPONENT_LIST'); const status = app.querySelector<HTMLElement>('#demo-model-status'); if (status) status.textContent = `Selected ${element.textContent?.trim() ?? 'component'} · use the canvas to inspect it.`; }
    if (action === 'reset-demo-model') { demoModelRuntime?.resetView(); }
    if (action === 'toggle-video') { state.videoPlaying = !state.videoPlaying; render(); }
    if (action === 'open-generated-lesson') { state.view = 'lesson'; state.currentLesson = Math.min(1, state.modules.length - 1); state.answer = 'idle'; saveState(); render(); }
    if (action === 'placeholder') showToast(`${element.dataset.placeholder ?? 'This area'} is outside the end-to-end demo story`);
    if (action === 'open-module') { state.view = 'lesson'; state.currentLesson = Number(element.dataset.index); state.answer = 'idle'; saveState(); render(); }
    if (action === 'navigate') { const view = element.dataset.view as View; state.view = view === 'learner' ? 'learner' : 'creator'; state.answer = 'idle'; saveState(); render(); }
    if (action === 'toggle-view' || action === 'preview-course') { state.view = state.view === 'creator' ? 'learner' : 'creator'; state.answer = 'idle'; saveState(); render(); showToast(state.view === 'learner' ? 'Learner preview opened' : 'Creator studio opened'); }
    if (action === 'open-lesson') { state.view = 'lesson'; state.currentLesson = state.modules.findIndex((module) => !module.completed); if (state.currentLesson < 0) state.currentLesson = 0; state.answer = 'idle'; saveState(); render(); }
    if (action === 'preview-module') { state.view = 'lesson'; state.currentLesson = Number(element.dataset.index); state.answer = 'idle'; saveState(); render(); }
    if (action === 'back-learner') { state.view = 'learner'; state.answer = 'idle'; saveState(); render(); }
    if (action === 'answer') { state.answer = element.dataset.correct === 'true' ? 'correct' : 'incorrect'; render(); }
    if (action === 'complete-lesson') { state.modules[state.currentLesson].completed = true; state.learnerProgress = Math.round((state.modules.filter((module) => module.completed).length / state.modules.length) * 100); state.view = 'learner'; state.answer = 'idle'; saveState(); render(); showToast('Lesson complete — your progress is saved'); }
    if (action === 'publish') { state.published = true; state.creatorStep = 'publish'; saveState(); render(); showToast('Course approved and published to learners'); }
    if (action === 'reset') { sourcePreviewUrls.forEach((url) => { if (url.startsWith('blob:')) URL.revokeObjectURL(url); }); sourcePreviewUrls = []; state = structuredClone(defaultState); saveState(); render(); showToast('Demo reset to the starting state'); }
    if (action === 'credential') showToast('Credential requirements: complete all modules and pass the check at 80%');
    if (action === 'add-module') { state.modules.push({ title: 'New module', type: 'Reading', minutes: 8, description: 'Add a focused learning objective for your team.', completed: false }); state.selectedModule = state.modules.length - 1; state.editingModule = state.modules.length - 1; saveState(); render(); showToast('New module added — edit its details below'); }
    if (action === 'edit-module') { const index = Number(element.dataset.index); state.selectedModule = index; state.editingModule = index; saveState(); render(); }
    if (action === 'cancel-edit') { state.editingModule = null; render(); }
    if (action === 'save-module') { const index = Number(element.dataset.index); const title = app.querySelector<HTMLInputElement>('#edit-module-title')?.value.trim() ?? ''; const description = app.querySelector<HTMLTextAreaElement>('#edit-module-description')?.value.trim() ?? ''; if (!title || !description) { showToast('Add a title and description before saving'); return; } state.modules[index].title = title; state.modules[index].description = description; state.selectedModule = index; state.editingModule = null; saveState(); render(); showToast('Module saved'); }
  }));
  app.querySelector<HTMLInputElement>('#source-file')?.addEventListener('change', (event) => { const files = Array.from((event.target as HTMLInputElement).files ?? []); if (!files.length) return; if (state.sourceKind === 'photos' && files.length < 3) { showToast('Choose at least 3 overlapping photos for reconstruction'); return; } const previews = state.sourceKind === 'photos' ? files.map((file) => URL.createObjectURL(file)) : []; startConversion(files.map((file) => file.name), state.sourceKind, previews, false); if (state.sourceKind === 'photos') persistPhotoPreview(files[0]); });
  app.querySelectorAll<HTMLElement>('[data-action][role="button"]').forEach((element) => element.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); element.click(); } }));
}

render();
