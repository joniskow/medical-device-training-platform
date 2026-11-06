"""Check sampled door and tub clearance in an isolated metric candidate.

Run with Blender's Python, from the workspace root. This checks mesh surface
intersections at sampled poses; it cannot establish real-device dimensions.
"""
import math
import os
import bpy
from mathutils import Quaternion
from mathutils.bvhtree import BVHTree

path = os.environ.get('NXSTAGE_CLEARANCE_GLB', 'output/nxstage-tub-clearance-study/nxstage-system-one.glb')
door_samples = int(os.environ.get('NXSTAGE_LOWER_DOOR_SAMPLES', '25'))
tub_samples = int(os.environ.get('NXSTAGE_TUB_SAMPLES', '101'))
assert door_samples >= 2 and tub_samples >= 2
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

def below(obj, root):
    parent = obj.parent
    while parent:
        if parent == root:
            return True
        parent = parent.parent
    return False

door = bpy.data.objects['Lower cabinet door hinge']
tub = bpy.data.objects['PureFlow tub travel axis']
door_parts = [o for o in bpy.data.objects if o.type == 'MESH' and below(o, door)]
tub_parts = [o for o in bpy.data.objects if o.type == 'MESH' and below(o, tub)]
door_obstacles = [(o, tree(o)) for o in bpy.data.objects if o.type == 'MESH' and not below(o, door)]
all_fixed = [o for o in bpy.data.objects if o.type == 'MESH' and not below(o, tub) and not below(o, door)]
assert door_parts and tub_parts
travel = float(tub.get('openTranslationMeters'))
for step in range(door_samples):
    door.rotation_quaternion = Quaternion((0, 0, 1), -math.pi / 2 * step / (door_samples - 1))
    bpy.context.view_layer.update()
    overlap = [(part.name, other.name) for part in door_parts if (first := tree(part)) for other, second in door_obstacles if second and first.overlap(second)]
    assert not overlap, f'Door step {step} intersects: {overlap}'
door.rotation_quaternion = Quaternion((0, 0, 1), -math.pi / 2)
bpy.context.view_layer.update()
fixed_trees = [(obj, tree(obj)) for obj in all_fixed + door_parts]
for step in range(tub_samples):
    tub.location.x = travel * step / (tub_samples - 1)
    bpy.context.view_layer.update()
    overlap = [(part.name, other.name) for part in tub_parts if (first := tree(part)) for other, second in fixed_trees if second and first.overlap(second)]
    assert not overlap, f'Tub step {step} intersects: {overlap}; local={tuple(tub.location)} world={tuple(tub.matrix_world.translation)}'
print(f'Clearance passed: {door_samples} sampled lower-door positions and {tub_samples} sampled tub positions.')
