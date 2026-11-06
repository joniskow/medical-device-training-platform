"""Project thin vent markings onto the estimated door surfaces for review."""
import hashlib
import json
import struct
from pathlib import Path
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

source_dir = Path('fixtures/nxstage-system-one-vent-review')
output = Path('output/nxstage-vent-conform-study')
data = (source_dir / 'nxstage-system-one.glb').read_bytes()
manifest = json.loads((source_dir / 'model-manifest.json').read_text(encoding='utf-8'))
scene = json.loads((source_dir / 'office-scene-review.json').read_text(encoding='utf-8'))
digest = lambda value: hashlib.sha256(value).hexdigest()
assert digest(data) == manifest['sourceHash'] == scene['model']['sourceHash']
json_length = struct.unpack_from('<I', data, 12)[0]
document = json.loads(data[20:20 + json_length])
chunk = data[20 + json_length:]
assert chunk[4:8] == b'BIN\0'
binary = bytearray(chunk[8:])

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str((source_dir / 'nxstage-system-one.glb').resolve()), loglevel=50)
bpy.context.view_layer.update()
surfaces = []
for name in ('Central recessed face', 'Inclined cycler fascia housing', 'Cycler door front shell'):
    obj = bpy.data.objects[name]
    evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
    mesh = evaluated.to_mesh()
    surfaces.append(BVHTree.FromPolygons([evaluated.matrix_world @ v.co for v in mesh.vertices], [tuple(p.vertices) for p in mesh.polygons]))
    evaluated.to_mesh_clear()

def append_accessor(values, components, component_type, target, bounds=False):
    binary.extend(b'\0' * (-len(binary) % 4))
    offset = len(binary)
    code = 'f' if component_type == 5126 else 'H'
    for value in values:
        binary.extend(struct.pack('<' + code * components, *value))
    view_index = len(document['bufferViews'])
    document['bufferViews'].append({'buffer': 0, 'byteOffset': offset, 'byteLength': len(binary) - offset, 'target': target})
    accessor = {'bufferView': view_index, 'componentType': component_type, 'count': len(values), 'type': {1:'SCALAR', 2:'VEC2', 3:'VEC3'}[components]}
    if bounds:
        accessor['min'] = [min(v[i] for v in values) for i in range(components)]
        accessor['max'] = [max(v[i] for v in values) for i in range(components)]
    document['accessors'].append(accessor)
    return len(document['accessors']) - 1

vents = sorted((n for n in document['nodes'] if n.get('name', '').startswith('Cycler arched front vent ')), key=lambda n: n['name'])
assert len(vents) == 17
cols, rows = 4, 40
for node in vents:
    obj = bpy.data.objects[node['name']]
    primitive = document['meshes'][node['mesh']]['primitives'][0]
    old_indices = document['accessors'][primitive['indices']]['count']
    xmin, xmax = min(v.co.x for v in obj.data.vertices), max(v.co.x for v in obj.data.vertices)
    zmin, zmax = min(v.co.z for v in obj.data.vertices), max(v.co.z for v in obj.data.vertices)
    matrix, inverse = obj.matrix_world.copy(), obj.matrix_world.inverted()
    coords, normals, uv = [], [], []
    for row in range(rows + 1):
        for col in range(cols + 1):
            u, v = col / cols, row / rows
            sample = matrix @ Vector((xmin + (xmax-xmin)*u, 0, zmin + (zmax-zmin)*v))
            hits = [tree.ray_cast(Vector((sample.x, -1, sample.z)), Vector((0, 1, 0))) for tree in surfaces]
            hits = [hit for hit in hits if hit[0] is not None]
            assert hits, f'No door surface beneath {obj.name}'
            hit = min(hits, key=lambda item:item[3])
            point, normal = hit[0], hit[1]
            point.y -= .00035
            if normal.y > 0:
                normal.negate()
            local, local_normal = inverse @ point, (matrix.to_3x3().transposed() @ normal).normalized()
            coords.append((local.x, local.z, -local.y))
            normals.append((local_normal.x, local_normal.z, -local_normal.y))
            uv.append((u, v))
    indices = []
    for row in range(rows):
        for col in range(cols):
            a = row * (cols+1) + col
            indices.extend(((a,), (a+1,), (a+cols+2,), (a,), (a+cols+2,), (a+cols+1,)))
    primitive['attributes'] = {'POSITION':append_accessor(coords,3,5126,34962,True), 'NORMAL':append_accessor(normals,3,5126,34962), 'TEXCOORD_0':append_accessor(uv,2,5126,34962)}
    primitive['indices'] = append_accessor(indices,1,5123,34963)
    manifest['triangleCount'] += (len(indices) - old_indices) // 3

binary.extend(b'\0' * (-len(binary) % 4))
document['buffers'][0]['byteLength'] = len(binary)
encoded = json.dumps(document, separators=(',', ':')).encode('utf-8')
encoded += b' ' * (-len(encoded) % 4)
result = struct.pack('<4sIIII', b'glTF', 2, 20 + len(encoded) + 8 + len(binary), len(encoded), 0x4e4f534a) + encoded + struct.pack('<I4s', len(binary), b'BIN\0') + binary
new_hash = digest(result)
manifest.update(sourceHash=new_hash, modelVersionId='preview:nxstage-vent-conform-v1', releaseBindingId='preview:nxstage-vent-conform-v1')
scene['model'].update(sourceHash=new_hash, modelVersionId=manifest['modelVersionId'])
output.mkdir(parents=True, exist_ok=True)
(output / 'nxstage-system-one.glb').write_bytes(result)
(output / 'model-manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
(output / 'office-scene-review.json').write_text(json.dumps(scene, indent=2), encoding='utf-8')
(output / 'study.json').write_text(json.dumps({'sourceHash': digest(data), 'hash': new_hash, 'offsetMeters': .00035, 'limitation': 'Surface-following markings, not modeled holes; real slot depth is unmeasured.'}, indent=2), encoding='utf-8')
print('VENT_CONFORM_CANDIDATE', output, new_hash)
