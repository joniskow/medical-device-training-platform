"""Photo-grounded hard-surface reconstruction of the uploaded System One device.

This is an editable Blender scene generator, not a clinical/manufacturing model.
The proportions are normalized from the uploaded photographs; no physical scale
reference was supplied. Run from the repository root after installing Blender:

    blender -b --python blender/nxstage_system_one_scene.py

Outputs:
    blender/nxstage_system_one.blend
    blender/nxstage_system_one_preview.png
"""

import math
import os
import bpy
from mathutils import Vector


# Approximate normalized dimensions, derived from the 20-photo set.
HEAD_W, HEAD_D, HEAD_H = 4.45, 2.55, 4.75
TRAY_W, TRAY_D = 5.55, 3.95
BASE_W, BASE_D, BASE_H = 4.90, 3.50, 2.35


def material(name, color, roughness=0.42, metallic=0.0):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*color, 1.0)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    return m


CREAM = material("Molded cream ABS", (0.79, 0.77, 0.69), 0.32)
CREAM_HI = material("Cream edge highlight", (0.91, 0.88, 0.80), 0.30)
BLACK = material("Gloss black rails and trim", (0.015, 0.017, 0.018), 0.22)
BLACK_RUBBER = material("Black rubber", (0.008, 0.009, 0.010), 0.72)
GRAY = material("Rear service gray", (0.43, 0.45, 0.45), 0.52)
METAL = material("Brushed stainless steel", (0.55, 0.58, 0.57), 0.22, 0.72)
PANEL = material("Control fascia light gray", (0.76, 0.77, 0.76), 0.42)
MAROON = material("Control fascia dark maroon", (0.16, 0.055, 0.07), 0.38)
GREEN = material("Control green", (0.12, 0.64, 0.40), 0.35)
YELLOW = material("Control yellow", (0.94, 0.78, 0.04), 0.32)
CORAL = material("Control coral", (0.96, 0.28, 0.17), 0.32)
LCD = material("LCD green-black", (0.20, 0.30, 0.10), 0.28)
BLUE = material("Tubing blue", (0.02, 0.18, 0.78), 0.30)
WHITE = material("Tubing white", (0.86, 0.86, 0.82), 0.38)
TEXT = material("Printed markings", (0.03, 0.035, 0.035), 0.55)


def new_collection(name, parent=None):
    c = bpy.data.collections.new(name)
    (parent or bpy.context.scene.collection).children.link(c)
    return c


def move(obj, c):
    for old in list(obj.users_collection):
        old.objects.unlink(obj)
    c.objects.link(obj)
    return obj


def cube(name, loc, dims, mat, c, bevel=0.0, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(location=loc, rotation=rotation)
    o = bpy.context.object
    o.name = name
    o.dimensions = dims
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if mat:
        o.data.materials.append(mat)
    if bevel:
        b = o.modifiers.new("Rounded molded edge", "BEVEL")
        b.width = bevel
        b.segments = 4
        b.limit_method = 'ANGLE'
    return move(o, c)


def cylinder(name, loc, radius, depth, mat, c, rotation=(0, 0, 0), vertices=32, bevel=0.0):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=loc, rotation=rotation)
    o = bpy.context.object
    o.name = name
    if mat:
        o.data.materials.append(mat)
    if bevel:
        b = o.modifiers.new("Edge radius", "BEVEL")
        b.width = bevel
        b.segments = 3
    return move(o, c)


def curve(name, points, radius, mat, c):
    data = bpy.data.curves.new(name, 'CURVE')
    data.dimensions = '3D'
    data.resolution_u = 16
    data.bevel_depth = radius
    data.bevel_resolution = 4
    s = data.splines.new('BEZIER')
    s.bezier_points.add(len(points) - 1)
    for p, co in zip(s.bezier_points, points):
        p.co = co
        p.handle_left_type = 'AUTO'
        p.handle_right_type = 'AUTO'
    o = bpy.data.objects.new(name, data)
    c.objects.link(o)
    data.materials.append(mat)
    return o


def text(name, body, loc, size, mat, c, rotation=(math.pi / 2, 0, 0)):
    data = bpy.data.curves.new(name, 'FONT')
    data.body = body
    data.align_x = 'CENTER'
    data.size = size
    data.extrude = 0.006
    o = bpy.data.objects.new(name, data)
    o.location = loc
    o.rotation_euler = rotation
    data.materials.append(mat)
    c.objects.link(o)
    return o


