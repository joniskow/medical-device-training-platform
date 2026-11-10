import { copyFile, mkdir, readFile, writeFile, stat, rm } from "node:fs/promises";
import { gzipSync } from 'node:zlib';
import { resolve } from "node:path";

const root = resolve(import.meta.dirname);
await mkdir(resolve(root, "dist"), { recursive: true });
for (const name of ['admin.html', 'admin.css']) await copyFile(resolve(root, 'src', name), resolve(root, 'dist', name));
await copyFile(resolve(root, 'src/api-docs.html'), resolve(root, 'dist/api-docs.html'));
await copyFile(resolve(root, 'src/developer-starter.html'), resolve(root, 'dist/developer-starter.html'));
await copyFile(resolve(root, "src/index.html"), resolve(root, "dist/index.html"));
await copyFile(resolve(root, "src/demo.html"), resolve(root, "dist/demo.html"));
await copyFile(resolve(root, "src/demo.css"), resolve(root, "dist/demo.css"));
await copyFile(resolve(root, "src/learner.html"), resolve(root, "dist/learner.html"));
await copyFile(resolve(root, "src/assignments.html"), resolve(root, "dist/assignments.html"));
await copyFile(resolve(root,"src/members.html"),resolve(root,"dist/members.html"));
await copyFile(resolve(root, "src/organizations.html"), resolve(root, "dist/organizations.html"));
await copyFile(resolve(root, "src/invitation.html"), resolve(root, "dist/invitation.html"));
await copyFile(resolve(root, "src/invitation-admin.html"), resolve(root, "dist/invitation-admin.html"));
await copyFile(resolve(root, "src/verify.html"), resolve(root, "dist/verify.html"));
await copyFile(resolve(root, "src/model.html"), resolve(root, "dist/model.html"));
await copyFile(resolve(root, "src/model-manifest.json"), resolve(root, "dist/model-manifest.json"));
await copyFile(resolve(root, "src/model/model-manifest.mobile.json"), resolve(root, "dist/model-manifest.mobile.json"));
await copyFile(resolve(root, "src/model/model-manifest.reduced.json"), resolve(root, "dist/model-manifest.reduced.json"));
await mkdir(resolve(root, "dist/model"), { recursive: true });
await copyFile(resolve(root, "src/model/optimization-report.json"), resolve(root, "dist/model/optimization-report.json"));
await copyFile(resolve(root, "../../fixtures/reference/model/aurora-infusion-controller.glb"), resolve(root, "dist/model/aurora-infusion-controller.glb"));
await copyFile(resolve(root, "../../fixtures/aurora-training/aurora-training.glb"), resolve(root, "dist/model/aurora-training.glb"));
await copyFile(resolve(root, "src/model/aurora-training-manifest.json"), resolve(root, "dist/model/aurora-training-manifest.json"));
await copyFile(resolve(root, "../../fixtures/nxstage-system-one-interactive/nxstage-system-one.glb"), resolve(root, "dist/model/nxstage-system-one.glb"));
await copyFile(resolve(root, "../../fixtures/nxstage-system-one-interactive/model-manifest.json"), resolve(root, "dist/model/nxstage-system-one-manifest.json"));
await copyFile(resolve(root, "../../fixtures/nxstage-system-one-rear-outlet-depth-review/nxstage-system-one.glb"), resolve(root, "dist/model/nxstage-review.glb"));
await copyFile(resolve(root, "../../fixtures/nxstage-system-one-rear-outlet-depth-review/model-manifest.json"), resolve(root, "dist/model/nxstage-review-manifest.json"));
await copyFile(resolve(root, "../../fixtures/nxstage-system-one-rear-outlet-depth-review/office-scene-review.json"), resolve(root, "dist/model/nxstage-review-scene.json"));
await copyFile(resolve(root, "../../fixtures/nxstage-system-one/nxstage-system-one.glb"), resolve(root, "dist/model/nxstage-cinematic-source.glb"));
await copyFile(resolve(root, "../../fixtures/nxstage-system-one/nxstage-cinematic-source-manifest.json"), resolve(root, "dist/model/nxstage-cinematic-source-manifest.json"));
await copyFile(resolve(root, "src/model/nxstage-training-scene-manifest.json"), resolve(root, "dist/model/nxstage-training-scene-manifest.json"));
await copyFile(resolve(root, "src/model/nxstage-cinematic-scene-manifest.json"), resolve(root, "dist/model/nxstage-cinematic-scene-manifest.json"));
await copyFile(resolve(root, "src/model/aurora-training-scene-manifest.json"), resolve(root, "dist/model/aurora-training-scene-manifest.json"));
await copyFile(resolve(root, "src/model/aurora-infusion-controller.mobile.glb"), resolve(root, "dist/model/aurora-infusion-controller.mobile.glb"));
await copyFile(resolve(root, "src/model/aurora-infusion-controller.reduced.glb"), resolve(root, "dist/model/aurora-infusion-controller.reduced.glb"));

