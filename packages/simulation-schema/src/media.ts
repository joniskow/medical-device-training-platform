/** Media is bound to a private approved asset version, never an author-provided URL. */
export type MediaBinding = {assetVersionId:string;altText?:string;transcript?:string};
export type ApprovedMediaAsset = {assetVersionId:string;sourceType:string;contentType:string};
export function validateMediaActivity(activity:unknown,assets:readonly ApprovedMediaAsset[]){
 const findings:Array<{code:string;message:string}>=[];
 const fail=(code:string,message:string)=>findings.push({code,message});
 const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
 if(!record(activity)||!['image','video'].includes(String(activity.type))){fail('MEDIA_TYPE_INVALID','Choose an image or video activity.');return {valid:false,findings};}
 const binding=activity.media;
 if(!record(binding)||Object.keys(binding).some(k=>!['assetVersionId','altText','transcript'].includes(k))||typeof binding.assetVersionId!=='string'||!/^[A-Za-z0-9._:-]{1,128}$/.test(binding.assetVersionId)){
  fail('MEDIA_BINDING_INVALID','Bind one approved private asset version; URLs and unknown media fields are not allowed.');return {valid:false,findings};
 }
 const matches=assets.filter(a=>a.assetVersionId===binding.assetVersionId);
 if(matches.length!==1)fail('MEDIA_ASSET_NOT_APPROVED','Select one approved media asset from this organization.');
 else {
  const asset=matches[0];
  const types=activity.type==='image'?['image/png','image/jpeg','image/webp']:['video/mp4','video/webm'];
  if(asset.sourceType!==activity.type||!types.includes(asset.contentType))fail('MEDIA_ASSET_TYPE_INVALID','The approved asset must match this activity and a supported browser media format.');
 }
 const bounded=(v:unknown,max:number)=>typeof v==='string'&&v.trim().length>0&&v.length<=max;
 if(activity.type==='image'){
  if(!bounded(binding.altText,2000))fail('MEDIA_ALT_REQUIRED','Describe the instructional image in at most 2000 characters.');
  if(binding.transcript!==undefined)fail('MEDIA_FIELD_INVALID','Image activities use an image description, not a video transcript.');
 }else{
  if(!bounded(binding.transcript,100000))fail('MEDIA_TRANSCRIPT_REQUIRED','Provide a video transcript in at most 100000 characters.');
  if(binding.altText!==undefined)fail('MEDIA_FIELD_INVALID','Video activities use a transcript, not an image description.');
 }
 return {valid:findings.length===0,findings};
}
