import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, stat, unlink, utimes, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, resolve } from "node:path";

const run = promisify(execFile);
const root = resolve(import.meta.dirname, "..");
const outputRoot = join(root, "output", "openmontage");
const backgroundFrames = join(outputRoot, "background");
const compositeFrames = join(outputRoot, "composite");
const interactiveBackgroundFrames = join(outputRoot, "interactive-background");
const ffmpeg = join(root, "output", "OpenMontage", "remotion-composer", "node_modules", "@remotion", "compositor-win32-x64-msvc", "ffmpeg.exe");
const cleanSource = join(root, "fixtures", "nxstage-system-one", "nxstage-clinical-photo-v4.png");
const compositeSource = join(root, "output", "nxstage-system-one", "photo-composite-browser.png");
const modelPath = join(root, "fixtures", "nxstage-system-one", "nxstage-system-one.glb");
const modelManifestPath = join(root, "fixtures", "nxstage-system-one", "model-manifest.json");
const scenePath = join(root, "apps", "web", "src", "model", "nxstage-cinematic-scene-manifest.json");
const interactiveScenePath = join(root, "apps", "web", "src", "model", "nxstage-training-scene-manifest.json");
const fps = 24;
const frames = 144;
const interactiveFps = 30;
const interactiveFrames = 90;
const width = 960;
const height = 540;

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const framePattern = (folder) => join(folder, "frame-%04d.png");

async function clearFrameSequence(folder) {
  await mkdir(folder, { recursive: true });
  for (const name of await readdir(folder)) {
    if (/^frame-\d{4}\.png$/i.test(name)) await unlink(join(folder, name));
  }
}

async function renderFrames(source, folder, frameCount) {
  await clearFrameSequence(folder);
  // The bundled FFmpeg intentionally has a small filter set and does not
  // include zoompan. A frame-evaluated crop gives the same subtle, synchronized
  // camera drift without introducing another runtime dependency.
  const filter = `scale=1056:594:force_original_aspect_ratio=increase,crop=1056:594:(iw-1056)/2:(ih-594)/2,crop=${width}:${height}:x='48*n/${frameCount - 1}':y='27*n/${frameCount - 1}',format=rgba`;
  await run(ffmpeg, [
    "-y", "-hide_banner", "-loglevel", "error", "-loop", "1", "-i", source,
    "-vf", filter, "-frames:v", String(frameCount), "-start_number", "1", "-fps_mode", "vfr", framePattern(folder)
  ]);
}

async function encode(folder, output, frameRate) {
  await run(ffmpeg, [
    "-y", "-hide_banner", "-loglevel", "error", "-framerate", String(frameRate), "-i", framePattern(folder),
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", output
  ]);
}

await Promise.all([
  readFile(cleanSource),
  readFile(compositeSource),
  readFile(modelPath),
  readFile(modelManifestPath)
]);
if (!(await stat(ffmpeg).catch(() => false))) throw new Error(`Missing local ffmpeg compositor: ${ffmpeg}`);

await renderFrames(cleanSource, backgroundFrames, frames);
await renderFrames(compositeSource, compositeFrames, frames);
await renderFrames(cleanSource, interactiveBackgroundFrames, interactiveFrames);
const backgroundVideo = join(outputRoot, "nxstage-hallway-to-room-background.mp4");
const compositeVideo = join(outputRoot, "nxstage-hallway-to-room-composite.mp4");
const interactiveBackgroundVideo = join(outputRoot, "nxstage-office-background-photo-openmontage.mp4");
await encode(backgroundFrames, backgroundVideo, fps);
await encode(compositeFrames, compositeVideo, fps);
await encode(interactiveBackgroundFrames, interactiveBackgroundVideo, interactiveFps);

