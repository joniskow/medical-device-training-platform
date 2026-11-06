"""Report lower-door mesh intersections across sampled opening positions."""
import hashlib
import json
import math
import os
from collections import defaultdict
import bpy
from mathutils import Quaternion
from mathutils.bvhtree import BVHTree

folder = os.environ.get('NXSTAGE_LOWER_FOLDER', 'fixtures/nxstage-system-one-connector-review')
path = os.path.join(folder, 'nxstage-system-one.glb')
with open(os.path.join(folder, 'model-manifest.json'), encoding='utf-8') as file:
    manifest = json.load(file)
with open(path, 'rb') as file:
    assert hashlib.sha256(file.read()).hexdigest() == manifest['sourceHash']
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=os.path.abspath(path), loglevel=50)
bpy.context.view_layer.update()
door = bpy.data.objects['Lower cabinet door hinge']
def belongs(obj):
    parent = obj.parent
    while parent:
        if parent == door:
            return True
        parent = parent.parent
    return False
def tree(obj):
    evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
    mesh = evaluated.to_mesh()
    try:
        return BVHTree.FromPolygons([evaluated.matrix_world @ v.co for v in mesh.vertices], [tuple(p.vertices) for p in mesh.polygons])
    finally:
        evaluated.to_mesh_clear()
parts = [obj for obj in bpy.data.objects if obj.type == 'MESH' and belongs(obj)]
obstacles = [(obj, tree(obj)) for obj in bpy.data.objects if obj.type == 'MESH' and not belongs(obj)]
assert parts and obstacles
target = next(t for component in manifest['components'] for t in component.get('interactionTargets', []) if t['targetId'] == 'NX-C02-CABINET-DOOR')
angle = target['openRotationRadians']
hits = defaultdict(list)
for step in range(25):
    door.rotation_quaternion = Quaternion((0, 0, 1), angle * step / 24)
    bpy.context.view_layer.update()
    for part in parts:
        first = tree(part)
        for other, second in obstacles:
            if first and second and first.overlap(second):
                hits[(part.name, other.name)].append(step)
print(f'LOWER_DOOR_PAIRS {len(hits)} across 25 sampled positions')
for (first, second), steps in sorted(hits.items()):
    print(f'LOWER_DOOR_HIT {first} / {second}: count={len(steps)} first={steps[0]} last={steps[-1]}')
