"""Print metric bounds for the photographed lower-cabinet details."""
import os
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

path = os.environ.get('NXSTAGE_DETAIL_GLB', 'fixtures/nxstage-system-one-round-stop-review/nxstage-system-one.glb')
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=os.path.abspath(path), loglevel=50)
bpy.context.view_layer.update()
for obj in sorted(bpy.data.objects, key=lambda o: o.name):
    if obj.type != 'MESH' or not any(part in obj.name for part in ('Lower connector detail', 'Lower left connector strip', 'Container ', 'PureFlow tub front', 'Cabinet left wall', 'Cabinet door', 'Front left blue tube')):
        continue
    points = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
    bounds = [(round(min(p[i] for p in points), 4), round(max(p[i] for p in points), 4)) for i in range(3)]
    print('LOWER_DETAIL', obj.name, bounds, 'parent', obj.parent.name if obj.parent else None)
door = bpy.data.objects['Lower cabinet door hinge']
def below(obj, root):
    parent = obj.parent
    while parent:
        if parent == root:
            return True
        parent = parent.parent
    return False
def tree(obj):
    mesh = obj.evaluated_get(bpy.context.evaluated_depsgraph_get()).to_mesh()
    result = BVHTree.FromPolygons([obj.matrix_world @ v.co for v in mesh.vertices], [tuple(p.vertices) for p in mesh.polygons])
    obj.evaluated_get(bpy.context.evaluated_depsgraph_get()).to_mesh_clear()
    return result
door_parts = [(obj, tree(obj)) for obj in bpy.data.objects if obj.type == 'MESH' and below(obj, door)]
for obj in bpy.data.objects:
    if obj.type != 'MESH' or not obj.name.startswith('Lower connector detail'):
        continue
    target = tree(obj)
    for part, other in door_parts:
        if target.overlap(other):
            print('LOWER_DOOR_DETAIL_OVERLAP', part.name, '/', obj.name)
if os.environ.get('NXSTAGE_CHECK_BLUE_TUBE') == '1':
    blue = bpy.data.objects['Front left blue tube']
    blue_tree = tree(blue)
    for obj in bpy.data.objects:
        if obj.type == 'MESH' and obj != blue and blue_tree.overlap(tree(obj)):
            print('BLUE_TUBE_OVERLAP', obj.name)
