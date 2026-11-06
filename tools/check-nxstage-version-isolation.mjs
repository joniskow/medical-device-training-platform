// Exercise real model manifests when checking whether saved positions can cross versions.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {applyPermittedTransform,validateAuthoritativeModelState,validateBrowserModelManifest} from '../packages/model-runtime/dist/browser.js';

const readManifest=async path=>validateBrowserModelManifest(JSON.parse(await readFile(path,'utf8')));
const active=await readManifest('fixtures/nxstage-system-one-interactive/model-manifest.json');
const review=await readManifest(`${process.env.NXSTAGE_REVIEW_MODEL_FOLDER ?? 'fixtures/nxstage-system-one-bowl-review'}/model-manifest.json`);
const initial=manifest=>({releaseBindingId:manifest.releaseBindingId,modelVersionId:manifest.modelVersionId,sequence:0,nextSequence:1,transforms:Object.fromEntries(manifest.components.map(c=>[c.componentId,{rotationY:0,translationX:0}])),scorePoints:0,completed:false,allowedActions:[]});
const oldState=initial(active),reviewState=initial(review);
assert(validateAuthoritativeModelState(active,oldState),'Existing model must accept its own initial state');
assert(validateAuthoritativeModelState(review,reviewState),'Review model must accept its own initial state');
assert(!validateAuthoritativeModelState(review,oldState),'Old model identity must not restore into the review model');
assert(!validateAuthoritativeModelState(active,reviewState),'Review model identity must not restore into the old model');

const door=review.components.find(c=>c.componentId==='nxstage-cycler-door');
const target=door.interactionTargets.find(t=>t.targetId==='NX-C03-CYCLER-DOOR');
const oldDoor=active.components.find(c=>c.componentId==='nxstage-cycler-door').interactionTargets.find(t=>t.targetId==='NX-C03-CYCLER-DOOR');
const wrongScale=structuredClone(reviewState);
wrongScale.transforms['nxstage-cycler-door'].translationX=oldDoor.openTranslationMeters;
wrongScale.transforms['nxstage-cycler-handle'].rotationY=target.openRequires.value;
assert(!validateAuthoritativeModelState(review,wrongScale),'A position from the old model scale must not be accepted by the review model');
const openWithoutHandle=structuredClone(reviewState);
openWithoutHandle.transforms['nxstage-cycler-door'].translationX=target.openTranslationMeters;
assert(!validateAuthoritativeModelState(review,openWithoutHandle),'An open door must still require the handle to be raised');
const openWithHandle=structuredClone(openWithoutHandle);
openWithHandle.transforms['nxstage-cycler-handle'].rotationY=target.openRequires.value;
assert(validateAuthoritativeModelState(review,openWithHandle),'A correctly scaled open door with raised handle must be accepted');
if(process.env.NXSTAGE_FINE_DRAG_CHECK==='1'){
  const cabinet=review.components.find(c=>c.componentId==='nxstage-cabinet-door');
  const tub=review.components.find(c=>c.componentId==='pureflow-tub');
  assert(Math.abs(cabinet.permittedTransforms.rotationY.snap-Math.PI/180)<1e-12,'Cabinet snap must be one degree');
  const nearOpen=structuredClone(reviewState);
  nearOpen.transforms['nxstage-cabinet-door']=applyPermittedTransform(cabinet,nearOpen.transforms['nxstage-cabinet-door'],{rotationY:-89*Math.PI/180});
  assert(validateAuthoritativeModelState(review,JSON.parse(JSON.stringify(nearOpen))),'A one-degree partial position must survive state serialization');
  const tubOpen=structuredClone(nearOpen);
  tubOpen.transforms['pureflow-tub']=applyPermittedTransform(tub,tubOpen.transforms['pureflow-tub'],{translationX:tub.permittedTransforms.translationX.snap});
  assert(!validateAuthoritativeModelState(review,tubOpen),'The tub must remain blocked when the cabinet is one degree short of fully open');
  tubOpen.transforms['nxstage-cabinet-door'].rotationY=-Math.PI/2;
  assert(validateAuthoritativeModelState(review,JSON.parse(JSON.stringify(tubOpen))),'A fine tub position with the cabinet fully open must be accepted');
  tubOpen.transforms['nxstage-cabinet-door']=nearOpen.transforms['nxstage-cabinet-door'];
  assert(!validateAuthoritativeModelState(review,tubOpen),'The cabinet must not close onto a partially extended tub');
}
console.log('NxStage model version, transform-scale and door dependency isolation verified.');
