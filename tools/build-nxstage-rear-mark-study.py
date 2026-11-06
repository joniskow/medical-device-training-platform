"""Build a separate rear-mark visual study from the supplied front-panel photo.

The rear photo shows the same mark embossed on the raised cover, partly hidden
by the pole. This study uses the unobscured front mark's silhouette and an
estimated rear placement; it does not claim measured relief or dimensions.
"""
from hashlib import sha256
from io import BytesIO
from pathlib import Path
import json
import struct

from PIL import Image, ImageOps

source = Path('fixtures/nxstage-system-one-shelf-outline-review')
output = Path('output/nxstage-rear-mark-study')
output.mkdir(parents=True, exist_ok=True)
model = (source / 'nxstage-system-one.glb').read_bytes()
manifest = json.loads((source / 'model-manifest.json').read_text(encoding='utf-8'))
scene = json.loads((source / 'office-scene-review.json').read_text(encoding='utf-8'))
assert sha256(model).hexdigest() == manifest['sourceHash'] == scene['model']['sourceHash']

# Isolate the dark and blue ink of the unobscured front mark. Its color is not
# copied: the rear mark in the reference is embossed in the cover's own color.
photo = ImageOps.exif_transpose(Image.open('output/nxstage-system-one-photos/20261020_131233.jpg')).convert('RGB')
crop = photo.crop((1680, 2460, 2350, 2770))
mask = Image.new('L', crop.size)
pixels = []
for r, g, b in crop.getdata():
    dark = max(0, min(255, int((165 - max(r, g, b)) * 6)))
    blue = max(0, min(255, int((b - r - 8) * 12))) if b > g else 0
    pixels.append(max(dark, blue))
mask.putdata(pixels)
texture = Image.new('RGBA', crop.size, (77, 76, 70, 0))
texture.putalpha(mask.point(lambda p: round(p * .24)))
buf = BytesIO()
texture.save(buf, format='PNG', optimize=True)
png = buf.getvalue()
texture.save(output / 'rear-mark-mask.png')

json_length = struct.unpack_from('<I', model, 12)[0]
doc = json.loads(model[20:20 + json_length])
bin_start = 20 + json_length
assert model[bin_start + 4:bin_start + 8] == b'BIN\0'
bin_length = struct.unpack_from('<I', model, bin_start)[0]
binary = bytearray(model[bin_start + 8:bin_start + 8 + bin_length])

def append(data, target=None):
    binary.extend(b'\0' * (-len(binary) % 4))
    view = {'buffer': 0, 'byteOffset': len(binary), 'byteLength': len(data)}
    if target is not None:
        view['target'] = target
    binary.extend(data)
    doc['bufferViews'].append(view)
    return len(doc['bufferViews']) - 1

def accessor(values, kind, size, target=34962):
    view = append(struct.pack('<' + 'f' * len(values), *values), target)
    item = {'bufferView': view, 'componentType': 5126, 'count': len(values) // size, 'type': kind}
    if kind == 'VEC3':
        item['min'] = [min(values[i::3]) for i in range(3)]
        item['max'] = [max(values[i::3]) for i in range(3)]
    doc['accessors'].append(item)
    return len(doc['accessors']) - 1

# Rear cover's visible face is at z=-0.301375 in the source GLB. A very thin
# decal avoids changing collision or making the pole and switch interactive.
w, h, y, z = .041, .019, .337, -.30155
positions = [-w,y-h,z, w,y-h,z, w,y+h,z, -w,y+h,z]
normals = [0,0,-1] * 4
uv = [1,1, 0,1, 0,0, 1,0]
attrs = {'POSITION': accessor(positions, 'VEC3', 3), 'NORMAL': accessor(normals, 'VEC3', 3), 'TEXCOORD_0': accessor(uv, 'VEC2', 2)}
iview = append(struct.pack('<6H', 0, 2, 1, 0, 3, 2), 34963)
doc['accessors'].append({'bufferView': iview, 'componentType': 5123, 'count': 6, 'type': 'SCALAR'})
indices = len(doc['accessors']) - 1
image_view = append(png)
doc.setdefault('images', []).append({'name': 'Photo-derived rear mark mask', 'bufferView': image_view, 'mimeType': 'image/png'})
doc.setdefault('textures', []).append({'source': len(doc['images']) - 1})
doc['materials'].append({'name': 'Subtle embossed mark study', 'alphaMode': 'BLEND', 'doubleSided': True, 'pbrMetallicRoughness': {'baseColorTexture': {'index': len(doc['textures']) - 1}, 'metallicFactor': 0, 'roughnessFactor': .85}})
doc['meshes'].append({'name': 'Photo-derived rear mark study', 'primitives': [{'attributes': attrs, 'indices': indices, 'material': len(doc['materials']) - 1}]})
doc['nodes'].append({'name': 'Photo-derived rear mark study', 'mesh': len(doc['meshes']) - 1, 'extras': {'decorative': True}})
doc['scenes'][doc['scene']]['nodes'].append(len(doc['nodes']) - 1)
doc['buffers'][0]['byteLength'] = len(binary)
binary.extend(b'\0' * (-len(binary) % 4))
encoded = json.dumps(doc, separators=(',', ':')).encode()
encoded += b' ' * (-len(encoded) % 4)
glb = struct.pack('<4sIIII', b'glTF', 2, 20 + len(encoded) + 8 + len(binary), len(encoded), 0x4e4f534a) + encoded + struct.pack('<I4s', len(binary), b'BIN\0') + binary
digest = sha256(glb).hexdigest()
manifest.update(sourceHash=digest, modelVersionId='preview:nxstage-rear-mark-study-v1', releaseBindingId='preview:nxstage-rear-mark-study-v1')
manifest['sceneNodeCount'] += 1
manifest['meshCount'] += 1
manifest['triangleCount'] += 2
manifest['materialCount'] += 1
manifest['textureCount'] += 1
manifest['materials'].append({'materialId': f"material-{manifest['materialCount'] - 1}", 'name': 'Subtle embossed mark study'})
manifest['textures'].append({'textureId': f"texture-{manifest['textureCount'] - 1}", 'sha256': sha256(png).hexdigest(), 'byteLength': len(png)})
scene['model'].update(sourceHash=digest, modelVersionId=manifest['modelVersionId'])
(output / 'nxstage-system-one.glb').write_bytes(glb)
(output / 'model-manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
(output / 'office-scene-review.json').write_text(json.dumps(scene, indent=2), encoding='utf-8')
print(f'Rear-mark study: {output} ({digest})')
