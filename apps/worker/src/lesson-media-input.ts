/** Force known parsers; never let uploaded bytes select playlist/network demuxers. */
export function lessonMediaInputArgs(bytes:Uint8Array,kind:'image'|'video'|'audio'):string[]{
  const b=Buffer.from(bytes),prefix=['-protocol_whitelist','file,pipe'];
  if(kind==='image'&&(b.subarray(0,8).toString('hex')==='89504e470d0a1a0a'||b[0]===0xff&&b[1]===0xd8&&b[2]===0xff||b.subarray(0,4).toString()==='RIFF'&&b.subarray(8,12).toString()==='WEBP'))return [...prefix,'-f','image2','-pattern_type','none'];
  if(kind==='video'){
    if(b.subarray(4,8).toString()==='ftyp')return [...prefix,'-f','mov','-enable_drefs','0','-use_absolute_path','0'];
    if(b.subarray(0,4).toString('hex')==='1a45dfa3')return [...prefix,'-f','matroska'];
  }
  if(kind==='audio'){
    if(b.subarray(0,4).toString()==='RIFF'&&b.subarray(8,12).toString()==='WAVE')return [...prefix,'-f','wav'];
    if(b.subarray(0,3).toString()==='ID3'||b[0]===0xff&&b[1]!==undefined&&(b[1]&0xe0)===0xe0)return [...prefix,'-f','mp3'];
  }
  throw Error('LESSON_MEDIA_FORMAT_UNSUPPORTED');
}
