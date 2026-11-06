// The photographed lower-panel STOP button is round like its green neighbor.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
const input='fixtures/nxstage-system-one-vent-conform-review',output='output/nxstage-pureflow-button-study';
const [source,manifest,scene]=await Promise.all([readFile(`${input}/nxstage-system-one.glb`),readFile(`${input}/model-manifest.json`,'utf8').then(JSON.parse),readFile(`${input}/office-scene-review.json`,'utf8').then(JSON.parse)]);
const hash=b=>createHash('sha256').update(b).digest('hex');assert.equal(hash(source),manifest.sourceHash);assert.equal(scene.model.sourceHash,manifest.sourceHash);
const len=source.readUInt32LE(12),doc=JSON.parse(source.subarray(20,20+len));
const go=doc.nodes.find(n=>n.name==='PureFlow GO'),stop=doc.nodes.find(n=>n.name==='PureFlow STOP');
assert(go&&stop&&go.extras?.interactionTargetId==='PF-C01-GO'&&stop.extras?.interactionTargetId==='PF-C01-STOP');
assert.deepEqual(go.rotation,stop.rotation);
const goMesh=doc.meshes[go.mesh],stopMesh=doc.meshes[stop.mesh];assert.equal(goMesh.primitives.length,1);assert.equal(stopMesh.primitives.length,1);
const green=goMesh.primitives[0],red=stopMesh.primitives[0];
const goPosition=doc.accessors[green.attributes.POSITION],stopPosition=doc.accessors[red.attributes.POSITION];
assert.deepEqual(goPosition.min,stopPosition.min);assert.deepEqual(goPosition.max,stopPosition.max);
const delta=(doc.accessors[green.indices].count-doc.accessors[red.indices].count)/3;assert(Number.isInteger(delta));
// Keep STOP's material, node, transform, name and interaction metadata. A
// separate mesh definition prevents either control from sharing behavior.
stopMesh.primitives[0]={...structuredClone(green),material:red.material};manifest.triangleCount+=delta;
const goBezel=doc.nodes.find(n=>n.name==='PureFlow GO button bezel'),stopBezel=doc.nodes.find(n=>n.name==='PureFlow STOP button bezel');
assert(goBezel&&stopBezel);assert.deepEqual(goBezel.rotation,stopBezel.rotation);
const goBezelMesh=doc.meshes[goBezel.mesh],stopBezelMesh=doc.meshes[stopBezel.mesh];assert.equal(goBezelMesh.primitives.length,1);assert.equal(stopBezelMesh.primitives.length,1);
const circularBezel=goBezelMesh.primitives[0],oldBezel=stopBezelMesh.primitives[0];
assert.deepEqual(doc.accessors[circularBezel.attributes.POSITION].min,doc.accessors[oldBezel.attributes.POSITION].min);
assert.deepEqual(doc.accessors[circularBezel.attributes.POSITION].max,doc.accessors[oldBezel.attributes.POSITION].max);
manifest.triangleCount+=(doc.accessors[circularBezel.indices].count-doc.accessors[oldBezel.indices].count)/3;
stopBezelMesh.primitives[0]={...structuredClone(circularBezel),material:oldBezel.material};
let json=Buffer.from(JSON.stringify(doc));json=Buffer.concat([json,Buffer.alloc((4-json.length%4)%4,0x20)]);
const bin=source.subarray(20+len),header=Buffer.alloc(20);header.write('glTF');header.writeUInt32LE(2,4);header.writeUInt32LE(20+json.length+bin.length,8);header.writeUInt32LE(json.length,12);header.write('JSON',16);
const result=Buffer.concat([header,json,bin]),digest=hash(result);
manifest.sourceHash=digest;manifest.modelVersionId='preview:nxstage-round-stop-v1';manifest.releaseBindingId=manifest.modelVersionId;scene.model.sourceHash=digest;scene.model.modelVersionId=manifest.modelVersionId;
await mkdir(output,{recursive:true});await Promise.all([writeFile(`${output}/nxstage-system-one.glb`,result),writeFile(`${output}/model-manifest.json`,JSON.stringify(manifest,null,2)),writeFile(`${output}/office-scene-review.json`,JSON.stringify(scene,null,2)),writeFile(`${output}/study.json`,JSON.stringify({sourceHash:hash(source),hash:digest,evidence:'Round red button in the open-cabinet photograph 20261020_130843.jpg.',limitation:'Dimensions and press travel remain estimates.'},null,2))]);
console.log(`PureFlow round-button candidate: ${output} (${digest})`);
