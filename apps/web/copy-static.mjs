import { copyFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname);
await mkdir(resolve(root, "dist"), { recursive: true });
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
await copyFile(resolve(root, "../../fixtures/nxstage-system-one/nxstage-system-one.glb"), resolve(root, "dist/model/nxstage-system-one.glb"));
await copyFile(resolve(root, "../../fixtures/nxstage-system-one/model-manifest.json"), resolve(root, "dist/model/nxstage-system-one-manifest.json"));
await copyFile(resolve(root, "src/model/aurora-training-scene-manifest.json"), resolve(root, "dist/model/aurora-training-scene-manifest.json"));
await copyFile(resolve(root, "src/model/aurora-infusion-controller.mobile.glb"), resolve(root, "dist/model/aurora-infusion-controller.mobile.glb"));
await copyFile(resolve(root, "src/model/aurora-infusion-controller.reduced.glb"), resolve(root, "dist/model/aurora-infusion-controller.reduced.glb"));

await mkdir(resolve(root, "dist/demo-assets"), { recursive: true });
for (const index of Array.from({ length: 8 }, (_, value) => String(value).padStart(3, "0"))) {
  await copyFile(resolve(root, `../../output/reconstruction-capture/images/view-${index}.png`), resolve(root, `dist/demo-assets/view-${index}.png`));
}
await copyFile(resolve(root, "../../fixtures/nxstage-system-one/nxstage-system-one-preview.png"), resolve(root, "dist/demo-assets/nxstage-system-one-preview.png"));
await copyFile(resolve(root, "../../fixtures/reference/video/aic-priming-demo.mp4"), resolve(root, "dist/demo-assets/aic-priming-demo.mp4"));

await copyFile(resolve(root, "src/organization-settings.html"), resolve(root, "dist/organization-settings.html"));

await copyFile(resolve(root, "src/account.html"), resolve(root, "dist/account.html"));

for(const page of ['signin','auth-redirect']) await copyFile(resolve(root,`src/${page}.html`),resolve(root,`dist/${page}.html`));

await copyFile(resolve(root,'src/catalog.html'),resolve(root,'dist/catalog.html'));

await copyFile(resolve(root,'src/candidate-training.html'),resolve(root,'dist/candidate-training.html'));

await copyFile(resolve(root,'src/course-availability.html'),resolve(root,'dist/course-availability.html'));

await copyFile(resolve(root,'src/wallet.html'),resolve(root,'dist/wallet.html'));
