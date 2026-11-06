"""Build an isolated deeper-body study from the photo-grounded review source.

Run from the workspace root with Blender's Python environment. The added depth
is calibrated to an approximate published System One dimension, not a direct
measurement of the photographed unit. This does not replace the review asset.
"""
import importlib.util
import os
import bpy
from mathutils import Matrix, Vector
from math import radians

spec = importlib.util.spec_from_file_location("nxstage_review_source", "blender/nxstage_system_one_interaction_review.py")
source = importlib.util.module_from_spec(spec)
spec.loader.exec_module(source)
device = source.build_device()
bpy.context.view_layer.update()

# The inclined fascia projects farther forward. Use a shorter rear extension
# for that version to keep the overall body near the published family depth.
# These extents and the exact photographed variant remain unmeasured.
fascia_study = os.environ.get("NXSTAGE_FASCIA_TILT_STUDY") == "1"
extra = 1.80 if fascia_study else 2.85

def shift_y(obj, distance):
    matrix = obj.matrix_world.copy()
    matrix.translation.y += distance
    obj.matrix_world = matrix
    bpy.context.view_layer.update()

def extend_back(name, distance=extra):
    obj = bpy.data.objects[name]
    # The cabinet parts inherit a vertical scale; assigning dimensions here
    # would apply that parent scale twice. Extend only their local depth.
    obj.scale.y *= (obj.dimensions.y + distance) / obj.dimensions.y
    bpy.context.view_layer.update()
    shift_y(obj, distance / 2)

for name in ("Upper machine shell", "Upper white shelf", "Cabinet left wall", "Cabinet right wall", "Cabinet floor", "Cabinet top"):
    extend_back(name)

# Move complete rear assemblies as rigid parts. Children of a moved parent
# must not be shifted again; the rocker remains free to rotate at its pivot.
rear_prefixes = ("Cycler rear ", "Cycler power switch pivot", "Rear ",
                 "Blue rear fluid tube", "Black rear hose", "White rear cable", "IV pole", "IV hanger ")
objects = list(device.all_objects)
rear_objects = {obj for obj in objects if obj.name.startswith(rear_prefixes)}
for obj in rear_objects:
    if obj.parent not in rear_objects:
        shift_y(obj, extra)
for obj in objects:
    if "side carry handle" in obj.name:
        shift_y(obj, extra / 2)
    if obj.name in ("Shelf center black insert", "Cabinet rear wall"):
        shift_y(obj, extra)
    if obj.name.startswith(("Caster wheel", "Caster fork")) and obj.matrix_world.translation.y > 0:
        shift_y(obj, extra)

# Position the top accessory as a rigid assembly rather than stretching its
# controls. The original source uses a separate collection with parented keys.
accessory = bpy.data.collections["01A Upper accessory case"]
for obj in accessory.objects:
    if obj.parent is None:
        shift_y(obj, extra / 2)

tub_study = os.environ.get("NXSTAGE_TUB_DEPTH_STUDY") == "1"
if tub_study:
    # The open-cabinet photos show a long, open-topped container, extending
    # substantially behind its front face. Keep its front fixed while the
    # bottom, sides and rims extend toward the deeper cabinet rear. The exact
    # depth and travel remain visual estimates, not measurements.
    tub_extra = 3.2
    for name in ("Container left side", "Container right side", "Container bottom", "Tub left rim", "Tub right rim"):
        extend_back(name, tub_extra)
    for name in ("Container back", "Tub back rim"):
        shift_y(bpy.data.objects[name], tub_extra)
    # Preserve sufficient outward travel for the back rim to clear the door.
    bpy.data.objects["PureFlow tub travel axis"]["openTranslationMeters"] = 2.1 + tub_extra

