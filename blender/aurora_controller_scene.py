"""OBSOLETE: synthetic Aurora fixture scene.

Use blender/nxstage_system_one_scene.py for the real-device photo reconstruction.

Build a detailed Blender scene for the synthetic Aurora Infusion Controller.

Run in Blender's Scripting workspace or in background mode:
    blender -b --python blender/aurora_controller_scene.py

The scene is intentionally parametric and component-oriented. It is a visual
training model, not a clinical or manufacturing drawing.
"""

import bpy
import math
from mathutils import Vector


# Reset before module-level materials are created; resetting later would delete
# the material datablocks that the generated geometry references.
bpy.ops.wm.read_factory_settings(use_empty=True)

# ---------------------------------------------------------------------------
# Parameters (meters; the source fixture does not provide physical dimensions)
# ---------------------------------------------------------------------------
W = 4.4
D = 2.65
H = 6.2
BODY_Z = H / 2


# ---------------------------------------------------------------------------
# Materials
# ---------------------------------------------------------------------------
def mat(name, color, roughness=0.42, metallic=0.0, transmission=0.0, alpha=1.0, emission=None):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*color, alpha)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    if "Transmission Weight" in bsdf.inputs:
        bsdf.inputs["Transmission Weight"].default_value = transmission
    if "Alpha" in bsdf.inputs:
        bsdf.inputs["Alpha"].default_value = alpha
    if emission:
        bsdf.inputs["Emission Color"].default_value = (*emission, 1.0)
        bsdf.inputs["Emission Strength"].default_value = 1.6
    if alpha < 1.0:
        if hasattr(m, 'surface_render_method'):
            m.surface_render_method = 'DITHERED'
        elif hasattr(m, 'blend_method'):
            m.blend_method = 'BLEND'
        if hasattr(m, 'use_screen_refraction'):
            m.use_screen_refraction = True
    return m


BODY = mat("Enclosure | warm white ABS", (0.82, 0.84, 0.82), 0.3)
BODY_EDGE = mat("Enclosure edge | cool white", (0.68, 0.72, 0.72), 0.28)
PANEL = mat("Control panel | deep navy", (0.025, 0.10, 0.16), 0.28)
BLACK = mat("Rubber and gasket", (0.012, 0.015, 0.017), 0.68)
TOP = mat("Top module | graphite", (0.09, 0.11, 0.12), 0.4, metallic=0.18)
RIB = mat("Top ribs | satin aluminum", (0.52, 0.56, 0.56), 0.3, metallic=0.55)
AMBER = mat("Safety cover | amber polycarbonate", (0.82, 0.36, 0.035), 0.2, transmission=0.18, alpha=0.42)
MINT = mat("Prime indicator | mint", (0.20, 0.78, 0.66), 0.24, emission=(0.15, 0.65, 0.5))
YELLOW = mat("Ready indicator | amber", (0.95, 0.60, 0.08), 0.24, emission=(0.8, 0.35, 0.02))
RED = mat("Shutdown indicator | red", (0.82, 0.10, 0.12), 0.25, emission=(0.55, 0.02, 0.015))
ORANGE = mat("Line tubing | safety orange", (0.95, 0.24, 0.035), 0.32)
GLASS_DARK = mat("Sensor window | smoked", (0.02, 0.035, 0.038), 0.12, transmission=0.15, alpha=0.72)
FLOOR = mat("Studio floor", (0.018, 0.03, 0.035), 0.58)


# ---------------------------------------------------------------------------
# Scene helpers
# ---------------------------------------------------------------------------
def collection(name, parent=None):
    c = bpy.data.collections.new(name)
    (parent or bpy.context.scene.collection).children.link(c)
    return c


def move_to(obj, coll):
    for c in list(obj.users_collection):
        c.objects.unlink(obj)
    coll.objects.link(obj)
    return obj


def bevel(obj, amount=0.08, segments=3):
    mod = obj.modifiers.new("Manufacturing edge radius", "BEVEL")
    mod.width = amount
    mod.segments = segments
    mod.limit_method = 'ANGLE'
    return obj


def add_press_action(obj, depth=0.004, axis=(0.0, 1.0, 0.0)):
    """Author a short press/release clip for Blender review and GLB export.

    The browser still owns semantic actions; this clip is the authoring-side
    visual affordance and keeps the press motion inspectable in Blender.
    """
    origin = obj.location.copy()
    action = bpy.data.actions.new(f"{obj.name} | press-release")
    obj.animation_data_create()
    obj.animation_data.action = action
    for frame, offset in ((1, 0.0), (3, depth), (7, 0.0)):
        obj.location = origin + Vector(axis) * offset
        obj.keyframe_insert(data_path="location", frame=frame, group="Tactile press")
    obj.location = origin
    obj["interaction_animation_action"] = action.name
    return action


