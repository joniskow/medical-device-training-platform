/** Admission of engine evidence, not dimensional-accuracy acceptance. */
export function assertPhotogrammetryReport(report:any,mode:'multi-view'|'video'){
 const invalid=()=>{throw Error('RECONSTRUCTION_OUTPUT_INVALID');},profile=report.captureProfile,images=report.inputImages;
 if(!profile||!['width','height','sourceImageCount'].every(key=>Number.isSafeInteger(profile[key]))||Math.min(profile.width,profile.height)<1080||Math.max(profile.width,profile.height)>4096||profile.sourceImageCount<20||profile.sourceImageCount>100||!Array.isArray(images)||images.length!==profile.sourceImageCount||images.some(image=>!image||typeof image.name!=='string'||!/^[a-f0-9]{64}$/.test(image.sha256)||!Number.isSafeInteger(image.bytes)||image.bytes<1||image.bytes>25*1024*1024)||new Set(images.map(image=>image.sha256)).size<20)invalid();
 const settings=report.geometrySettings;
 if(report.sfmSettings?.finalBundleLoss!=='CAUCHY'||report.globalBundleAdjustment?.loss!=='CAUCHY'||!Number.isFinite(report.globalBundleAdjustment.reprojectionAfterPixels))invalid();
 if(report.detail!=='high'||!settings||settings.estimateROI!==false||settings.cropToROI!==false||settings.towerMode!==false||settings.maximumImageDimension!==4096||report.textureSettings?.globalSeamLeveling!==false||report.textureSettings?.localSeamLeveling!==false)invalid();
 const cameras=report.recoveredCameraCenters;
 if(!Number.isSafeInteger(report.registeredImages)||report.registeredImages<Math.ceil(.8*images.length)||report.registeredImages>images.length||!Number.isSafeInteger(report.sparsePoints)||report.sparsePoints<100||!Number.isFinite(report.meanReprojectionErrorPixels)||report.meanReprojectionErrorPixels<0||report.meanReprojectionErrorPixels>4||Math.abs(report.registrationFraction-report.registeredImages/images.length)>1e-9||!Number.isFinite(report.registrationFraction)||!Array.isArray(cameras)||cameras.length!==report.registeredImages||new Set(cameras.map((camera:any)=>camera?.name)).size!==cameras.length||cameras.some((camera:any)=>!camera||!/^capture-\d{3}\.png$/.test(camera.name)||Number(camera.name.slice(8,11))>=images.length||!Array.isArray(camera.center)||camera.center.length!==3||!camera.center.every(Number.isFinite)))invalid();
 if(!cameras.some((camera:any)=>Math.hypot(...camera.center.map((value:number,index:number)=>value-cameras[0].center[index]))>1e-8))invalid();
 if(mode==='video'){
  const video=report.sourceVideo;
  if(!video||!Number.isFinite(video.durationSeconds)||video.durationSeconds<1||video.durationSeconds>300||!Number.isSafeInteger(video.width)||!Number.isSafeInteger(video.height)||Math.min(video.width,video.height)<1080||Math.max(video.width,video.height)>4096||!Array.isArray(video.frames)||video.frames.length!==images.length)invalid();
  for(let index=0;index<video.frames.length;index++){
   const frame=video.frames[index],image=images[index];
   if(!frame||frame.name!==image.name||frame.sha256!==image.sha256||frame.bytes!==image.bytes)throw Error('RECONSTRUCTION_OUTPUT_SOURCE_MISMATCH');
   if(!Number.isFinite(frame.timestampSeconds)||frame.timestampSeconds<0||frame.timestampSeconds>video.durationSeconds||!Number.isFinite(frame.sourceTimestampSeconds)||index>0&&(frame.timestampSeconds<=video.frames[index-1].timestampSeconds||frame.sourceTimestampSeconds<=video.frames[index-1].sourceTimestampSeconds))invalid();
  }
  if(video.frames.at(-1).timestampSeconds<video.durationSeconds*.9)invalid();
 }
}
