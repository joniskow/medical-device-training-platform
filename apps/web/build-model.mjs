import { build } from "esbuild";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname);
await build({
  entryPoints: [resolve(root, "dist/model-player.js")],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  outfile: resolve(root, "dist/model-player.js"),
  allowOverwrite: true,
  sourcemap: false,
  legalComments: "none"
});
console.log("Bundled Babylon.js model player.");
await build({entryPoints:[resolve(root,'dist/training-viewer.js')],bundle:true,minify:true,format:'esm',platform:'browser',target:'es2022',outfile:resolve(root,'dist/training-viewer.js'),allowOverwrite:true,sourcemap:false,legalComments:'none'});
await build({entryPoints:[resolve(root,'dist/developer-starter.js')],bundle:true,minify:true,external:['./training-viewer.js'],format:'esm',platform:'browser',target:'es2022',outfile:resolve(root,'dist/developer-starter.js'),allowOverwrite:true,sourcemap:false,legalComments:'none'});
await build({entryPoints:[resolve(root,"dist/learner.js")],bundle:true,external:['./author-model-runtime.js'],format:"esm",platform:"browser",target:"es2022",outfile:resolve(root,"dist/learner.js"),allowOverwrite:true,sourcemap:false,legalComments:"none"});
console.log("Bundled learner wallet and QR renderer.");

for(const entry of ['signin','auth-redirect','managed-auth','catalog','candidate-training','wallet','job-status','author-model-runtime','candidate-workbench','demo']) await build({entryPoints:[resolve(root,`dist/${entry}.js`)],bundle:true,external:entry==='job-status'?['./author-model-runtime.js','./candidate-workbench.js']:[],format:'esm',platform:'browser',target:'es2022',outfile:resolve(root,`dist/${entry}.js`),allowOverwrite:true,sourcemap:false,legalComments:'none'});