def cube(name, loc, scale, material, coll, bevel_amount=0.0, rotation=None):
    bpy.ops.mesh.primitive_cube_add(location=loc, rotation=rotation or (0, 0, 0))
    o = bpy.context.object
    o.name = name
    o.dimensions = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if material:
        o.data.materials.append(material)
    if bevel_amount:
        bevel(o, bevel_amount)
    move_to(o, coll)
    return o


def cyl(name, loc, radius, depth, material, coll, rotation=(0, 0, 0), vertices=48, bevel_amount=0.0):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=loc, rotation=rotation)
    o = bpy.context.object
    o.name = name
    if material:
        o.data.materials.append(material)
    if bevel_amount:
        bevel(o, bevel_amount, 2)
    move_to(o, coll)
    return o


def uv_sphere(name, loc, scale, material, coll):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=16, location=loc)
    o = bpy.context.object
    o.name = name
    o.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    o.data.materials.append(material)
    move_to(o, coll)
    return o


def curve_tube(name, points, radius, material, coll, bevel_resolution=4):
    cu = bpy.data.curves.new(name, 'CURVE')
    cu.dimensions = '3D'
    cu.resolution_u = 16
    cu.bevel_depth = radius
    cu.bevel_resolution = bevel_resolution
    spl = cu.splines.new('BEZIER')
    spl.bezier_points.add(len(points) - 1)
    for bp, p in zip(spl.bezier_points, points):
        bp.co = p
        bp.handle_left_type = 'AUTO'
        bp.handle_right_type = 'AUTO'
    o = bpy.data.objects.new(name, cu)
    coll.objects.link(o)
    cu.materials.append(material)
    return o


def text_label(name, body, loc, size, material, coll, rotation=(math.pi / 2, 0, 0)):
    cu = bpy.data.curves.new(name, 'FONT')
    cu.body = body
    cu.align_x = 'CENTER'
    cu.size = size
    cu.extrude = 0.008
    o = bpy.data.objects.new(name, cu)
    o.location = loc
    o.rotation_euler = rotation
    cu.materials.append(material)
    coll.objects.link(o)
    return o


