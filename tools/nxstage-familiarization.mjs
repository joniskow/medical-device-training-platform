/** Reviewable familiarization content. Publication still uses the normal independent review workflow. */
export function buildNxstageFamiliarization(manifest, { simulationDefinitionId, policyId, activityId }) {
  const component = id => { const found=manifest.components.find(item=>item.componentId===id);if(!found)throw Error(`Familiarization component missing: ${id}`);return found; };
  const handle=component('nxstage-cycler-handle'),door=component('nxstage-cycler-door');
  const handleTarget=handle.interactionTargets.find(target=>target.targetId==='NX-C04-CYCLER-HANDLE');
  const doorTarget=door.interactionTargets.find(target=>target.targetId==='NX-C03-CYCLER-DOOR');
  if(!Number.isFinite(handleTarget?.openRotationRadians)||!Number.isFinite(doorTarget?.openTranslationMeters))throw Error('Familiarization requires the bound handle and sliding-door movements.');
  const source='https://www.kidneyhealth.ca/wp/wp-content/uploads/50.20.08.pdf';
  const briefing='Explore the modeled cycler handle and upper door, inspect the modeled opening, then return both parts to their starting positions. This is a familiarization exercise using an unmeasured visual reconstruction. The chamber is simplified. Treatment settings, consumables and patient care are outside this exercise. No credential is issued.';
  const recipe=[
    ['identify-handle','Identify the cycler handle',{type:'select_component',componentId:handle.componentId},'Find the handle above the upper cycler door. Select it in the model or component list.',['Look above the upper cycler door.','Choose “Cycler door handle” in the component list.']],
    ['identify-door','Identify the upper cycler door',{type:'select_component',componentId:door.componentId},'Identify the upper sliding door, separate from the lower cabinet door.',['Look at the door attached to the cycler control fascia.','Choose “Upper cycler door” in the component list.']],
    ['raise-handle','Raise the cycler handle',{type:'transform_component',componentId:handle.componentId,transform:{rotationY:handleTarget.openRotationRadians}},'Raise the modeled handle before opening the upper door. Keep the handle raised while the door is open.',['The door is held by the handle dependency.','Use Lift for the cycler handle, or drag the handle upward.']],
    ['open-door','Open the upper cycler door',{type:'transform_component',componentId:door.componentId,transform:{translationX:doorTarget.openTranslationMeters}},'Move the upper door to its fully open modeled position while the handle remains raised. The front panel travels with the door.',['Keep the handle raised.','Use Open for the upper cycler door, or drag it fully open.']],
    ['inspect-opening','Inspect the modeled opening',{type:'inspect_component',componentId:door.componentId},'Look into the modeled opening and acknowledge the simplified chamber. Hidden geometry, sensors and cartridge placement are not established by this reconstruction. This step confirms visual inspection of the model only.',['Use Focus to view the door area.','Read the chamber limitation, then choose Confirm inspection.']],
    ['close-door','Return the upper door to its closed position',{type:'transform_component',componentId:door.componentId,transform:{translationX:0}},'Return the empty modeled door fully to its starting position before lowering the handle. This is a model reset task, not a complete device setup procedure.',['Keep the handle raised while moving the door.','Use Close for the upper door.']],
    ['lower-handle','Return the handle to its starting position',{type:'transform_component',componentId:handle.componentId,transform:{rotationY:0}},'Lower the handle after the modeled door is fully closed. Review your actions and any recovered mistakes in the debrief.',['Check that the upper door is fully closed.','Use Lower for the cycler handle.']]
  ];
  const steps=recipe.map(([stepId,title,action,,hints],index)=>({stepId,title,action,nextStepIds:recipe[index+1]?[recipe[index+1][0]]:[],points:1,hints}));
  return {
    title:'NxStage System One — handle and door familiarization',briefing,
    evidence:{status:'REVIEW_REQUIRED',sources:[{url:source,title:'Manitoba Renal Program 50.20.08',pages:[1,2],scope:'Reference for opening order; not acceptance of the reconstructed geometry or a treatment procedure.'}],modelHash:manifest.sourceHash,limitations:['Unmeasured geometry','Simplified chamber','Closing sequence is a model reset task','Independent variant-matched review required before pilot use']},
    definition:{schemaVersion:'simulation-definition.v1',simulationDefinitionId,version:1,model:{modelVersionId:manifest.modelVersionId,manifestHash:manifest.sourceHash,componentIds:manifest.components.map(item=>item.componentId)},
      components:manifest.components.map(item=>({componentId:item.componentId,initialState:'idle',allowedActions:['select_component','transform_component','inspect_component','request_hint']})),
      initialState:{currentStepId:steps[0].stepId,variables:{},componentStates:Object.fromEntries(manifest.components.map(item=>[item.componentId,'idle']))},steps,faults:[],
      scoring:{maxScore:steps.length,passScore:1,stepPoints:Object.fromEntries(steps.map(step=>[step.stepId,1])),faultPoints:{},penalties:{}},
      completion:{requiredStepIds:steps.map(step=>step.stepId),requiredFaultIds:[],terminalStepIds:[steps.at(-1).stepId]},
      equivalentPath:{mode:'TEXT_KEYBOARD',instructions:recipe.map(([stepId,,,text])=>({stepId,text})),faultInstructions:[]}},
    policy:{schemaVersion:'certification-policy.v1',policyId,version:1,credentialIssuance:'DISABLED',requiredActivityIds:[activityId],requiredModuleIds:[],requiredEvidence:['simulation.completed','simulation.equivalent-path'],resultSelection:'latest',passScore:1,maxAttempts:10,cooldownSeconds:0,attemptTtlSeconds:3600,repeatedFailureReviewAfter:null,expirationDays:null,publicVerification:{enabled:false}}
  };
}