if fascia_study:
    # The side photographs show the fascia leaning back at the top and a
    # substantial molded side below it. Rotate the entire panel, including its
    # existing button targets, about its center. Angle and thickness remain
    # visual estimates; no open-door or dimensional measurement was supplied.
    panel = bpy.data.objects["System One control fascia"]
    bpy.context.view_layer.update()
    matrix = panel.matrix_world.copy()
    center = matrix.translation.copy()
    panel.matrix_world = Matrix.Translation(center + Vector((0, -.42, 0))) @ Matrix.Rotation(radians(-24), 4, 'X') @ Matrix.Translation(-center) @ matrix
    bpy.context.view_layer.update()
    # The old shallow shoulder would cover the raised edge of the new panel.
    bpy.data.objects.remove(bpy.data.objects["Upper front shoulder"], do_unlink=True)
    front = [panel.matrix_world @ Vector((x, -.055, z)) for x, z in
             ((-2.04, -1.01), (2.04, -1.01), (2.04, 1.01), (-2.04, 1.01))]
    for point in front:
        point.y += .025
    # Taper the housing back into the existing lower front face rather than
    # leaving an abrupt shelf below the control panel.
    lower_z, lower_y = 3.60, -1.21
    front.extend((Vector((front[0].x, lower_y, lower_z)), Vector((front[1].x, lower_y, lower_z))))
    back = [Vector((point.x, -1.19, point.z)) for point in front]
    mesh = bpy.data.meshes.new("Inclined cycler fascia housing mesh")
    mesh.from_pydata([tuple(p) for p in front + back], [], [(4, 5, 1, 0), (0, 1, 2, 3), (6, 7, 11, 10), (9, 8, 7, 6), (4, 10, 11, 5), (3, 2, 8, 9), (4, 0, 3, 9, 6, 10), (5, 11, 7, 8, 2, 1)])
    mesh.materials.append(source.CREAM)
    housing = bpy.data.objects.new("Inclined cycler fascia housing", mesh)
    bpy.data.collections["01 Main System One head"].objects.link(housing)
    bevel = housing.modifiers.new("Rounded housing edges", 'BEVEL')
    bevel.width = .05
    bevel.segments = 3
    housing.modifiers.new("Weighted housing normals", 'WEIGHTED_NORMAL')
    housing.parent = bpy.data.objects["Cycler door assembly"]
    housing.matrix_world = Matrix.Identity(4)
    # Keep the photographed curved front detail in front of the transition.
    detail = bpy.data.objects["Central recessed face"]
    world, inverse = detail.matrix_world.copy(), detail.matrix_world.inverted()
    upper_z, upper_y = front[0].z, front[0].y
    for vertex in detail.data.vertices:
        point = world @ vertex.co
        if lower_z < point.z < upper_z:
            surface = lower_y + (upper_y - lower_y) * (point.z - lower_z) / (upper_z - lower_z)
            point.y = min(point.y, surface - .015)
            vertex.co = inverse @ point

base_study = os.environ.get("NXSTAGE_CYCLER_BASE_STUDY") == "1"
if base_study:
    # The supplied side views show a separate molded gray base between the
    # cycler and the white shelf. Its outline and thickness are estimates.
    # Move each complete upper assembly once so the sliding door clears it.
    for collection in (bpy.data.collections["01 Main System One head"], bpy.data.collections["02 Black side rails and handles"], accessory):
        for obj in collection.objects:
            if obj.parent is None:
                matrix = obj.matrix_world.copy()
                matrix.translation.z += .16
                obj.matrix_world = matrix
                bpy.context.view_layer.update()
    base_material = source.material("Cycler base light gray", (.69, .70, .68), .43)
    base = source.cube("Cycler molded support base", (0, .80, 1.31), (4.72, 4.70, .16), base_material, bpy.data.collections["03 White tray and shelf"], .10)
    base["decorative"] = True