# ---------------------------------------------------------------------------
# Device geometry
# ---------------------------------------------------------------------------
def build_device():
    root = collection("Aurora Infusion Controller | AIC-001")
    enclosure = collection("01 Enclosure", root)
    controls = collection("02 Control Panel | AIC-C01", root)
    cover = collection("03 Safety Cover | AIC-C02", root)
    sensor = collection("04 Line Sensor | AIC-C03", root)
    details = collection("05 Fasteners and seams", root)

    body = cube("Main enclosure", (0, 0, BODY_Z), (W, D, H), BODY, enclosure, 0.22)
    body["component_id"] = "AIC-ENCLOSURE"
    body["source_note"] = "Proportions inferred from schematic and reconstruction views"

    # Side inset panels and a lower service seam.
    cube("Left side inset", (-W / 2 - 0.012, 0.0, 3.2), (0.018, D - 0.32, 2.25), BODY_EDGE, details, 0.03, rotation=(0, math.pi / 2, 0))
    cube("Right side inset", (W / 2 + 0.012, 0.0, 3.2), (0.018, D - 0.32, 2.25), BODY_EDGE, details, 0.03, rotation=(0, math.pi / 2, 0))
    cube("Lower service seam", (0, -D / 2 - 0.012, 1.05), (W - 0.48, 0.018, 0.025), BODY_EDGE, details, 0.008)
    for x in (-W / 2 + 0.28, W / 2 - 0.28):
        cyl("Corner fastener", (x, -D / 2 - 0.025, 1.02), 0.055, 0.025, BLACK, details, rotation=(math.pi / 2, 0, 0), vertices=24)

    # A centered carrying handle is the strongest top-silhouette cue in the
    # orbit captures. Keep it separate so it can be revised or animated.
    handle = collection("Top carrying handle", root)
    cube("Handle left support", (-1.22, 0.08, H + 0.38), (0.30, 0.58, 0.82), TOP, handle, 0.09)
    cube("Handle right support", (1.22, 0.08, H + 0.38), (0.30, 0.58, 0.82), TOP, handle, 0.09)
    cube("Handle grip", (0, 0.08, H + 0.78), (2.74, 0.58, 0.34), RIB, handle, 0.10)
    cube("Handle underside shadow gap", (0, -0.02, H + 0.55), (2.25, 0.18, 0.13), BLACK, handle, 0.03)
    for x in (-0.72, -0.36, 0.0, 0.36, 0.72):
        cube("Handle grip rib", (x, -0.23, H + 0.80), (0.055, 0.06, 0.24), BLACK, handle, 0.012)

    # Front panel: the input/reference drawings show a dark rectangular panel
    # with three distinct circular indicators/buttons.
    front_y = -D / 2 - 0.045
    cube("Control panel bezel", (0, front_y, 3.52), (3.55, 0.12, 1.58), PANEL, controls, 0.14)
    cube("Control panel inner plate", (0, front_y - 0.065, 3.52), (3.12, 0.035, 1.16), BLACK, controls, 0.04)
    controls_data = [(-1.02, MINT, "PRIME"), (0.0, YELLOW, "READY"), (1.02, RED, "STOP")]
    for x, material, label in controls_data:
        button = cyl(f"{label} button", (x, front_y - 0.13, 3.56), 0.30, 0.14, material, controls, rotation=(math.pi / 2, 0, 0), bevel_amount=0.035)
        button["interaction_target_id"] = f"AIC-C01-{label}"
        button["interaction_target_display_name"] = f"{label.title()} button"
        button["press_depth_meters"] = 0.004
        button["press_axis"] = (0.0, 1.0, 0.0)
        button["interaction_action"] = "press"
        add_press_action(button)
        cyl(f"{label} button bezel", (x, front_y - 0.08, 3.56), 0.36, 0.06, BLACK, controls, rotation=(math.pi / 2, 0, 0), bevel_amount=0.018)
        # The colored cap sits slightly forward of its dark bezel.
        cap = cyl(f"{label} colored cap", (x, front_y - 0.145, 3.56), 0.255, 0.07, material, controls, rotation=(math.pi / 2, 0, 0), bevel_amount=0.03)
        add_press_action(cap)
        text_label(f"{label} label", label, (x, front_y - 0.205, 3.02), 0.15, BODY_EDGE, controls, rotation=(math.pi / 2, 0, 0))

    controls["component_id"] = "AIC-C01"
    controls["interaction"] = "select,press"
    controls["interaction_note"] = "Buttons use local bounded press feedback; certification actions remain server-authoritative."

    # Safety cover: a hinged transparent amber shield over the control area.
    pivot = bpy.data.objects.new("Safety cover hinge pivot", None)
    pivot.location = (1.62, front_y - 0.02, 4.38)
    cover.objects.link(pivot)
    cover_frame = cube("Safety cover transparent shield", (0.0, -0.10, 0.0), (3.42, 0.10, 1.86), AMBER, cover, 0.12)
    cover_frame.parent = pivot
    cover_frame.location = (-1.62, -0.22, -0.86)
    cover_frame.rotation_euler = (math.radians(-12), math.radians(-3), math.radians(-72))
    # Raised rim makes the cover readable even in solid shading.
    for z in (-1.76, 0.04):
        rim = cube("Safety cover rim", (-1.62, -0.30, z), (3.45, 0.08, 0.08), ORANGE, cover, 0.025)
        rim.parent = pivot
    for x in (-3.28, 0.04):
        rim = cube("Safety cover side rim", (x, -0.30, -0.86), (0.08, 0.08, 1.85), ORANGE, cover, 0.025)
        rim.parent = pivot
    hinge = cyl("Safety cover hinge", (1.62, front_y - 0.02, 4.38), 0.12, 1.0, BLACK, cover, rotation=(0, math.pi / 2, 0), vertices=32)
    cover["component_id"] = "AIC-C02"
    cover["interaction"] = "rotate"
    cover["rotation_note"] = "Shown open for simulated priming; close/open state is adjustable on hinge pivot"

    # Side line sensor assembly on the device's right side.
    sx = W / 2 + 0.24
    cyl("Line sensor mounting post", (sx, -0.08, 3.35), 0.12, 1.8, BLACK, sensor, rotation=(0, math.pi / 2, 0), vertices=32, bevel_amount=0.02)
    cube("Line sensor upper housing", (sx + 0.2, -0.02, 4.03), (0.62, 0.74, 0.58), TOP, sensor, 0.12)
    cube("Line sensor lower housing", (sx + 0.2, -0.02, 2.70), (0.62, 0.74, 0.58), TOP, sensor, 0.12)
    for z in (3.12, 3.45):
        cyl("Sensor roller", (sx + 0.52, -0.04, z), 0.20, 0.16, RIB, sensor, rotation=(0, math.pi / 2, 0), vertices=32, bevel_amount=0.025)
    cube("Sensor optical window", (sx + 0.52, -0.42, 3.28), (0.30, 0.08, 0.42), GLASS_DARK, sensor, 0.035)
    curve_tube("Orange line through sensor", [(sx + 0.52, -0.50, 2.05), (sx + 0.55, -0.52, 2.62), (sx + 0.55, -0.52, 3.28), (sx + 0.55, -0.52, 4.05), (sx + 0.50, -0.50, 4.65)], 0.065, ORANGE, sensor)
    curve_tube("Sensor cable", [(sx + 0.35, 0.28, 3.5), (sx + 0.75, 0.55, 3.35), (sx + 0.95, 0.8, 2.75)], 0.045, BLACK, sensor)
    sensor["component_id"] = "AIC-C03"
    sensor["interaction"] = "translate"
    sensor["translation_note"] = "Shown as a removable inspection assembly on the right side"

    # Identification plate and small status marks.
    plate = cube("Identification plate", (0.0, D / 2 + 0.01, 1.55), (2.15, 0.035, 0.62), BODY_EDGE, details, 0.025)
    text_label("Device model label", "AURORA  |  AIC-001", (0, D / 2 + 0.035, 1.69), 0.13, BLACK, details, rotation=(math.pi / 2, 0, math.pi))
    text_label("Device status label", "INFUSION CONTROLLER", (0, D / 2 + 0.035, 1.47), 0.10, BLACK, details, rotation=(math.pi / 2, 0, math.pi))

    # Make the enclosure root easy to select and locate.
    root["fixture_id"] = "AIC-001"
    root["provenance"] = "synthetic training fixture"
    root["source_assets"] = "fixtures/reference/images/aic-overview.png; aic-control-panel.png; aic-safety-cover.png; output reconstruction previews"
    root["fidelity_status"] = "SEMANTIC_FIXTURE"
    root["fidelity_source_type"] = "PROCEDURAL_SYNTHETIC"
    root["scale_status"] = "UNMEASURED"
    root["hidden_surface_uncertainty"] = "UNKNOWN"
    root["fidelity_summary"] = "Detailed authored training geometry for interaction rehearsal; not a real-device reconstruction or dimensional/manufacturing model."
    return root


