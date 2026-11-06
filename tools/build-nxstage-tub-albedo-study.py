"""Create a separate brighter tub-finish study; preserve geometry and controls."""
from hashlib import sha256
from io import BytesIO
from pathlib import Path
import json
import struct
from PIL import Image, ImageEnhance

source = Path('fixtures/nxstage-system-one-rear-mark-review')
output = Path('output/nxstage-tub-albedo-study')
output.mkdir(parents=True, exist_ok=True)
glb = (source / 'nxstage-system-one.glb').read_bytes()
manifest = json.loads((source / 'model-manifest.json').read_text(encoding='utf-8'))
scene = json.loads((source / 'office-scene-review.json').read_text(encoding='utf-8'))
assert sha256(glb).hexdigest() == manifest['sourceHash'] == scene['model']['sourceHash']
size = struct.unpack_from('<I', glb, 12)[0]
doc = json.loads(glb[20:20 + size])
bin_start = 20 + size
assert glb[bin_start + 4:bin_start + 8] == b'BIN\0'
binary = bytearray(glb[bin_start + 8:bin_start + 8 + struct.unpack_from('<I', glb, bin_start)[0]])
material = next(m for m in doc['materials'] if m.get('name') == 'PureFlow tub satin metal')
pbr = material['pbrMetallicRoughness']
texture_index = pbr['baseColorTexture']['index']
image = doc['images'][doc['textures'][texture_index]['source']]
view = doc['bufferViews'][image['bufferView']]
old = binary[view.get('byteOffset', 0):view.get('byteOffset', 0) + view['byteLength']]
albedo = Image.open(BytesIO(old)).convert('RGBA')
albedo = ImageEnhance.Brightness(albedo).enhance(1.4)
buffer = BytesIO()
albedo.save(buffer, format='PNG', optimize=True)
png = buffer.getvalue()
binary.extend(b'\0' * (-len(binary) % 4))
doc['bufferViews'].append({'buffer': 0, 'byteOffset': len(binary), 'byteLength': len(png)})
binary.extend(png)
image['bufferView'] = len(doc['bufferViews']) - 1
image['mimeType'] = 'image/png'
pbr['roughnessFactor'] = .8
doc['buffers'][0]['byteLength'] = len(binary)
binary.extend(b'\0' * (-len(binary) % 4))
encoded = json.dumps(doc, separators=(',', ':')).encode()
encoded += b' ' * (-len(encoded) % 4)
result = struct.pack('<4sIIII', b'glTF', 2, 20 + len(encoded) + 8 + len(binary), len(encoded), 0x4e4f534a) + encoded + struct.pack('<I4s', len(binary), b'BIN\0') + binary
digest = sha256(result).hexdigest()
manifest.update(sourceHash=digest, modelVersionId='preview:nxstage-tub-albedo-study-v1', releaseBindingId='preview:nxstage-tub-albedo-study-v1')
manifest['textures'][texture_index].update(sha256=sha256(png).hexdigest(), byteLength=len(png))
scene['model'].update(sourceHash=digest, modelVersionId=manifest['modelVersionId'])
(output / 'nxstage-system-one.glb').write_bytes(result)
(output / 'model-manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
(output / 'office-scene-review.json').write_text(json.dumps(scene, indent=2), encoding='utf-8')
print(f'Tub albedo study: {output} ({digest})')
