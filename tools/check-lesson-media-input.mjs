import assert from 'node:assert/strict';
import {lessonMediaInputArgs} from '../apps/worker/dist/lesson-media-input.js';
for(const kind of ['image','video','audio'])assert.throws(()=>lessonMediaInputArgs(Buffer.from('#EXTM3U\nhttp://127.0.0.1/private\n'),kind),/LESSON_MEDIA_FORMAT_UNSUPPORTED/);
assert.deepEqual(lessonMediaInputArgs(Buffer.from('89504e470d0a1a0a','hex'),'image'),['-protocol_whitelist','file,pipe','-f','image2','-pattern_type','none']);
const mov=Buffer.alloc(16);mov.write('ftyp',4);
assert.deepEqual(lessonMediaInputArgs(mov,'video'),['-protocol_whitelist','file,pipe','-f','mov','-enable_drefs','0','-use_absolute_path','0']);
assert.deepEqual(lessonMediaInputArgs(Buffer.from('RIFF0000WAVE'),'audio'),['-protocol_whitelist','file,pipe','-f','wav']);
assert.throws(()=>lessonMediaInputArgs(Buffer.from('concat\nfile /etc/passwd'),'video'),/FORMAT_UNSUPPORTED/);
console.log('Lesson media input checks passed: explicit format selection, file/pipe protocols, disabled MOV references, playlist rejection.');