# ---------------------------------------------------------------------------
# Presentation scene
# ---------------------------------------------------------------------------
def look_at(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat('-Z', 'Y').to_euler()


def set_eevee_engine(scene):
    try:
        scene.render.engine = 'BLENDER_EEVEE_NEXT'
    except TypeError:
        scene.render.engine = 'BLENDER_EEVEE'


def ensure_world(scene, name):
    if scene.world is None:
        scene.world = bpy.data.worlds.new(name)
    return scene.world


def add_camera(name, loc, target, lens, coll):
    data = bpy.data.cameras.new(name)
    data.lens = lens
    o = bpy.data.objects.new(name, data)
    coll.objects.link(o)
    o.location = loc
    look_at(o, target)
    return o


def build_presentation():
    presentation = collection("Presentation | cameras and lighting")
    bpy.ops.mesh.primitive_plane_add(size=40, location=(0, 0, -0.02))
    floor = bpy.context.object
    floor.name = "Studio floor"
    floor.data.materials.append(FLOOR)
    move_to(floor, presentation)

    for name, loc, energy, size, color in [
        ("Key softbox", (-6, -8, 11), 1050, 5.0, (1.0, 0.86, 0.72)),
        ("Fill softbox", (7, -5, 7), 750, 4.0, (0.55, 0.75, 1.0)),
        ("Rim light", (4, 5, 10), 1200, 3.0, (0.62, 0.80, 1.0)),
    ]:
        data = bpy.data.lights.new(name, 'AREA')
        data.energy = energy
        data.shape = 'DISK'
        data.size = size
        data.color = color
        o = bpy.data.objects.new(name, data)
        presentation.objects.link(o)
        o.location = loc
        look_at(o, (0, 0, 3.2))

    camera = add_camera("CAM_Hero", (10.5, -12.5, 9.2), (0, 0, 3.1), 56, presentation)
    add_camera("CAM_Front", (0, -15.5, 4.0), (0, 0, 3.2), 64, presentation)
    add_camera("CAM_Sensor", (12.5, -8.0, 5.2), (1.1, 0, 3.2), 70, presentation)
    add_camera("CAM_Back", (-8.0, 10.5, 6.4), (0, 0, 3.2), 60, presentation)

    scene = bpy.context.scene
    scene.camera = camera
    set_eevee_engine(scene)
    scene.render.resolution_x = 900
    scene.render.resolution_y = 900
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.render.filepath = "//aurora_hero.png"
    scene.render.film_transparent = False
    ensure_world(scene, "Aurora Studio World").color = (0.005, 0.012, 0.016)
    scene.view_settings.look = 'AgX - Medium High Contrast'
    scene["scene_purpose"] = "Detailed visual training model derived from synthetic schematic references"
    scene["measurement_status"] = "unscaled; source fixture provides no physical dimensions"


def main():
    build_device()
    build_presentation()
    # Select the top-level collection's objects for a useful first open state.
    bpy.ops.object.select_all(action='DESELECT')
    bpy.ops.wm.save_as_mainfile(filepath="//aurora_infusion_controller.blend")
    bpy.context.scene.render.filepath = "//aurora_hero.png"
    bpy.ops.render.render(write_still=True)


if __name__ == "__main__":
    main()