await mkdir(resolve(root, "dist/demo-assets"), { recursive: true });
for (const index of Array.from({ length: 8 }, (_, value) => String(value).padStart(3, "0"))) {
  // Locally generated reconstruction captures are optional demo material. A fresh
  // checkout must build the application without private/generated output files.
  const source = resolve(root, `../../output/reconstruction-capture/images/view-${index}.png`);
  const target = resolve(root, `dist/demo-assets/view-${index}.png`);
  try { await stat(source); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await rm(target, { force: true });
    console.log(`Optional reconstruction demo capture unavailable: view-${index}.png`);
    continue;
  }
  await copyFile(source, target);
}
await copyFile(resolve(root, "../../fixtures/nxstage-system-one-interactive/nxstage-system-one-preview.png"), resolve(root, "dist/demo-assets/nxstage-system-one-preview.png"));
await copyFile(resolve(root, "../../fixtures/nxstage-system-one/nxstage-clinical-photo-v4.png"), resolve(root, "dist/demo-assets/nxstage-clinical-photo-v4.png"));
await copyFile(resolve(root, "../../fixtures/nxstage-system-one/nxstage-office-background-photo-openmontage.mp4"), resolve(root, "dist/demo-assets/nxstage-office-background-photo-openmontage.mp4"));
await copyFile(resolve(root, "../../fixtures/nxstage-system-one/nxstage-photo-video-composite-review.png"), resolve(root, "dist/demo-assets/nxstage-photo-video-composite-review.png"));
await copyFile(resolve(root, "../../fixtures/reference/video/aic-priming-demo.mp4"), resolve(root, "dist/demo-assets/aic-priming-demo.mp4"));
await copyFile(resolve(root, "../../fixtures/nxstage-system-one/nxstage-office-background-openmontage.mp4"), resolve(root, "dist/demo-assets/nxstage-office-background-openmontage.mp4"));
await copyFile(resolve(root, "../../fixtures/nxstage-system-one/nxstage-hallway-to-room-background-openmontage.mp4"), resolve(root, "dist/demo-assets/nxstage-hallway-to-room-background-openmontage.mp4"));
await copyFile(resolve(root, "../../fixtures/nxstage-system-one/nxstage-hallway-to-room-composite.mp4"), resolve(root, "dist/demo-assets/nxstage-hallway-to-room-composite.mp4"));

await copyFile(resolve(root, "src/organization-settings.html"), resolve(root, "dist/organization-settings.html"));

await copyFile(resolve(root, "src/account.html"), resolve(root, "dist/account.html"));

for(const page of ['signin','auth-redirect']) await copyFile(resolve(root,`src/${page}.html`),resolve(root,`dist/${page}.html`));

await copyFile(resolve(root,'src/catalog.html'),resolve(root,'dist/catalog.html'));

await copyFile(resolve(root,'src/candidate-training.html'),resolve(root,'dist/candidate-training.html'));

await copyFile(resolve(root,'src/course-availability.html'),resolve(root,'dist/course-availability.html'));

await copyFile(resolve(root,'src/wallet.html'),resolve(root,'dist/wallet.html'));

// Public bundles are compressed once at build time, without per-request CPU cost.
for(const name of ['training-viewer.js','developer-starter.js','signin.js','auth-redirect.js']){
 const file=resolve(root,'dist',name);
 await writeFile(`${file}.gz`,gzipSync(await readFile(file),{level:9}));
}

await copyFile(resolve(root, 'src/demo-config.js'), resolve(root, 'dist/demo-config.js'));
