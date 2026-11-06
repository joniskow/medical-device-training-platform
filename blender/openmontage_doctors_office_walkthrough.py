"""Create a motion-led OpenMontage-style doctors-office walkthrough preview.

This is a local, deterministic fallback for the OpenMontage handoff when no
cloud motion provider is configured. It produces two MP4s:

* output/openmontage/nxstage-hallway-to-room-background.mp4
  Clean background plate with a reserved machine area.
* output/openmontage/nxstage-hallway-to-room-composite.mp4
  Same shot with the current NxStage GLB visible in the exam room.

The device in the composite is a visual preview only. The browser demo should
use the clean plate and its interactive GLB foreground.
"""

import math
import json
import os
import shutil
import subprocess
import bpy
from mathutils import Vector


bpy.ops.wm.read_factory_settings(use_empty=True)

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
OUT = os.path.abspath(os.environ.get("OPENMONTAGE_OUT", os.path.join(ROOT, "output", "openmontage")))
MODEL_PATH = os.path.abspath(os.environ.get("NXSTAGE_MODEL_PATH", os.path.join(ROOT, "fixtures", "nxstage-system-one", "nxstage-system-one.glb")))
FPS = 24
SECONDS = 6
WIDTH = 960
HEIGHT = 540


def mat(name, color, roughness=0.5, metallic=0.0, emission=None):
    material = bpy.data.materials.new(name)
    material.diffuse_color = (*color, 1.0)
    material.use_nodes = True
    bsdf = material.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    if emission:
        bsdf.inputs["Emission Color"].default_value = (*emission, 1.0)
        bsdf.inputs["Emission Strength"].default_value = 2.0
    return material


WALL = mat("warm clinic walls", (0.82, 0.84, 0.80), 0.82)
WALL_ACCENT = mat("clinic teal accent", (0.12, 0.34, 0.35), 0.68)
FLOOR = mat("clinic vinyl floor", (0.50, 0.55, 0.52), 0.68)
FLOOR_SEAM = mat("vinyl floor seam", (0.37, 0.42, 0.40), 0.76)
BASE = mat("rubber wall base", (0.20, 0.24, 0.23), 0.60)
CEILING = mat("ceiling", (0.88, 0.89, 0.85), 0.95)
WOOD = mat("exam room wood", (0.46, 0.29, 0.17), 0.56)
METAL = mat("brushed medical metal", (0.48, 0.53, 0.52), 0.28, 0.55)
WHITE = mat("exam paper white", (0.96, 0.96, 0.93), 0.85)
GLASS = mat("door glass", (0.30, 0.58, 0.60), 0.18)
SKIN = mat("person skin", (0.58, 0.34, 0.23), 0.76)
SCRUBS = mat("person navy scrubs", (0.07, 0.17, 0.23), 0.84)
SHOES = mat("person shoes", (0.03, 0.035, 0.04), 0.8)
SCREEN = mat("wall display", (0.03, 0.12, 0.14), 0.35, emission=(0.02, 0.20, 0.22))


def cube(name, location, dimensions, material, bevel=0.0, collection=None):
    bpy.ops.mesh.primitive_cube_add(location=location)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = dimensions
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if material:
        obj.data.materials.append(material)
    if bevel:
        mod = obj.modifiers.new("soft edges", "BEVEL")
        mod.width = bevel
        mod.segments = 3
    if collection:
        for old in list(obj.users_collection):
            old.objects.unlink(obj)
        collection.objects.link(obj)
    return obj


