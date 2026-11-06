"""Inspect which meshes are visible along frontal rays through the cycler door."""
import os
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

bpy.ops.wm.read_factory_settings(use_empty=True)
path = os.environ.get('NXSTAGE_FRONT_GLB', 'fixtures/nxstage-system-one-handle-gap-review/nxstage-system-one.glb')
bpy.ops.import_scene.gltf(filepath=os.path.abspath(path), loglevel=50)
bpy.context.view_layer.update()
objects = []
for obj in bpy.data.objects:
    if obj.type != 'MESH':
        continue
    evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
    mesh = evaluated.to_mesh()
    tree = BVHTree.FromPolygons([evaluated.matrix_world @ v.co for v in mesh.vertices], [tuple(p.vertices) for p in mesh.polygons])
    evaluated.to_mesh_clear()
    objects.append((obj, tree))
for name in ('Central recessed face', 'Cycler door front shell'):
    obj = bpy.data.objects[name]
    pts = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
    print('BOUNDS', name, [(round(min(p[i] for p in pts), 4), round(max(p[i] for p in pts), 4)) for i in range(3)])
trees = {obj.name: tree for obj, tree in objects}
print('DETAIL_SHELL_INTERSECTIONS', len(trees['Central recessed face'].overlap(trees['Cycler door front shell'])))
vents = sorted((item for item in objects if item[0].name.startswith('Cycler arched front vent ')), key=lambda item: item[0].name)
if os.environ.get('NXSTAGE_ASSERT_VENTS') == '1':
    assert len(vents) == 17, f'Expected 17 front vent slots, found {len(vents)}'
for obj, _ in vents:
    if os.environ.get('NXSTAGE_VENT_PROFILE') == '1':
        print('VENT_VERTEX_COUNT', obj.name, len(obj.data.vertices), tuple(round(value, 6) for value in obj.data.vertices[0].co))
    center = sum((obj.matrix_world @ Vector(corner) for corner in obj.bound_box), Vector()) / 8
    hits = []
    for other, tree in objects:
        point, _, _, distance = tree.ray_cast(Vector((center.x, -1, center.z)), Vector((0, 1, 0)))
        if point is not None:
            hits.append((distance, other.name))
    print('VENT_VISIBILITY', obj.name, [(name, round(distance, 6)) for distance, name in sorted(hits)[:3]])
    if os.environ.get('NXSTAGE_ASSERT_VENTS') == '1':
        assert hits and min(hits)[1] == obj.name, f'{obj.name} is hidden from the front at its center'
        parent = obj.parent
        while parent and parent.name != 'Cycler door assembly':
            parent = parent.parent
        assert parent, f'{obj.name} must move with the cycler door'
    if os.environ.get('NXSTAGE_VENT_PROFILE') == '1':
        corners = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
        height = max(p.z for p in corners) - min(p.z for p in corners)
        for fraction in (-.25, .25):
            origin = Vector((center.x, -1, center.z + height * fraction))
            nearby = []
            for other, tree in objects:
                point, _, _, distance = tree.ray_cast(origin, Vector((0, 1, 0)))
                if point is not None:
                    nearby.append((distance, other.name))
            print('VENT_PROFILE', obj.name, fraction, [(name, round(distance, 6)) for distance, name in sorted(nearby)[:2]])
for x, z in ((0, 0.22), (0, 0.24), (-0.1, 0.28), (0, 0.28), (0.1, 0.28), (0, 0.30), (0, 0.32), (0, 0.34)):
    hits = []
    for obj, tree in objects:
        point, normal, index, distance = tree.ray_cast(Vector((x, -1, z)), Vector((0, 1, 0)))
        if point is not None:
            hits.append((distance, obj.name, point.y))
    print('RAY', (x, z), [(name, round(y, 5)) for _, name, y in sorted(hits)[:5]])