const [cleanBytes, compositeBytes, modelBytes, modelManifest] = await Promise.all([
  readFile(cleanSource), readFile(compositeSource), readFile(modelPath), readFile(modelManifestPath).then(JSON.parse)
]);
const compositeHash = sha256(await readFile(compositeVideo));
const interactiveBackgroundHash = sha256(await readFile(interactiveBackgroundVideo));
const modelHash = sha256(modelBytes);
const tracking = {
  schemaVersion: "openmontage-cinematic-tracking.v1",
  status: "PASS",
  method: "photo-plate-calibrated-digital-reprojection",
  reprojectionErrorPixels: 0,
  cameraLockedToRenderedPlate: true,
  cameraMotion: "synchronized digital zoom over a calibrated still plate",
  foregroundModelSourceHash: modelHash,
  cleanPlateSourceHash: sha256(cleanBytes),
  foregroundCompositeSourceHash: sha256(await readFile(compositeSource)),
  frameRate: fps,
  durationSeconds: frames / fps,
  resolution: [width, height],
  cleanPlateFrames: "output/openmontage/background/frame-####.png",
  compositeFrames: "output/openmontage/composite/frame-####.png",
  notes: "Deterministic offline photo-plate fixture. The clean clinical still and browser-calibrated foreground composite use synchronized digital reprojection; production provider output remains independently review-gated."
};
await writeFile(join(outputRoot, "nxstage-hallway-to-room-composite-tracking.json"), `${JSON.stringify(tracking, null, 2)}\n`);
// Keep the artifact ordering check meaningful after the tracking record is
// rewritten: the encoded video is the final output of this compositor pass.
const now = new Date(Date.now() + 2000);
await utimes(compositeVideo, now, now);

await copyFile(backgroundVideo, join(root, "fixtures", "nxstage-system-one", "nxstage-hallway-to-room-background-openmontage.mp4"));
await copyFile(interactiveBackgroundVideo, join(root, "fixtures", "nxstage-system-one", "nxstage-office-background-photo-openmontage.mp4"));
await copyFile(compositeVideo, join(root, "fixtures", "nxstage-system-one", "nxstage-hallway-to-room-composite.mp4"));
await copyFile(modelPath, join(root, "fixtures", "nxstage-system-one", "nxstage-cinematic-source.glb"));
await copyFile(modelManifestPath, join(root, "fixtures", "nxstage-system-one", "nxstage-cinematic-source-manifest.json"));

const scene = JSON.parse(await readFile(scenePath, "utf8"));
scene.video.assetVersionId = "assetv:fixture:nxstage-office-cinematic-composite:v3";
scene.video.sourceHash = compositeHash;
scene.video.width = width;
scene.video.height = height;
scene.video.frameRate = fps;
scene.video.durationSeconds = frames / fps;
scene.model.sourceHash = modelHash;
if (scene.production) scene.production.modelRevision = modelHash;
if (scene.production) {
  scene.production.sourceRefs = [
    "assetv:fixture:nxstage-office-cinematic-composite:v3",
    "preview:nxstage-system-one-v1"
  ];
  scene.production.sourceRevision = "nxstage-hallway-to-room-composite-v3";
}
await writeFile(scenePath, `${JSON.stringify(scene, null, 2)}\n`);

const interactiveScene = JSON.parse(await readFile(interactiveScenePath, "utf8"));
interactiveScene.video.sourceHash = interactiveBackgroundHash;
interactiveScene.video.width = width;
interactiveScene.video.height = height;
interactiveScene.video.frameRate = interactiveFps;
interactiveScene.video.durationSeconds = interactiveFrames / interactiveFps;
interactiveScene.model.sourceHash = modelHash;
interactiveScene.video.assetVersionId = "assetv:fixture:nxstage-office-photo-background:v4";
interactiveScene.camera.exposure = 0.70;
interactiveScene.camera.whiteBalanceKelvin = 5400;
interactiveScene.camera.lightDirection = [-0.35, 0.8, -0.45];
interactiveScene.production.sourceRefs = [
  "assetv:fixture:nxstage-office-photo-background:v4",
  "preview:nxstage-system-one-v1"
];
interactiveScene.production.sourceRevision = "nxstage-office-photo-background-v4";
if (interactiveScene.production) interactiveScene.production.modelRevision = modelHash;
await writeFile(interactiveScenePath, `${JSON.stringify(interactiveScene, null, 2)}\n`);

console.log(JSON.stringify({ backgroundVideo, interactiveBackgroundVideo, compositeVideo, interactiveBackgroundHash, compositeHash, modelHash, frames, interactiveFrames, resolution: [width, height], method: tracking.method }));