def trapezoid(name, center, width, height, mat, c, y=-1.36, z=None):
    """Flat trapezoid used for the three distinctive control bands."""
    x, cz = center if z is None else (center, z)
    verts = [(x - width * .50, y, cz + height * .50),
             (x + width * .50, y, cz + height * .50),
             (x + width * .38, y, cz - height * .50),
             (x - width * .38, y, cz - height * .50)]
    mesh = bpy.data.meshes.new(name + " mesh")
    mesh.from_pydata(verts, [], [(0, 1, 2, 3)])
    mesh.materials.append(mat)
    o = bpy.data.objects.new(name, mesh)
    c.objects.link(o)
    return o


def face_panel(c, front_y):
    panel = new_collection("01 Front control fascia", c)
    base = cube("System One control fascia", (0, front_y, 5.05), (3.92, 0.15, 1.55), PANEL, panel, .15, rotation=(math.radians(-6), 0, 0))
    base["component_id"] = "control-fascia"

    # Three dark status windows across the top.
    for x, col in zip((-1.02, 0.0, 1.02), (BLACK, BLACK, MAROON)):
        cube("Status window", (x, front_y - .10, 5.60), (.83, .035, .20), col, panel, .025)

    # Three rows of maroon center bars with colored triangular end fields.
    for row, (z, col) in enumerate(((5.25, GREEN), (4.86, YELLOW), (4.47, CORAL)), start=1):
        trapezoid(f"Row {row} left colored field", (-.86, z), .78, .34, col, panel, front_y - .14)
        trapezoid(f"Row {row} center display", (0.0, z), 1.50, .34, MAROON, panel, front_y - .15)
        trapezoid(f"Row {row} right colored field", (.86, z), .78, .34, col, panel, front_y - .14)
        cylinder(f"Row {row} left warning marker", (-1.18, front_y - .19, z - .11), .055, .025, BLACK, panel, rotation=(math.pi / 2, 0, 0))
        cylinder(f"Row {row} right warning marker", (1.18, front_y - .19, z + .11), .055, .025, BLACK, panel, rotation=(math.pi / 2, 0, 0))

    # Primary icon/control shapes around the bands.
    cube("Left icon tile", (-1.64, front_y - .14, 5.08), (.46, .035, .54), CREAM_HI, panel, .07)
    cube("Left narrow icon tile", (-1.30, front_y - .15, 4.68), (.23, .035, .55), CREAM_HI, panel, .05)
    cylinder("Green kidney control", (-1.64, front_y - .17, 4.48), .21, .045, GREEN, panel, rotation=(math.pi / 2, 0, 0), vertices=24)
    cylinder("Green L per hour control", (1.53, front_y - .18, 5.18), .22, .045, GREEN, panel, rotation=(math.pi / 2, 0, 0), vertices=24)
    cylinder("Red stop control", (1.63, front_y - .18, 4.83), .23, .07, CORAL, panel, rotation=(math.pi / 2, 0, 0), vertices=8)
    cube("Yellow mute control", (1.63, front_y - .17, 4.46), (.42, .045, .42), YELLOW, panel, .06)
    text("System One label", "System One", (-1.45, front_y - .21, 5.86), .10, TEXT, panel)
    text("NxStage label", "NxStage", (0.0, front_y - .22, 4.15), .15, TEXT, panel)
    text("Flow label", "L/hr", (1.53, front_y - .23, 5.18), .10, TEXT, panel)
    text("Rate label", "ml/min", (1.50, front_y - .23, 4.50), .08, TEXT, panel)
    return panel


def add_vent_grid(c, y, z, width=2.0, rows=2, cols=14):
    vent = new_collection("Rear ventilation grille", c)
    for row in range(rows):
        for col in range(cols):
            x = -width / 2 + (col + .5) * width / cols
            zz = z + (row - (rows - 1) / 2) * .16
            cube("Vent slot", (x, y, zz), (0.055, .035, .10), BLACK, vent, .018)
    return vent


