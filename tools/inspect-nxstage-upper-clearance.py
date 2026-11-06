"""Report sampled upper-door and handle intersections in the review GLB.

Run with Blender's Python from the workspace root. Surface contacts at a
shared boundary may register as intersections; this is not a measurement of
the physical device or a continuous collision proof.
"""
import hashlib
import json
import math
import os
from collections import defaultdict
import bpy
from mathutils import Quaternion
from mathutils.bvhtree import BVHTree

folder = os.environ.get('NXSTAGE_UPPER_FOLDER', 'fixtures/nxstage-system-one-handle-gap-review')
door_samples = int(os.environ.get('NXSTAGE_UPPER_DOOR_SAMPLES', '25'))
assert door_samples >= 2
path = os.path.join(folder, 'nxstage-system-one.glb')
with open(os.path.join(folder, 'model-manifest.json'), encoding='utf-8') as source:
    manifest = json.load(source)
with open(path, 'rb') as source:
    assert hashlib.sha256(source.read()).hexdigest() == manifest['sourceHash'], 'Model and manifest must match'
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=os.path.abspath(path), loglevel=50)
bpy.context.view_layer.update()

def tree(obj):
    evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
    mesh = evaluated.to_mesh()
    try:
        return BVHTree.FromPolygons([evaluated.matrix_world @ v.co for v in mesh.vertices], [tuple(p.vertices) for p in mesh.polygons])
    finally:
        evaluated.to_mesh_clear()

def descendants(root):
    def belongs(obj):
        parent = obj.parent
        while parent:
            if parent == root:
                return True
            parent = parent.parent
        return False
    return [o for o in bpy.data.objects if o.type == 'MESH' and belongs(o)]

def target(target_id):
    return next(t for component in manifest['components'] for t in component.get('interactionTargets', []) if t['targetId'] == target_id)

door = bpy.data.objects['Cycler door assembly']
hinge = bpy.data.objects['Cycler handle hinge']
door_parts = descendants(door)
handle_parts = [bpy.data.objects[n] for n in ('Cycler handle arm left', 'Cycler handle arm right', 'Cycler door pull')]
fixed = [o for o in bpy.data.objects if o.type == 'MESH' and o not in door_parts]
handle_obstacles = [o for o in bpy.data.objects if o.type == 'MESH' and o not in handle_parts]
travel = target('NX-C03-CYCLER-DOOR')['openTranslationMeters']
angle = target('NX-C04-CYCLER-HANDLE')['openRotationRadians']
assert door_parts and handle_parts and math.isfinite(travel) and math.isfinite(angle)

def collect(parts, obstacles, pose, samples):
    hits = defaultdict(list)
    bpy.context.view_layer.update()
    obstacles_with_trees = [(obj, tree(obj)) for obj in obstacles]
    for step in range(samples):
        pose(step / (samples - 1))
        bpy.context.view_layer.update()
        for obj in parts:
            first = tree(obj)
            for other, second in obstacles_with_trees:
                if first and second and first.overlap(second):
                    hits[(obj.name, other.name)].append(step)
    return hits

hinge.rotation_quaternion = Quaternion((0, 0, 1), angle)
door_hits = collect(door_parts, fixed, lambda fraction: setattr(door.location, 'x', travel * fraction), door_samples)
door.location.x = 0
handle_hits = collect(handle_parts, handle_obstacles, lambda fraction: setattr(hinge, 'rotation_quaternion', Quaternion((0, 0, 1), angle * fraction)), 101)
for label, hits, samples in (('door', door_hits, door_samples), ('handle', handle_hits, 101)):
    print(f'{label}: {len(hits)} overlapping mesh pairs across {samples} sampled positions')
    for (first, second), steps in sorted(hits.items()):
        print(f'  {first} / {second}: {len(steps)} samples, first={steps[0]}, last={steps[-1]}')
for step in range(0, 101, 25):
    hinge.rotation_quaternion = Quaternion((0, 0, 1), angle * step / 100)
    bpy.context.view_layer.update()
    bar = tree(bpy.data.objects['Cycler door pull'])
    for side, suffix in (('left', ''), ('right', '.001')):
        arm = tree(bpy.data.objects['Cycler handle arm ' + side])
        fastener = tree(bpy.data.objects['Side pivot fastener' + suffix])
        assert arm.overlap(bar) and arm.overlap(fastener), f'{side} handle join is disconnected at sample {step}'
print('handle joins: both arms meet the crossbar and pivot fasteners at five sampled positions')
