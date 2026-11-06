"""Compare estimated open-handle positions with the trial fascia geometry."""
import math
import os
import bpy
from mathutils.bvhtree import BVHTree

bpy.ops.wm.open_mainfile(filepath=os.environ.get("NXSTAGE_CLEARANCE_BLEND", "output/nxstage-fascia-study/depth-study.blend"))
hinge = bpy.data.objects["Cycler handle hinge"]

def tree(obj):
    evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
    mesh = evaluated.to_mesh()
    vertices = [evaluated.matrix_world @ vertex.co for vertex in mesh.vertices]
    result = BVHTree.FromPolygons(vertices, [tuple(poly.vertices) for poly in mesh.polygons])
    evaluated.to_mesh_clear()
    return result

for step in range(13):
    angle = -math.pi / 2 * step / 12
    hinge.rotation_euler.z = angle
    bpy.context.view_layer.update()
    housing = tree(bpy.data.objects["Inclined cycler fascia housing"])
    overlaps = {name: len(housing.overlap(tree(bpy.data.objects[name]))) for name in ("Cycler handle arm left", "Cycler handle arm right", "Cycler door pull")}
    assert not any(overlaps.values()), f"Handle intersects trial fascia at {angle}: {overlaps}"
    if os.environ.get("NXSTAGE_GUIDE_CLEARANCE") == "1":
        for side in ("left", "right"):
            guide = tree(bpy.data.objects[f"Cycler {side} side guide channel"])
            arm = tree(bpy.data.objects[f"Cycler handle arm {side}"])
            assert not guide.overlap(arm), f"Handle intersects {side} guide at {angle}"
print("Trial fascia and handle do not intersect at the 13 sampled Blender hinge positions; continuous and physical clearances remain unverified.")
