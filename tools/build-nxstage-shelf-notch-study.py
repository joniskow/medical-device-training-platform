"""Create an isolated photo-informed shelf-notch candidate from the review GLB.

Run with the local bpy runtime. Dimensions are estimates from the front photo;
other model nodes and interaction metadata are retained except for the insert's position.
"""
import hashlib
import json
import os
import struct
from pathlib import Path

import bpy

source = Path('fixtures/nxstage-system-one-fine-motion-v2-review')
output = Path('output/nxstage-shelf-notch-study')
raw = (source / 'nxstage-system-one.glb').read_bytes()
manifest = json.loads((source / 'model-manifest.json').read_text(encoding='utf-8'))
scene = json.loads((source / 'office-scene-review.json').read_text(encoding='utf-8'))
digest = lambda data: hashlib.sha256(data).hexdigest()
assert digest(raw) == manifest['sourceHash'] == scene['model']['sourceHash']
assert raw[:4] == b'glTF' and struct.unpack_from('<I', raw, 4)[0] == 2
json_length = struct.unpack_from('<I', raw, 12)[0]
doc = json.loads(raw[20:20 + json_length])
chunk_start = 20 + json_length
binary_length, binary_type = struct.unpack_from('<I4s', raw, chunk_start)
assert binary_type == b'BIN\0'
binary = bytearray(raw[chunk_start + 8:chunk_start + 8 + binary_length])

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str((source / 'nxstage-system-one.glb').resolve()), loglevel=50)
bpy.context.view_layer.update()
shelf = bpy.data.objects['Upper white shelf']
assert shelf.type == 'MESH'
# The notch reaches the front edge and reveals the dark insert below. The
# photographed outline is rounded; the chosen dimensions are not measured.
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, -0.170, 0.090))
cutter = bpy.context.object
cutter.name = 'Temporary shelf notch cutter'
cutter.dimensions = (0.165, 0.130, 0.100)
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
bevel = cutter.modifiers.new('Rounded notch corners', 'BEVEL')
bevel.width = 0.008
bevel.segments = 4
bpy.context.view_layer.objects.active = cutter
bpy.ops.object.modifier_apply(modifier=bevel.name)
boolean = shelf.modifiers.new('Photo-informed front recess', 'BOOLEAN')
boolean.operation = 'DIFFERENCE'
boolean.solver = 'EXACT'
boolean.object = cutter
bpy.context.view_layer.update()
evaluated = shelf.evaluated_get(bpy.context.evaluated_depsgraph_get())
mesh = evaluated.to_mesh()
try:
    mesh.calc_loop_triangles()
    uv_layer = mesh.uv_layers.active
    assert uv_layer and len(mesh.loop_triangles) > 0
    positions, normals, texcoords = [], [], []
    for triangle in mesh.loop_triangles:
        for loop_index in triangle.loops:
            point = mesh.vertices[mesh.loops[loop_index].vertex_index].co
            normal = mesh.corner_normals[loop_index].vector
            uv = uv_layer.data[loop_index].uv
            # Blender Z-up to glTF Y-up; glTF UVs invert Blender's V axis.
            positions.extend((point.x, point.z, -point.y))
            normals.extend((normal.x, normal.z, -normal.y))
            texcoords.extend((uv.x, 1 - uv.y))
    assert len(positions) // 3 < 65536
finally:
    evaluated.to_mesh_clear()

def append(values, component_type, components, target):
    while len(binary) % 4: binary.append(0)
    offset = len(binary)
    fmt = '<' + ('f' if component_type == 5126 else 'H') * len(values)
    binary.extend(struct.pack(fmt, *values))
    view = len(doc['bufferViews'])
    doc['bufferViews'].append({'buffer': 0, 'byteOffset': offset, 'byteLength': len(binary) - offset, 'target': target})
    accessor = {'bufferView': view, 'componentType': component_type, 'count': len(values) // components, 'type': 'SCALAR' if components == 1 else f'VEC{components}'}
    if target == 34962 and values is positions:
        accessor['min'] = [min(values[i::3]) for i in range(3)]
        accessor['max'] = [max(values[i::3]) for i in range(3)]
    index = len(doc['accessors'])
    doc['accessors'].append(accessor)
    return index

shelf_node = next(node for node in doc['nodes'] if node.get('name') == 'Upper white shelf')
primitive = doc['meshes'][shelf_node['mesh']]['primitives'][0]
old_indices = doc['accessors'][primitive['indices']]['count']
primitive['attributes']['POSITION'] = append(positions, 5126, 3, 34962)
primitive['attributes']['NORMAL'] = append(normals, 5126, 3, 34962)
primitive['attributes']['TEXCOORD_0'] = append(texcoords, 5126, 2, 34962)
primitive['indices'] = append(list(range(len(positions) // 3)), 5123, 1, 34963)
insert = next(node for node in doc['nodes'] if node.get('name') == 'Shelf center black insert')
assert len(insert['translation']) == 3
insert['translation'][1] = 0.071
insert['translation'][2] = 0.140
doc['buffers'][0]['byteLength'] = len(binary)
while len(binary) % 4: binary.append(0)
json_bytes = json.dumps(doc, separators=(',', ':')).encode('utf-8')
json_bytes += b' ' * (-len(json_bytes) % 4)
body = struct.pack('<I4s', len(json_bytes), b'JSON') + json_bytes + struct.pack('<I4s', len(binary), b'BIN\0') + binary
result = struct.pack('<4sII', b'glTF', 2, 12 + len(body)) + body
new_hash = digest(result)
manifest['triangleCount'] += len(positions) // 9 - old_indices // 3
manifest['sourceHash'] = new_hash
manifest['modelVersionId'] = 'preview:nxstage-shelf-notch-v1'
manifest['releaseBindingId'] = manifest['modelVersionId']
scene['model']['sourceHash'] = new_hash
scene['model']['modelVersionId'] = manifest['modelVersionId']
output.mkdir(parents=True, exist_ok=True)
(output / 'nxstage-system-one.glb').write_bytes(result)
(output / 'model-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
(output / 'office-scene-review.json').write_text(json.dumps(scene, indent=2) + '\n', encoding='utf-8')
(output / 'study.json').write_text(json.dumps({'sourceHash': digest(raw), 'hash': new_hash, 'limitation': 'Notch shape, depth and insert position are estimates from a photograph.'}, indent=2) + '\n', encoding='utf-8')
print(f'Shelf-notch candidate: {output} ({new_hash}); shelf triangles {old_indices // 3} -> {len(positions) // 9}')