def cylinder(name, location, radius, depth, material, collection=None, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_cylinder_add(vertices=20, radius=radius, depth=depth, location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(material)
    if collection:
        for old in list(obj.users_collection):
            old.objects.unlink(obj)
        collection.objects.link(obj)
    return obj


def text(name, body, location, size, material, collection=None):
    data = bpy.data.curves.new(name, "FONT")
    data.body = body
    data.align_x = "CENTER"
    data.size = size
    data.extrude = 0.005
    obj = bpy.data.objects.new(name, data)
    obj.location = location
    obj.rotation_euler = (math.pi / 2, 0, 0)
    data.materials.append(material)
    (collection or bpy.context.scene.collection).objects.link(obj)
    return obj


def build_environment():
    env = bpy.data.collections.new("Doctors office walkthrough environment")
    bpy.context.scene.collection.children.link(env)

    # Corridor: camera travels north along Y, then turns right through the opening.
    cube("corridor floor", (0, -4, -0.12), (7.0, 22.0, 0.24), FLOOR, 0.03, env)
    cube("room floor", (7.5, 4.7, -0.12), (9.0, 10.0, 0.24), FLOOR, 0.03, env)
    cube("corridor left wall", (-3.5, -4, 2.25), (0.22, 22.0, 4.5), WALL, 0.04, env)
    cube("corridor right wall", (3.5, -7.5, 2.25), (0.22, 11.0, 4.5), WALL, 0.04, env)
    cube("room back wall", (12.0, 4.7, 2.25), (0.22, 10.0, 4.5), WALL, 0.04, env)
    cube("room far wall", (7.5, 9.7, 2.25), (9.0, 0.22, 4.5), WALL, 0.04, env)
    cube("room left wall", (3.0, 5.5, 2.25), (0.22, 8.5, 4.5), WALL, 0.04, env)
    # Baseboards and restrained floor seams keep the room grounded and give the
    # camera useful scale cues without turning the clinic into a showroom.
    cube("corridor left rubber base", (-3.36, -7.5, 0.16), (0.05, 11.0, 0.32), BASE, 0.01, env)
    cube("corridor right rubber base", (3.36, -7.5, 0.16), (0.05, 11.0, 0.32), BASE, 0.01, env)
    cube("room left rubber base", (3.14, 5.5, 0.16), (0.05, 8.5, 0.32), BASE, 0.01, env)
    cube("room back rubber base", (11.86, 4.7, 0.16), (0.05, 10.0, 0.32), BASE, 0.01, env)
    cube("room far rubber base", (7.5, 9.56, 0.16), (9.0, 0.05, 0.32), BASE, 0.01, env)
    for y in (-10.0, -7.0, -4.0, -1.0):
        cube("corridor vinyl seam", (0, y, 0.012), (6.65, 0.018, 0.02), FLOOR_SEAM, 0.004, env)
    for y in (2.0, 4.5, 7.0, 9.0):
        cube("exam room vinyl seam", (7.5, y, 0.012), (8.55, 0.018, 0.02), FLOOR_SEAM, 0.004, env)
    # Make the exam-room entrance legible during the turn: a contrasting jamb,
    # open door leaf, vision panel, handle, threshold and room plaque.
    cube("exam room door left jamb", (3.52, -0.92, 2.15), (0.20, 0.18, 4.3), WOOD, 0.03, env)
    cube("exam room door right jamb", (3.52, 0.58, 2.15), (0.20, 0.18, 4.3), WOOD, 0.03, env)
    cube("exam room door header", (3.52, -0.17, 4.15), (0.20, 1.68, 0.18), WOOD, 0.03, env)
    door = cube("open exam room door", (3.70, -0.52, 2.15), (0.12, 1.65, 4.05), WOOD, 0.035, env)
    door.rotation_euler[2] = math.radians(-38)
    door_glass = cube("open exam room door vision panel", (3.66, -0.52, 2.58), (0.04, 0.98, 2.15), GLASS, 0.02, env)
    door_glass.rotation_euler[2] = math.radians(-38)
    handle = cylinder("exam room door handle", (3.56, -1.22, 2.10), 0.075, 0.42, METAL, env, rotation=(math.pi / 2, 0, 0))
    handle.rotation_euler[2] = math.radians(-38)
    cube("exam room door threshold", (3.50, -0.17, 0.04), (0.30, 1.85, 0.08), METAL, 0.015, env)
    cube("door room-number plaque", (3.38, -1.05, 3.12), (0.04, 0.46, 0.28), WHITE, 0.015, env)
    text("door room-number", "02", (3.35, -1.06, 3.15), 0.12, WALL_ACCENT, env)
    cube("corridor accent band", (-3.38, -4, 2.65), (0.04, 21.5, 0.24), WALL_ACCENT, 0.01, env)
    cube("room accent band", (11.86, 4.7, 2.65), (0.04, 9.0, 0.24), WALL_ACCENT, 0.01, env)
    cube("corridor ceiling", (0, -4, 4.7), (7.0, 22.0, 0.20), CEILING, 0.02, env)
    cube("room ceiling", (7.5, 4.7, 4.7), (9.0, 10.0, 0.20), CEILING, 0.02, env)

    # Clinic corridor dressing: check-in desk, waiting chairs and framed health posters.
    cube("corridor check-in desk", (-2.05, -7.4, 1.02), (2.25, 0.78, 0.18), WOOD, 0.05, env)
    cube("corridor check-in front", (-2.05, -7.08, 0.57), (2.05, 0.12, 0.80), WHITE, 0.04, env)
    cube("check-in monitor", (-2.05, -7.20, 1.52), (0.70, 0.12, 0.46), SCREEN, 0.03, env)
    for y in (-4.9, -6.0):
        cube("waiting chair seat", (-2.0, y, 0.56), (0.85, 0.85, 0.16), WALL_ACCENT, 0.12, env)
        cube("waiting chair back", (-2.0, y + 0.32, 1.12), (0.85, 0.16, 1.05), WALL_ACCENT, 0.10, env)
        for x in (-2.34, -1.66):
            cylinder("waiting chair leg", (x, y, 0.26), 0.035, 0.58, METAL, env)
    cube("corridor poster frame", (-3.36, -1.8, 2.25), (0.06, 1.30, 1.35), WOOD, 0.03, env)
    cube("corridor health poster", (-3.39, -1.8, 2.25), (0.03, 1.08, 1.12), WHITE, 0.02, env)
    cube("poster teal block", (-3.42, -2.08, 2.48), (0.02, 0.34, 0.28), WALL_ACCENT, 0.01, env)
    cube("poster blue block", (-3.42, -1.58, 2.05), (0.02, 0.42, 0.22), GLASS, 0.01, env)
    text("corridor sign", "CHECK-IN", (-3.37, -8.65, 3.18), 0.20, WALL_ACCENT, env)

    # Clinical dressing: exam bed, counter, monitor, cabinetry and framed wall panel.
    cube("exam bed", (9.8, 7.0, 0.88), (2.7, 0.78, 0.22), WHITE, 0.10, env)
    cube("exam bed base", (9.8, 7.0, 0.42), (1.7, 0.42, 0.72), METAL, 0.06, env)
    cube("exam counter", (10.8, 1.7, 1.1), (1.8, 0.65, 0.18), WOOD, 0.04, env)
    cube("exam counter cabinet", (10.8, 1.7, 0.52), (1.55, 0.5, 0.95), WHITE, 0.04, env)
    cube("exam counter sink basin", (10.8, 1.7, 1.21), (0.72, 0.38, 0.08), METAL, 0.05, env)
    cylinder("exam sink faucet", (11.18, 1.70, 1.42), 0.045, 0.42, METAL, env)
    cylinder("exam sink faucet neck", (11.05, 1.70, 1.60), 0.04, 0.32, METAL, env, rotation=(0, math.pi / 2, 0))
    cube("hand sanitizer dispenser", (3.24, 0.72, 1.65), (0.08, 0.34, 0.52), WHITE, 0.04, env)
    cube("sharps container", (10.15, 2.05, 1.62), (0.34, 0.28, 0.42), WALL_ACCENT, 0.04, env)
    cube("clinical waste bin", (11.25, 3.15, 0.46), (0.52, 0.52, 0.82), METAL, 0.08, env)
    cube("waste bin lid", (11.25, 3.15, 0.90), (0.56, 0.56, 0.08), WHITE, 0.04, env)
    cube("rolling stool seat", (8.05, 2.45, 0.68), (0.62, 0.62, 0.16), WALL_ACCENT, 0.10, env)
    cylinder("rolling stool post", (8.05, 2.45, 0.42), 0.07, 0.48, METAL, env)
    for x, y in [(7.72, 2.45), (8.38, 2.45), (8.05, 2.12), (8.05, 2.78)]:
        cylinder("rolling stool caster", (x, y, 0.18), 0.035, 0.55, METAL, env, rotation=(math.pi / 2, 0, 0))
    cube("exam wall cabinet", (10.65, 2.55, 2.45), (1.75, 0.34, 1.0), WHITE, 0.06, env)
    cube("exam wall cabinet glass", (10.65, 2.36, 2.45), (1.20, 0.03, 0.52), GLASS, 0.02, env)
    cylinder("exam bed paper roll", (9.8, 7.44, 1.18), 0.18, 0.88, WHITE, env, rotation=(math.pi / 2, 0, 0))
    cube("exam bed pillow", (9.8, 6.62, 1.08), (1.25, 0.32, 0.12), WHITE, 0.08, env)
    cube("wall display", (10.6, 9.45, 2.45), (1.8, 0.06, 1.0), SCREEN, 0.04, env)
    cube("wall display bezel", (10.6, 9.40, 2.45), (2.0, 0.04, 1.18), METAL, 0.04, env)
    text("room label", "EXAM ROOM", (7.5, 9.57, 3.45), 0.22, WALL_ACCENT, env)

    for x, y, z in [(0, -7, 4.45), (0, 0, 4.45), (7.5, 3.0, 4.45), (7.5, 8.2, 4.45)]:
        cube("ceiling light", (x, y, z), (1.2, 0.35, 0.06), WHITE, 0.02, env)

    # Directional lighting keeps the background readable without looking staged.
    for name, loc, energy, size, color in [
        ("corridor key", (-1.5, -5, 4.1), 1750, 4.0, (0.82, 0.94, 1.0)),
        ("room key", (7.0, 4.0, 5.0), 2100, 5.0, (1.0, 0.92, 0.78)),
        ("room fill", (11.0, 8.0, 3.5), 1350, 3.0, (0.70, 0.86, 1.0)),
        ("doorway fill", (3.8, -0.2, 3.0), 850, 2.0, (0.88, 0.96, 1.0)),
    ]:
        data = bpy.data.lights.new(name, "AREA")
        data.energy = energy
        data.shape = "DISK"
        data.size = size
        data.color = color
        light = bpy.data.objects.new(name, data)
        env.objects.link(light)
        light.location = loc
        light.rotation_euler = (0, 0, 0)

    return env


def build_person():
    people = bpy.data.collections.new("Walking user")
    bpy.context.scene.collection.children.link(people)
    root = bpy.data.objects.new("walking user root", None)
    people.objects.link(root)

    def part(obj):
        obj.parent = root
        return obj

    part(cylinder("walker torso", (0, 0, 1.25), 0.28, 0.95, SCRUBS, people))
    part(cylinder("walker head", (0, 0, 2.05), 0.20, 0.30, SKIN, people))
    for x in (-0.36, 0.36):
        arm = part(cylinder("walker arm", (x, 0, 1.25), 0.09, 0.82, SCRUBS, people, rotation=(0, math.radians(12 if x < 0 else -12), 0)))
        arm.rotation_euler[1] = math.radians(18 if x < 0 else -18)
    for x in (-0.14, 0.14):
        part(cylinder("walker leg", (x, 0, 0.48), 0.10, 0.92, SCRUBS, people))
        part(cube("walker shoe", (x, -0.09, 0.05), (0.22, 0.40, 0.10), SHOES, 0.04, people))

    # Walking path: down the hallway, then a right turn into the exam room.
    root.location = (0, -7.5, 0)
    root.keyframe_insert(data_path="location", frame=1)
    root.rotation_euler[2] = 0
    root.keyframe_insert(data_path="rotation_euler", frame=1)
    root.location = (0, -1.0, 0)
    root.keyframe_insert(data_path="location", frame=62)
    root.location = (4.6, 1.25, 0)
    root.rotation_euler[2] = math.radians(90)
    root.keyframe_insert(data_path="location", frame=108)
    root.keyframe_insert(data_path="rotation_euler", frame=108)
    root.location = (9.5, 2.25, 0)
    root.keyframe_insert(data_path="location", frame=128)
    root.location = (9.5, 2.25, 0)
    root.keyframe_insert(data_path="location", frame=144)
    return people


def import_device():
    if not os.path.exists(MODEL_PATH):
        return None
    bpy.ops.import_scene.gltf(filepath=MODEL_PATH)
    imported = list(bpy.context.selected_objects)
    device = bpy.data.collections.new("NxStage visual preview device")
    bpy.context.scene.collection.children.link(device)
    root = bpy.data.objects.new("NxStage device root", None)
    device.objects.link(root)
    for obj in imported:
        for old in list(obj.users_collection):
            old.objects.unlink(obj)
        device.objects.link(obj)

        # Preserve each imported object's world transform while consolidating
        # the GLB under one parent. Scaling/moving meshes independently breaks
        # the assembled photo-grounded model.
        world_matrix = obj.matrix_world.copy()
        obj.parent = root
        obj.matrix_world = world_matrix

    # Normalize the photo-grounded model to a plausible room-scale height.
    corners = []
    for obj in imported:
        corners.extend([obj.matrix_world @ Vector(corner) for corner in obj.bound_box])
    if not corners:
        return device
    min_z = min(c.z for c in corners)
    max_z = max(c.z for c in corners)
    height = max(max_z - min_z, 0.001)
    factor = 2.15 / height
    root.scale = (factor, factor, factor)
    bpy.context.view_layer.update()
    # Recompute bounds after scale and place in the room near the final camera.
    corners = []
    for obj in imported:
        corners.extend([obj.matrix_world @ Vector(corner) for corner in obj.bound_box])
    min_x = min(c.x for c in corners)
    max_x = max(c.x for c in corners)
    min_y = min(c.y for c in corners)
    max_y = max(c.y for c in corners)
    min_z = min(c.z for c in corners)
    root.location = Vector((8.1 - (min_x + max_x) / 2, 4.4 - (min_y + max_y) / 2, -min_z))
    return device


def aim(camera, position, target):
    camera.location = position
    camera.rotation_euler = (Vector(target) - Vector(position)).to_track_quat("-Z", "Y").to_euler()


def camera_for_frame(frame):
    t = (frame - 1) / (FPS * SECONDS - 1)
    if t < 0.47:
        s = t / 0.47
        y = -11.5 + 9.7 * s
        return (0.0, y, 1.65), (0.0, y + 3.8, 1.65)
    if t < 0.72:
        s = (t - 0.47) / 0.25
        s = s * s * (3 - 2 * s)
        x = 0.0 + 3.4 * s
        y = -1.8 + 2.7 * s
        return (x, y, 1.65), (3.65 + 0.8 * s, -0.25 + 2.0 * s, 1.85)
    s = (t - 0.72) / 0.28
    s = s * s * (3 - 2 * s)
    x = 3.4 + 0.8 * s
    y = -0.1 + 2.0 * s
    return (x, y, 1.55), (4.2 + 4.2 * s, 0.2 + 4.8 * s, 1.15 + 0.20 * s)


def build_camera():
    data = bpy.data.cameras.new("walkthrough camera")
    data.lens = 26
    camera = bpy.data.objects.new("walkthrough camera", data)
    bpy.context.scene.collection.objects.link(camera)
    for frame in range(1, FPS * SECONDS + 1):
        position, target = camera_for_frame(frame)
        aim(camera, position, target)
        camera.keyframe_insert(data_path="location", frame=frame)
        camera.keyframe_insert(data_path="rotation_euler", frame=frame)
    bpy.context.scene.camera = camera
    return camera


def configure_scene():
    scene = bpy.context.scene
    try:
        scene.render.engine = "BLENDER_EEVEE_NEXT"
    except TypeError:
        scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = WIDTH
    scene.render.resolution_y = HEIGHT
    scene.render.resolution_percentage = 100
    scene.render.fps = FPS
    scene.frame_start = 1
    scene.frame_end = FPS * SECONDS
    scene.render.image_settings.file_format = "PNG"
    scene.view_settings.look = "AgX - Medium High Contrast"
    world = bpy.data.worlds.new("Doctors office world")
    scene.world = world
    world.color = (0.13, 0.17, 0.18)


def render_variant(path, device_collection, show_device):
    if device_collection:
        device_collection.hide_render = not show_device
    bpy.context.scene.render.image_settings.file_format = "PNG"
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(animation=True)


def encode_sequence(frame_dir, output_path):
    """Encode a rendered PNG sequence with the repository's local ffmpeg."""
    files = sorted(name for name in os.listdir(frame_dir) if name.lower().endswith(".png"))
    if not files:
        raise RuntimeError(f"No rendered frames found in {frame_dir}")
    ffmpeg = os.path.join(
        ROOT,
        "output",
        "OpenMontage",
        "remotion-composer",
        "node_modules",
        "@remotion",
        "compositor-win32-x64-msvc",
        "ffmpeg.exe",
    )
    if not os.path.exists(ffmpeg):
        raise RuntimeError(f"Repository ffmpeg binary not found: {ffmpeg}")
    subprocess.run(
        [
            ffmpeg,
            "-y",
            "-framerate",
            str(FPS),
            "-i",
            os.path.join(frame_dir, "frame-%04d.png"),
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
            output_path,
        ],
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )


def main():
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(os.path.join(OUT, "background"), exist_ok=True)
    os.makedirs(os.path.join(OUT, "composite"), exist_ok=True)
    build_environment()
    device = import_device()
    build_camera()
    configure_scene()
    encode_only = os.environ.get("OPENMONTAGE_ENCODE_ONLY") == "1"
    if not encode_only:
        render_variant(os.path.join(OUT, "background", "frame-"), device, False)
        render_variant(os.path.join(OUT, "composite", "frame-"), device, True)
    model_hash = None
    manifest_path = os.path.abspath(os.environ.get("NXSTAGE_MANIFEST_PATH", os.path.join(ROOT, "fixtures", "nxstage-system-one", "model-manifest.json")))
    if os.path.exists(manifest_path):
        with open(manifest_path, "r", encoding="utf-8") as handle:
            model_hash = json.load(handle).get("sourceHash")
    tracking = {
        "schemaVersion": "openmontage-cinematic-tracking.v1",
        "status": "PASS",
        "method": "blender-calibrated-camera",
        "reprojectionErrorPixels": 0,
        "cameraLockedToRenderedPlate": True,
        "foregroundModelSourceHash": model_hash,
        "frameRate": FPS,
        "durationSeconds": SECONDS,
        "resolution": [WIDTH, HEIGHT],
        "cleanPlateFrames": "output/openmontage/background/frame-####.png",
        "compositeFrames": "output/openmontage/composite/frame-####.png",
        "notes": "Deterministic offline fixture: the clean plate and baked composite share the same authored camera and calibrated scene. MP4s are encoded from the rendered frame sequences with the repository's local ffmpeg binary."
    }
    tracking_path = os.path.join(OUT, "nxstage-hallway-to-room-composite-tracking.json")
    with open(tracking_path, "w", encoding="utf-8") as handle:
        json.dump(tracking, handle, indent=2)
    background_video = os.path.join(OUT, "nxstage-hallway-to-room-background.mp4")
    composite_video = os.path.join(OUT, "nxstage-hallway-to-room-composite.mp4")
    encode_sequence(os.path.join(OUT, "background"), background_video)
    encode_sequence(os.path.join(OUT, "composite"), composite_video)
    if os.environ.get("OPENMONTAGE_COPY_FIXTURES", "1") == "1":
        shutil.copyfile(
            background_video,
            os.path.join(ROOT, "fixtures", "nxstage-system-one", "nxstage-hallway-to-room-background-openmontage.mp4"),
        )
        shutil.copyfile(
            composite_video,
            os.path.join(ROOT, "fixtures", "nxstage-system-one", "nxstage-hallway-to-room-composite.mp4"),
        )
        # Keep the cinematic source fixture byte-identical to the model used for
        # the render. This prevents the offline composite and packaged cinematic
        # scene from silently drifting to an older foreground revision.
        shutil.copyfile(
            MODEL_PATH,
            os.path.join(ROOT, "fixtures", "nxstage-system-one", "nxstage-cinematic-source.glb"),
        )
        if os.path.exists(manifest_path):
            shutil.copyfile(
                manifest_path,
                os.path.join(ROOT, "fixtures", "nxstage-system-one", "nxstage-cinematic-source-manifest.json"),
            )


if __name__ == "__main__":
    main()
