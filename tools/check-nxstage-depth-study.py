"""Check the isolated depth study's major spatial relationships."""
import bpy
import os
from mathutils import Vector


def bounds(path, names):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=path)
    bpy.context.view_layer.update()
    result = {}
    for name in names:
        obj = bpy.data.objects[name]
        points = [obj.matrix_world @ Vector(point) for point in obj.bound_box]
        result[name] = [(min(p[i] for p in points), max(p[i] for p in points)) for i in range(3)]
    return result


names = ["Upper machine shell", "Cycler door front shell", "Cycler rear service panel",
         "Right side carry handle grip", "IV pole rear section", "Upper white shelf",
         "Cabinet rear wall", "Cycler rear power rocker", "Cabinet left wall",
         "Cabinet floor", "PureFlow tub front", "Container left side", "Container back", "Container bottom"]
old = bounds("fixtures/nxstage-system-one-interaction-review/nxstage-system-one.glb", names)
new = bounds(os.environ.get("NXSTAGE_DEPTH_GLB", "output/nxstage-depth-study/nxstage-system-one.glb"), names)
epsilon = 1e-4
for axis in range(3):
    for edge in range(2):
        expected_shift = .16 if axis == 2 and os.environ.get("NXSTAGE_CYCLER_BASE_STUDY") == "1" else 0
        assert abs(new["Cycler door front shell"][axis][edge] - old["Cycler door front shell"][axis][edge] - expected_shift) < epsilon, "Front door must retain its shape and intended position"
scale = .381 / 4.45
front_y = new["Cycler door front shell"][1][0]
if os.environ.get("NXSTAGE_FASCIA_TILT_STUDY") == "1":
    panel = bpy.data.objects["System One control fascia"]
    front_y = min((panel.matrix_world @ Vector(point)).y for point in panel.bound_box)
depth = (new["Upper machine shell"][1][1] - front_y) * scale
assert abs(depth - .4572) < .01, f"Approximate cycler depth: {depth} m"
rear = new["Upper machine shell"][1][1]
panel = new["Cycler rear service panel"][1]
assert panel[0] > rear - .05 and panel[1] < rear + .25, "Rear panel must sit against the shell"
assert new["IV pole rear section"][1][0] > rear, "Rear pole must stay behind the shell"
assert new["Cycler rear power rocker"][1][0] > rear, "Power rocker must stay outside the shell"
assert new["Upper white shelf"][1][1] > rear, "Shelf must support the lengthened shell"
assert new["Cabinet rear wall"][1][0] > rear, "Cabinet rear must extend behind the head"
for name in ("Cabinet left wall", "Cabinet floor", "PureFlow tub front", "Container left side", "Container bottom"):
    for axis in (0, 2):
        for edge in (0, 1):
            assert abs(new[name][axis][edge] - old[name][axis][edge]) < epsilon, f"{name} must retain its width and height"
if os.environ.get("NXSTAGE_TUB_DEPTH_STUDY") == "1":
    assert new["Container back"][1][0] > old["Container back"][1][1] + 3, "Tub back must extend rearward"
    assert new["Container back"][1][1] < new["Cabinet rear wall"][1][0], "Retracted tub must fit ahead of the cabinet rear"
    assert new["Container back"][1][1] - 5.3 < -1.96 + .05, "The extended rear rim must clear the cabinet front"
    assert abs(new["Container left side"][1][1] - new["Container back"][1][1]) < .12, "Tub sides must reach the back"
if os.environ.get("NXSTAGE_FASCIA_TILT_STUDY") == "1":
    panel = bpy.data.objects["System One control fascia"]
    housing = bpy.data.objects["Inclined cycler fascia housing"]
    door = bpy.data.objects["Cycler door assembly"]
    assert panel.parent == door and housing.parent == door, "Fascia and housing must travel with the cycler door"
    normal = (panel.matrix_world.to_3x3() @ Vector((0, -1, 0))).normalized()
    assert normal.z > .4, f"Fascia should tilt upward: {normal}"
    for name in ("Photographed Add Fluid", "Photographed Stop control", "Photographed Volume Toggle"):
        assert bpy.data.objects[name].parent == panel, f"{name} must remain attached to the panel"
if os.environ.get("NXSTAGE_CYCLER_BASE_STUDY") == "1":
    support = bpy.data.objects["Cycler molded support base"]
    points = [support.matrix_world @ Vector(point) for point in support.bound_box]
    bottom, top = min(point.z for point in points), max(point.z for point in points)
    assert abs(bottom - new["Upper white shelf"][2][1]) < .03, "Support must rest on the shelf"
    assert abs(top - new["Upper machine shell"][2][0]) < .03, "Support must meet the cycler"
    assert new["Cycler door front shell"][2][0] > top, "The sliding door must clear the fixed support"
    assert not support.get("interactionTargetId"), "Support must not introduce an invented control"
if os.environ.get("NXSTAGE_CYCLER_GUIDE_STUDY") == "1":
    for side in ("left", "right"):
        channel = bpy.data.objects["Cycler " + side + " side guide channel"]
        points = [channel.matrix_world @ Vector(point) for point in channel.bound_box]
        assert channel.parent is None and not channel.get("interactionTargetId"), "The visible guide must stay fixed and non-interactive"
        assert min(point.y for point in points) > new["Cycler door front shell"][1][1] - .01, "Guide must sit behind the closed sliding door"
        assert max(point.y for point in points) < new["Upper machine shell"][1][0] + .01, "Guide must sit in front of the fixed shell"
        for index in range(1, 4):
            detail = bpy.data.objects[f"Cycler {side} guide metal detail {index}"]
            assert detail.parent is None and not detail.get("interactionTargetId"), "Guide detail must stay fixed and non-interactive"
if os.environ.get("NXSTAGE_CYCLER_CORD_STUDY") == "1":
    inlet = bpy.data.objects["Cycler rear power inlet"]
    plug = bpy.data.objects["Cycler rear power cord plug"]
    lead = bpy.data.objects["Cycler rear power cord"]
    clip = bpy.data.objects["Cycler power cord pale clip"]
    for obj in (plug, lead, clip):
        assert obj.parent is None and not obj.get("interactionTargetId"), "Power lead details must remain fixed and non-interactive"
    assert abs(plug.matrix_world.translation.x - inlet.matrix_world.translation.x) < .02
    assert abs(plug.matrix_world.translation.z - inlet.matrix_world.translation.z) < .02
    assert plug.matrix_world.translation.y > inlet.matrix_world.translation.y, "Plug must project out of the rear inlet"
if os.environ.get("NXSTAGE_CABINET_WINDOW_STUDY") == "1":
    stiles = [bpy.data.objects[name] for name in ("Cabinet door left stile", "Cabinet door right stile")]
    assert all(stile.parent and stile.parent.name == "Lower cabinet door hinge" for stile in stiles), "Both stiles must move with the cabinet door"
    left = max((stiles[0].matrix_world @ Vector(point)).x for point in stiles[0].bound_box)
    right = min((stiles[1].matrix_world @ Vector(point)).x for point in stiles[1].bound_box)
    assert abs((right - left) - 1.8) < .01 and abs((right + left) / 2 + .35) < .01, "The opening must remain narrower and left-offset"
print(f"Depth study geometry passed: estimated shell depth {depth:.3f} m; front, rear panel, pole, switch, shelf and cabinet aligned.")
