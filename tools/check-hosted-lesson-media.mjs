// Real local encoder acceptance with a labeled engineering audio signal.
// Speech-provider and qualified listening acceptance remain separate gates.
process.env.LESSON_ENGINEERING_SIGNAL = '1';
if (process.platform !== 'win32') {
  process.env.LESSON_FFMPEG ??= '/usr/bin/ffmpeg';
  process.env.LESSON_FFPROBE ??= '/usr/bin/ffprobe';
}
process.argv.push('--real-render');
await import('./check-hosted-lesson-render-postgres.mjs');