guide_study = os.environ.get("NXSTAGE_CYCLER_GUIDE_STUDY") == "1"
if guide_study:
    # Closed side photos show a dark vertical strip with small metal details
    # between the fixed shell and the front door. Depict the visible outlines
    # as fixed decoration; hidden rail structure and movement are unverified.
    head = bpy.data.collections["01 Main System One head"]
    elevation = .16 if base_study else 0
    for side, sign in (("left", -1), ("right", 1)):
        channel = source.cube("Cycler " + side + " side guide channel", (sign * 2.245, -.65, 3.60 + elevation), (.08, .22, 4.25), source.BLACK_RUBBER, head, .025)
        channel["decorative"] = True
        for index, z in enumerate((2.05, 3.65, 5.30), 1):
            detail = source.cube("Cycler " + side + " guide metal detail " + str(index), (sign * 2.295, -.65, z + elevation), (.022, .13, .075), source.METAL, head, .012)
            detail["decorative"] = True

cord_study = os.environ.get("NXSTAGE_CYCLER_CORD_STUDY") == "1"
if cord_study:
    # The supplied rear photograph shows a black lead plugged into the inlet
    # beside the cycler rocker, with a pale clip further down the cable. The
    # exact routing is occluded; this is a fixed visual detail, not a power
    # connection or an additional control.
    bpy.context.view_layer.update()
    inlet = bpy.data.objects["Cycler rear power inlet"].matrix_world.translation.copy()
    tubing = bpy.data.collections["05 Tubing, cables, poles"]
    plug = source.cube("Cycler rear power cord plug", (inlet.x, inlet.y + .11, inlet.z), (.20, .22, .25), source.BLACK_RUBBER, tubing, .035)
    plug["decorative"] = True
    points = [(inlet.x, inlet.y + .20, inlet.z - .04),
              (inlet.x + .08, inlet.y + .31, inlet.z - .20),
              (inlet.x + .35, inlet.y + .48, inlet.z - .65),
              (inlet.x + .75, inlet.y + .65, inlet.z - 1.18),
              (inlet.x + 1.15, inlet.y + .72, inlet.z - 1.90),
              (inlet.x + 1.40, inlet.y + .80, inlet.z - 2.70)]
    lead = source.curve("Cycler rear power cord", points, .042, source.BLACK_RUBBER, tubing)
    lead["decorative"] = True
    clip = source.cube("Cycler power cord pale clip", (inlet.x + .57, inlet.y + .57, inlet.z - .94), (.18, .17, .31), source.CREAM_HI, tubing, .035, rotation=(0, radians(-32), 0))
    clip["decorative"] = True

window_study = os.environ.get("NXSTAGE_CABINET_WINDOW_STUDY") == "1"
if window_study:
    # In the supplied partially open door view the window is narrower and
    # offset toward the hinged side. Preserve the frame and hinge while
    # changing the two stiles. Perspective and exact dimensions are unknown.
    for name, width, center_x in (("Cabinet door left stile", 1.10, -1.80),
                                  ("Cabinet door right stile", 1.80, 1.45)):
        stile = bpy.data.objects[name]
        stile.scale.x *= width / stile.dimensions.x
        bpy.context.view_layer.update()
        matrix = stile.matrix_world.copy()
        matrix.translation.x = center_x
        stile.matrix_world = matrix
        bpy.context.view_layer.update()

device["depth_study"] = "approximate deeper body; overall extents and attachments are unmeasured"
output = os.path.abspath("output/nxstage-window-study" if window_study else "output/nxstage-cord-study" if cord_study else "output/nxstage-guide-study" if guide_study else "output/nxstage-support-study" if base_study else "output/nxstage-fascia-study" if fascia_study else "output/nxstage-tub-depth-study" if tub_study else "output/nxstage-depth-study")
os.makedirs(output, exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(output, "depth-study.blend"))
bpy.ops.object.select_all(action='DESELECT')
device_objects = list(device.all_objects)
source.ensure_uvs(device_objects)
for obj in device_objects:
    obj.select_set(True)
bpy.context.view_layer.objects.active = device_objects[0]
bpy.ops.export_scene.gltf(filepath=os.path.join(output, "nxstage-system-one.glb"), export_format='GLB', export_apply=True, export_extras=True, export_vertex_color='ACTIVE', export_all_vertex_colors=False, use_selection=True)
