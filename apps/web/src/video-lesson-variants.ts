import { createLessonVariant, validateLessonFinalReview, validateLessonVariants, compareLessonVariantOutcomes, type LessonVariantKind, type VideoLessonPlan } from '@medical-device/simulation-schema';

export function renderLessonVariantOutcomes(host:HTMLElement,course:Record<string,any>,changed:()=>void):void {
  if(!course.videoLessons?.some((l:any)=>l.variantIdentity))return;
  const root=document.createElement('details'),summary=document.createElement('summary');summary.textContent='Compare variant outcomes on the same objectives';root.append(summary);host.append(root);
  const note=document.createElement('p');note.textContent='Record observed evaluation outcomes as JSON rows with lessonId, objective, correct and criticalError. These descriptive counts do not alter instructions, scoring, retries or course completion.';root.append(note);
  const input=document.createElement('textarea');input.setAttribute('aria-label','Observed variant outcomes JSON');input.value=JSON.stringify(course.lessonVariantOutcomes??[],null,2);root.append(input);
  const result=document.createElement('pre');result.setAttribute('role','status');
  const show=()=>{result.textContent=JSON.stringify(compareLessonVariantOutcomes(course.videoLessons,course.lessonVariantOutcomes??[]),null,2);};
  const save=document.createElement('button');save.type='button';save.textContent='Save observed variant outcomes';save.onclick=()=>{
    try{
      const rows=JSON.parse(input.value);
      if(!Array.isArray(rows)||rows.length>10000||!rows.every(r=>r&&typeof r==='object'&&Object.keys(r).every(k=>['lessonId','objective','correct','criticalError'].includes(k))&&typeof r.correct==='boolean'&&typeof r.criticalError==='boolean'&&course.videoLessons.some((l:any)=>l.lessonId===r.lessonId&&l.learningObjectives.includes(r.objective))))throw Error('Every outcome must name an existing lesson and its shared objective, with boolean correct and criticalError fields.');
      course.lessonVariantOutcomes=rows;changed();show();
    }catch(error){result.textContent=(error as Error).message;}
  };root.append(save,result);show();
}

/** Variants remain ordinary lessons: autosave, rendering, independent review and publication all use existing paths. */
export function renderLessonVariantEditor(host:HTMLElement, course:Record<string, any>, lesson:Record<string, any>, changed:()=>void):void {
  const root=document.createElement('fieldset'),legend=document.createElement('legend');legend.textContent='Reviewed learning variants';root.append(legend);host.append(root);
  const status=document.createElement('p');status.setAttribute('role','status');root.append(status);
  const activities=(course.modules??[]).flatMap((m:any)=>m.activities??[]);
  const report=validateLessonVariants(course.videoLessons,activities);status.textContent=report.valid?'Every version keeps the same objectives and approved instructions. Each cut needs its own audio, captions, final render and independent review.':report.findings.map(f=>f.message).join(' ');
  if(lesson.variantIdentity){const p=document.createElement('p');p.textContent=`${lesson.variantIdentity.kind} from ${lesson.variantIdentity.sourceLessonId}. Source instructions are preserved; adjust delivery and observation holds in the shot editor.`;root.append(p);}
  else {
    const target=document.createElement('select');target.setAttribute('aria-label','Target remediation scene');
    for(const scene of lesson.scenes??[])target.add(new Option(String(scene.visual?.label??scene.sceneId),scene.sceneId));root.append(target);
    for(const kind of ['beginner','refresher','remediation'] as LessonVariantKind[]){
      const button=document.createElement('button');button.type='button';button.textContent=`Create ${kind} cut`;
      button.onclick=()=>{try{const variant=createLessonVariant(lesson as VideoLessonPlan & Record<string,any>,kind,`lesson:${crypto.randomUUID()}`,kind==='remediation'?[target.value]:[]);course.videoLessons.push(variant);changed();}catch(error){status.textContent=(error as Error).message;}};root.append(button);
    }
  }
  const attach=document.createElement('button');attach.type='button';attach.textContent='Add reviewed cut to learner course';
  attach.onclick=()=>{
    if(!validateLessonFinalReview(lesson).valid){status.textContent='Complete the independent final artifact review before adding learner playback.';return;}
    const module=course.modules?.[0];if(!module){status.textContent='Create a course module first.';return;}
    if(activities.some((a:any)=>a.videoLessonId===lesson.lessonId)){status.textContent='This cut already has a learner video activity.';return;}
    module.activities??=[];module.activities.push({activityId:`activity:${crypto.randomUUID()}`,type:'video',title:lesson.title,instructions:lesson.safetyBoundary,videoLessonId:lesson.lessonId,
      media:{assetVersionId:lesson.finalReview.assetVersionId,transcript:lesson.scenes.map((s:any)=>s.narration).join('\n\n')}});changed();
  };root.append(attach);
  if(lesson.variantIdentity?.kind==='remediation'){
    const activity=document.createElement('select');activity.setAttribute('aria-label','Mistake activity for remediation');
    for(const a of activities.filter((a:any)=>['multiple_choice','multi_select','ordered_step','simulation','simulation_outcome','guided_procedure','fault_troubleshooting','manipulation','assembly'].includes(a.type)))activity.add(new Option(String(a.title??a.activityId),a.activityId));
    const scene=document.createElement('select');scene.setAttribute('aria-label','Reviewed remediation scene');for(const id of lesson.variantIdentity.targetSceneIds)scene.add(new Option(id,id));
    const objective=document.createElement('select');objective.setAttribute('aria-label','Remediation learning objective');for(const id of lesson.learningObjectives)objective.add(new Option(id,id));
    const link=document.createElement('button');link.type='button';link.textContent='Link mistake to this remediation';link.onclick=()=>{
      const a=activities.find((a:any)=>a.activityId===activity.value);
      if(!a||!validateLessonFinalReview(lesson).valid||!activities.some((a:any)=>a.videoLessonId===lesson.lessonId)){status.textContent='Add the independently reviewed remediation video to the learner course and choose a mistake activity first.';return;}
      a.remediation={lessonId:lesson.lessonId,sceneId:scene.value,objective:objective.value};changed();
    };root.append(activity,scene,objective,link);
  }
}