def build_device():
    root = new_collection("NxStage System One | photo reconstruction")
    head = new_collection("01 Main System One head", root)
    rails = new_collection("02 Black side rails and handles", root)
    tray = new_collection("03 White tray and shelf", root)
    base = new_collection("04 Lower black base and rear service", root)
    tubing = new_collection("05 Tubing, cables, poles", root)
    detail = new_collection("06 Labels, fasteners, reference notes", root)

    # Upper shell: layered molded housing, with a shallow front taper.
    cube("Upper machine shell", (0, 0, 3.60), (HEAD_W, HEAD_D, HEAD_H), CREAM, head, .26)
    cube("Upper front shoulder", (0, -1.08, 4.82), (4.08, .32, 1.15), CREAM_HI, head, .18, rotation=(math.radians(-7), 0, 0))
    cube("Front lower molded section", (0, -1.02, 3.15), (3.95, .34, 1.10), CREAM_HI, head, .18, rotation=(math.radians(7), 0, 0))
    cube("Central recessed face", (0, -1.19, 3.80), (2.70, .035, .92), CREAM, head, .28)
    add_vent_grid(head, -1.38, 3.92, width=1.30, rows=2, cols=14)
    face_panel(root, -1.28)

    # The large vertical side rails and front cross bar are visually dominant.
    for x in (-2.25, 2.25):
        curve("Vertical black side rail", [(x, -1.10, 1.45), (x, -1.12, 3.15), (x, -1.04, 5.70)], .10, BLACK, rails)
        curve("Angled rail mount", [(x, -1.04, 5.70), (x * .96, -.82, 5.95), (x * .96, -.76, 6.10)], .095, BLACK, rails)
    curve("Front black safety crossbar", [(-2.25, -1.20, 1.42), (0, -1.32, 1.30), (2.25, -1.20, 1.42)], .105, BLACK, rails)
    # Side pivot plates/handles, seen prominently in the oblique photographs.
    for x in (-2.34, 2.34):
        cube("Side pivot plate", (x, -.32, 3.05), (.20, .50, 1.45), BLACK, rails, .10, rotation=(0, math.radians(-22 if x < 0 else 22), 0))
        cylinder("Side pivot fastener", (x * 1.02, -.62, 3.18), .09, .04, METAL, rails, rotation=(0, math.pi / 2, 0))

    # White shelf/tray under the head with molded rounded recesses.
    cube("Upper white shelf", (0, 0, 1.05), (TRAY_W, TRAY_D, .36), CREAM_HI, tray, .18)
    cube("Shelf left recessed pad", (-1.75, -1.05, 1.25), (1.25, .62, .035), CREAM, tray, .12)
    cube("Shelf right recessed pad", (1.75, -1.05, 1.25), (1.25, .62, .035), CREAM, tray, .12)
    cube("Shelf center black insert", (0, 1.30, 1.24), (1.52, .40, .05), BLACK, tray, .06)

    # Lower black pedestal/cart and wheels.
    cube("Lower black cart", (0, .10, -.35), (BASE_W, BASE_D, BASE_H), BLACK, base, .16)
    cube("Lower front inset panel", (0, -1.70, .15), (2.40, .04, .86), BLACK_RUBBER, base, .05)
    cube("Lower front LCD", (0, -1.74, .33), (1.25, .035, .30), LCD, base, .03)
    for x, col in ((-.52, GREEN), (.52, CORAL)):
        cylinder("Lower status button", (x, -1.78, -.02), .13, .06, col, base, rotation=(math.pi / 2, 0, 0), vertices=32)
    for x in (-.82, -.52):
        trapezoid("Lower blue arrow", x, .22, .22, BLUE, base, -1.78, z=.02)
    for x in (-1.86, 1.86):
        for y in (-1.20, 1.20):
            cylinder("Caster wheel", (x, y, -1.62), .28, .16, BLACK_RUBBER, base, rotation=(math.pi / 2, 0, 0), vertices=32)
            cube("Caster fork", (x, y, -1.38), (.16, .16, .35), METAL, base, .04)

    # Rear service side visible in the photographs.
    cube("Rear gray service cover", (0, 1.38, -.05), (3.60, .08, 1.85), GRAY, base, .06)
    cube("Rear upper vent frame", (0, 1.43, 3.95), (3.25, .06, 1.15), CREAM, base, .08)
    add_vent_grid(base, 1.48, 4.04, width=2.55, rows=5, cols=22)
    cube("Rear lower port panel", (0, 1.47, -1.00), (3.55, .08, .55), BLACK, base, .04)
    for x, col in ((-1.25, WHITE), (-.60, BLACK), (.65, BLUE), (1.32, BLACK)):
        cylinder("Rear cable port", (x, 1.56, -1.02), .13, .16, col, base, rotation=(math.pi / 2, 0, 0), vertices=32, bevel=.02)
    cube("Rear central pole socket", (0, 1.55, -1.42), (.42, .28, .34), BLACK, base, .08)

    # Tubing and cables follow the major paths visible in the photos.
    curve("Blue rear fluid tube", [(1.18, 1.60, -1.05), (1.75, 1.85, -1.50), (2.25, 1.70, -2.25), (2.45, .80, -2.65)], .065, BLUE, tubing)
    curve("Black rear hose", [(-1.1, 1.62, -1.04), (-1.55, 1.88, -.55), (-2.15, 1.70, -1.30), (-2.40, .90, -2.15)], .075, BLACK_RUBBER, tubing)
    curve("White rear cable", [(-1.75, 1.62, -.95), (-1.72, 1.95, -1.35), (-1.35, 1.90, -2.25), (-.90, 1.30, -2.55)], .045, WHITE, tubing)
    curve("Front left blue tube", [(-2.45, -.65, 1.00), (-2.75, -1.0, .35), (-2.80, -1.45, -.25), (-2.30, -1.85, -1.35)], .055, BLUE, tubing)
    for z in (6.45, 7.10):
        cylinder("IV pole", (0, 1.02, z), .055, 1.0, METAL, tubing)
    cylinder("IV pole lower", (0, 1.02, 6.0), .065, 1.5, METAL, tubing)
    curve("IV hanger left", [(-.02, 1.02, 7.58), (-.80, 1.02, 7.75), (-1.05, 1.02, 7.55), (-.90, 1.02, 7.34)], .035, METAL, tubing)
    curve("IV hanger right", [(.02, 1.02, 7.58), (.80, 1.02, 7.75), (1.05, 1.02, 7.55), (.90, 1.02, 7.34)], .035, METAL, tubing)

    root["source"] = "20 uploaded photos under Downloads/Photos-1-001"
    root["device"] = "NxStage System One training/demonstration machine"
    root["scale_status"] = "relative photo-derived proportions; no measured scale reference"
    root["fidelity_status"] = "visual reconstruction; hidden geometry and exact dimensions remain unverified"
    return root


def look_at(o, target):
    o.rotation_euler = (Vector(target) - o.location).to_track_quat('-Z', 'Y').to_euler()


def build_presentation():
    c = new_collection("Presentation lighting and cameras")
    bpy.ops.mesh.primitive_plane_add(size=40, location=(0, 0, -1.92))
    floor = bpy.context.object
    floor.name = "Studio floor"
    floor.data.materials.append(BLACK_RUBBER)
    move(floor, c)
    for name, loc, energy, size, color in [
        ("Key", (-7, -9, 11), 1200, 5.0, (1.0, .85, .70)),
        ("Fill", (7, -5, 7), 850, 4.0, (.58, .72, 1.0)),
        ("Rim", (4, 5, 10), 1050, 3.0, (.70, .82, 1.0)),
    ]:
        data = bpy.data.lights.new(name, 'AREA')
        data.energy = energy
        data.shape = 'DISK'
        data.size = size
        data.color = color
        o = bpy.data.objects.new(name, data)
        c.objects.link(o)
        o.location = loc
        look_at(o, (0, 0, 2.1))
    cam_data = bpy.data.cameras.new("CAM_Hero")
    cam_data.lens = 58
    cam = bpy.data.objects.new("CAM_Hero", cam_data)
    c.objects.link(cam)
    cam.location = (9.8, -12.4, 8.0)
    look_at(cam, (0, 0, 2.6))
    bpy.context.scene.camera = cam

    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_EEVEE_NEXT'
    scene.render.resolution_x = 900
    scene.render.resolution_y = 1100
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.render.filepath = "//nxstage_system_one_preview.png"
    scene.world.color = (.008, .012, .016)
    scene.view_settings.look = 'AgX - Medium High Contrast'
    scene["preview_warning"] = "Preview is photo-grounded but not dimensionally validated."


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    build_device()
    build_presentation()
    bpy.ops.wm.save_as_mainfile(filepath="//nxstage_system_one.blend")
    bpy.ops.render.render(write_still=True)


if __name__ == '__main__':
    main()
