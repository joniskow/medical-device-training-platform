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
from array import array
import bpy
from mathutils import Matrix, Vector


# Reset before module-level materials are created; resetting later would delete
# the material datablocks that the generated geometry references.
bpy.ops.wm.read_factory_settings(use_empty=True)
REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
OUTPUT_ROOT = os.path.abspath(os.environ.get("NXSTAGE_OUTPUT_ROOT", REPO_ROOT))
ASSET_FOLDER = os.environ.get("NXSTAGE_ASSET_FOLDER", "nxstage-system-one-interactive")
SOURCE_PHOTO = os.path.join(REPO_ROOT, "output", "nxstage-system-one-photos", "20261020_130814.jpg")
SOURCE_PHOTO_SET_DIR = os.path.join(REPO_ROOT, "output", "nxstage-system-one-photos")
SOURCE_PHOTO_SET = [
    os.path.join(SOURCE_PHOTO_SET_DIR, name)
    for name in sorted(os.listdir(SOURCE_PHOTO_SET_DIR))
    if name.lower().endswith((".jpg", ".jpeg", ".png"))
]
if len(SOURCE_PHOTO_SET) != 20:
    raise RuntimeError(f"Expected the complete 20-photo source set, found {len(SOURCE_PHOTO_SET)}")

# Approximate normalized dimensions, derived from the 20-photo set.
HEAD_W, HEAD_D, HEAD_H = 4.45, 2.55, 4.75
TRAY_W, TRAY_D = 5.55, 3.95
BASE_W, BASE_D, BASE_H = 4.90, 3.50, 2.35


def texture_seed(name):
    return sum((index + 1) * ord(char) for index, char in enumerate(name)) % 997


PHOTO_ENSEMBLE_CACHE = None


def photo_ensemble_samples():
    """Read a small, memory-bounded sample from every supplied source photo."""
    global PHOTO_ENSEMBLE_CACHE
    if PHOTO_ENSEMBLE_CACHE is not None:
        return PHOTO_ENSEMBLE_CACHE
    samples = []
    for source_path in SOURCE_PHOTO_SET:
        image = bpy.data.images.load(source_path, check_existing=False)
        image.scale(160, 120)
        pixels = array('f', [0.0]) * (160 * 120 * 4)
        image.pixels.foreach_get(pixels)
        samples.append((160, 120, pixels))
        bpy.data.images.remove(image)
    PHOTO_ENSEMBLE_CACHE = samples
    return samples


def photo_ensemble_texture(name, color, roughness, kind):
    """Derive restrained PBR microvariation from all 20 source views.

    The views are not treated as a calibrated texture projection. Their
    low-frequency color and edge statistics are averaged into a neutral,
    source-bound surface variation map so the exported asset carries real
    photo-set evidence without inventing a false CAD texture alignment.
    """
    size = 64
    image = bpy.data.images.new(name, width=size, height=size, alpha=False, float_buffer=False)
    samples = photo_ensemble_samples()
    pixels = []

    def luminance(sample, width, height, u, v):
        x = max(0, min(width - 1, int(round(u * (width - 1)))))
        y = max(0, min(height - 1, int(round(v * (height - 1)))))
        offset = (y * width + x) * 4
        return sample[offset] * 0.2126 + sample[offset + 1] * 0.7152 + sample[offset + 2] * 0.0722

    for y in range(size):
        for x in range(size):
            u = (x + 0.5) / size
            v = (y + 0.5) / size
            center = left = right = down = up = 0.0
            for width, height, sample in samples:
                center += luminance(sample, width, height, u, v)
                left += luminance(sample, width, height, u - 1 / size, v)
                right += luminance(sample, width, height, u + 1 / size, v)
                down += luminance(sample, width, height, u, v - 1 / size)
                up += luminance(sample, width, height, u, v + 1 / size)
            count = max(1, len(samples))
            center /= count
            left /= count
            right /= count
            down /= count
            up /= count
            if kind == "albedo":
                variation = 1.0 + max(-0.025, min(0.025, (center - 0.5) * 0.045))
                pixels.extend([max(0.0, min(1.0, channel * variation)) for channel in color] + [1.0])
            elif kind == "roughness":
                edge = abs(right - left) + abs(up - down)
                value = max(0.06, min(0.98, roughness + max(-0.035, min(0.035, (edge - 0.14) * 0.16))))
                pixels.extend([value, value, value, 1.0])
            else:
                dx = max(-0.035, min(0.035, (right - left) * 0.08))
                dy = max(-0.035, min(0.035, (up - down) * 0.08))
                pixels.extend([0.5 + dx, 0.5 + dy, 1.0, 1.0])
    if kind != "albedo":
        image.colorspace_settings.name = "Non-Color"
    image.pixels = pixels
    image.update()
    image.pack()
    return image


def baked_texture(name, color, roughness, kind):
    """Create a tiny deterministic, embedded PBR map for browser-safe GLB export.

    These are deliberately restrained material micro-variation maps, not claims
    of measured device surface appearance. They keep the reconstruction
    self-contained while preventing the browser asset from reading as flat
    untextured CGI.
    """
    size = 64
    image = bpy.data.images.new(name, width=size, height=size, alpha=False, float_buffer=False)
    seed = texture_seed(name)
    pixels = []
    for y in range(size):
        for x in range(size):
            wave = math.sin((x + seed) * 0.31) * math.cos((y + seed) * 0.23)
            fine = math.sin((x * 7 + y * 11 + seed) * 0.17)
            if kind == "albedo":
                variation = 1.0 + wave * 0.018 + fine * 0.006
                pixels.extend([max(0.0, min(1.0, channel * variation)) for channel in color] + [1.0])
            elif kind == "roughness":
                value = max(0.04, min(0.98, roughness + wave * 0.035 + fine * 0.012))
                pixels.extend([value, value, value, 1.0])
            else:  # Tangent-space normal: mostly flat with subtle molded micrograin.
                pixels.extend([0.5 + wave * 0.018, 0.5 + fine * 0.012, 1.0, 1.0])
    image.pixels = pixels
    image.pack()
    return image


def photo_derived_map(name, source_image, crop, roughness, kind):
    """Build a restrained embedded map from the photographed fascia crop."""
    size = 64
    image = bpy.data.images.new(name, width=size, height=size, alpha=False, float_buffer=False)
    width, height = source_image.size
    u0, u1, v0, v1 = crop
    # Blender's pixel property is costly to access repeatedly. Copy it once
    # before sampling the many neighboring pixels needed for each output texel.
    source_pixels = array('f', [0.0]) * (width * height * 4)
    source_image.pixels.foreach_get(source_pixels)

    def sample(u, v):
        u = max(0.0, min(1.0, u))
        v = max(0.0, min(1.0, v))
        x = int(round(u * (width - 1)))
        y = int(round(v * (height - 1)))
        offset = (y * width + x) * 4
        return tuple(source_pixels[offset + channel] for channel in range(3))

    def luminance(rgb):
        return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722

    pixels = []
    for y in range(size):
        for x in range(size):
            u = u0 + (u1 - u0) * (x + 0.5) / size
            v = v0 + (v1 - v0) * (y + 0.5) / size
            center = luminance(sample(u, v))
            left = luminance(sample(u - (u1 - u0) / size, v))
            right = luminance(sample(u + (u1 - u0) / size, v))
            down = luminance(sample(u, v - (v1 - v0) / size))
            up = luminance(sample(u, v + (v1 - v0) / size))
            if kind == "roughness":
                value = max(0.08, min(0.92, roughness + (0.5 - center) * 0.035))
                pixels.extend([value, value, value, 1.0])
            else:
                # Low-strength photographed edges add micro relief without
                # embossing the printed control artwork.
                dx = max(-0.045, min(0.045, (right - left) * 0.10))
                dy = max(-0.045, min(0.045, (up - down) * 0.10))
                pixels.extend([0.5 + dx, 0.5 + dy, 1.0, 1.0])
    image.pixels = pixels
    image.colorspace_settings.name = "Non-Color"
    image.pack()
    return image


def panel_decal_image(source_path):
    """Create an embedded, EXIF-normalized control-panel crop.

    Blender reads the supplied phone JPEG pixels without applying the camera's
    orientation tag.  The source therefore arrives rotated relative to the
    frontal model.  This deterministic crop/rotation keeps the real printed
    fascia visible beneath the authored interactive meshes without treating
    the photo as calibrated CAD or replacing the interaction geometry.
    """
    source = bpy.data.images.load(source_path, check_existing=True)
    width, height = source.size
    source_pixels = array('f', [0.0]) * (width * height * 4)
    source.pixels.foreach_get(source_pixels)

    crop_x, crop_y = 1050, 700
    crop_width, crop_height = 2400, 1600
    output_width, output_height = 1600, 640
    trim_top = 60
    output = bpy.data.images.new(
        "Photo-derived control fascia · normalized decal",
        width=output_width,
        height=output_height,
        alpha=False,
    )
    pixels = [0.0] * (output_width * output_height * 4)

    def source_pixel(file_x, file_y):
        # Blender stores image pixels bottom-up; the crop coordinates above are
        # expressed in the JPEG's conventional top-left origin.
        blender_y = height - 1 - file_y
        offset = (blender_y * width + file_x) * 4
        return source_pixels[offset:offset + 4]

    for file_y in range(output_height):
        rotated_y = trim_top + file_y
        for file_x in range(output_width):
            # 90° clockwise rotation of the cropped raw JPEG.
            raw_x = crop_x + rotated_y
            raw_y = crop_y + (crop_height - 1 - file_x)
            pixel = source_pixel(raw_x, raw_y)
            output_y = output_height - 1 - file_y
            offset = (output_y * output_width + file_x) * 4
            pixels[offset:offset + 4] = pixel

    output.pixels = pixels
    output.update()
    output.pack()
    output["source_photo"] = os.path.relpath(source_path, REPO_ROOT).replace("\\", "/")
    output["orientation_note"] = "Deterministic 90-degree clockwise EXIF normalization for Blender texture projection."
    output["crop_note"] = "Frontal control-panel crop from the supplied source set; not a calibrated CAD texture."
    return output


def material(name, color, roughness=0.42, metallic=0.0):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*color, 1.0)
    m.use_nodes = True
    nodes = m.node_tree.nodes
    links = m.node_tree.links
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    bsdf = nodes.new("ShaderNodeBsdfPrincipled")
    albedo = nodes.new("ShaderNodeTexImage")
    albedo.name = f"{name} · embedded albedo"
    albedo.label = "Embedded albedo"
    photo_derived = name in {
        "Molded cream ABS", "Cream edge highlight", "Gloss black rails and trim",
        "Black rubber", "Rear service gray", "Brushed stainless steel", "Control fascia light gray"
    }
    albedo.image = photo_ensemble_texture(f"{name} · 20-photo albedo", color, roughness, "albedo") if photo_derived else baked_texture(f"{name} · albedo", color, roughness, "albedo")
    rough = nodes.new("ShaderNodeTexImage")
    rough.name = f"{name} · embedded roughness"
    rough.label = "Embedded roughness"
    rough.image = photo_ensemble_texture(f"{name} · 20-photo roughness-wear", color, roughness, "roughness") if photo_derived else baked_texture(f"{name} · roughness", color, roughness, "roughness")
    normal = nodes.new("ShaderNodeTexImage")
    normal.name = f"{name} · embedded normal"
    normal.label = "Embedded normal"
    normal.image = photo_ensemble_texture(f"{name} · 20-photo normal", color, roughness, "normal") if photo_derived else baked_texture(f"{name} · normal", color, roughness, "normal")
    normal_map = nodes.new("ShaderNodeNormalMap")
    links.new(albedo.outputs["Color"], bsdf.inputs["Base Color"])
    links.new(rough.outputs["Color"], bsdf.inputs["Roughness"])
    links.new(normal.outputs["Color"], normal_map.inputs["Color"])
    links.new(normal_map.outputs["Normal"], bsdf.inputs["Normal"])
    bsdf.inputs["Metallic"].default_value = metallic
    if "Specular IOR Level" in bsdf.inputs:
        bsdf.inputs["Specular IOR Level"].default_value = 0.34 if metallic < 0.1 else 0.52
    if "Coat Weight" in bsdf.inputs:
        bsdf.inputs["Coat Weight"].default_value = 0.14 if roughness < 0.58 else 0.02
        bsdf.inputs["Coat Roughness"].default_value = 0.18 if roughness < 0.58 else 0.45
    links.new(bsdf.outputs["BSDF"], output.inputs["Surface"])
    m["pbr_texture_roles"] = "photo_ensemble_albedo,photo_ensemble_roughness_wear,photo_ensemble_normal" if photo_derived else "embedded_albedo,embedded_roughness,embedded_normal"
    if photo_derived:
        m["source_photo_set"] = ";".join(os.path.relpath(path, REPO_ROOT).replace("\\", "/") for path in SOURCE_PHOTO_SET)
        m["source_photo_set_count"] = len(SOURCE_PHOTO_SET)
        m["texture_calibration_note"] = "Ensemble-derived microvariation from all supplied views; not a calibrated projection or manufacturing texture."
    if name in {"Control fascia dark maroon", "Control green", "Control yellow", "Control coral"}:
        m["visual_tuning_source_photo"] = os.path.relpath(SOURCE_PHOTO, REPO_ROOT).replace("\\", "/")
        m["visual_tuning_note"] = "Printed control ink hue and matte laminate roughness tuned against the supplied frontal source view; not a calibrated color target."
    return m


def photo_material(name, source_path, roughness=0.46, source_reference=None):
    """Embed a real source-set view for the large front fascia.

    The image is used only as a photo-derived surface reference under the
    authored controls. It is not a claim of calibrated texture projection or
    manufacturing/CAD accuracy.
    """
    image = source_path if hasattr(source_path, "pixels") else bpy.data.images.load(source_path, check_existing=True)
    image.pack()
    m = bpy.data.materials.new(name)
    m.diffuse_color = (0.76, 0.75, 0.70, 1.0)
    m.use_nodes = True
    nodes = m.node_tree.nodes
    links = m.node_tree.links
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    bsdf = nodes.new("ShaderNodeBsdfPrincipled")
    tex = nodes.new("ShaderNodeTexImage")
    tex.name = f"{name} · source photo albedo"
    tex.label = "Source photo derived albedo"
    tex.image = image
    tex.interpolation = "Linear"
    # The source image has already been normalized and cropped to the panel's
    # frontal aspect, so the full embedded decal is used here.
    crop = (0.0, 1.0, 0.0, 1.0)
    rough = nodes.new("ShaderNodeTexImage")
    rough.name = f"{name} · photo-derived roughness"
    rough.label = "Photo-derived roughness"
    rough.image = photo_derived_map(f"{name} · photo-derived roughness", image, crop, roughness, "roughness")
    normal = nodes.new("ShaderNodeTexImage")
    normal.name = f"{name} · photo-derived normal"
    normal.label = "Photo-derived normal micrograin"
    normal.image = photo_derived_map(f"{name} · photo-derived normal", image, crop, roughness, "normal")
    normal_map = nodes.new("ShaderNodeNormalMap")
    emission = nodes.new("ShaderNodeEmission")
    emission.name = f"{name} · photographed print emission"
    emission.label = "Photographed print readability"
    emission.inputs["Strength"].default_value = 0.85
    mix = nodes.new("ShaderNodeMixShader")
    mix.name = f"{name} · matte print integration"
    mix.label = "Matte photographed print integration"
    mix.inputs[0].default_value = 0.72
    links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    links.new(rough.outputs["Color"], bsdf.inputs["Roughness"])
    links.new(normal.outputs["Color"], normal_map.inputs["Color"])
    links.new(normal_map.outputs["Normal"], bsdf.inputs["Normal"])
    links.new(tex.outputs["Color"], emission.inputs["Color"])
    if "Specular IOR Level" in bsdf.inputs:
        bsdf.inputs["Specular IOR Level"].default_value = 0.32
    if "Coat Weight" in bsdf.inputs:
        bsdf.inputs["Coat Weight"].default_value = 0.08
        bsdf.inputs["Coat Roughness"].default_value = 0.24
    links.new(bsdf.outputs["BSDF"], mix.inputs[1])
    links.new(emission.outputs["Emission"], mix.inputs[2])
    links.new(mix.outputs["Shader"], output.inputs["Surface"])
    m["pbr_texture_roles"] = "photo_derived_albedo;photo_derived_roughness;photo_derived_normal"
    m["source_photo"] = os.path.relpath(source_reference or SOURCE_PHOTO, REPO_ROOT).replace("\\", "/")
    m["processed_source_photo"] = "embedded normalized control-panel decal"
    m["source_photo_set"] = ";".join(os.path.relpath(path, REPO_ROOT).replace("\\", "/") for path in SOURCE_PHOTO_SET)
    m["source_photo_set_count"] = len(SOURCE_PHOTO_SET)
    return m


CREAM = material("Molded cream ABS", (0.84, 0.81, 0.73), 0.34)
CREAM_HI = material("Cream edge highlight", (0.94, 0.91, 0.83), 0.31)
# The source photos show charcoal-black plastics with readable reflected edge
# detail, not clipped RGB-black. Lift the base slightly so the lower chassis
# retains its molded form against the warm clinical floor.
# The reference set shows charcoal ABS with readable reflected planes rather
# than clipped RGB-black. Keep the rails dark, but preserve lower-chassis form
# at the calibrated 960×540 composite distance.
BLACK = material("Gloss black rails and trim", (0.085, 0.088, 0.092), 0.30)
BLACK_RUBBER = material("Black rubber", (0.052, 0.054, 0.058), 0.72)
GRAY = material("Rear service gray", (0.43, 0.45, 0.45), 0.52)
METAL = material("Brushed stainless steel", (0.55, 0.58, 0.57), 0.22, 0.72)
# The frontal source shows a lighter, cooler inset fascia than the surrounding
# warm molded shell. Keeping this separation visible is important at the
# calibrated browser distance: it restores the real white bezel around the
# printed controls without changing any target mesh or node identity.
PANEL = material("Control fascia light gray", (0.90, 0.88, 0.82), 0.38)
# The supplied frontal photo shows printed, slightly worn controls rather than
# saturated emissive UI colors. Keep the targets visually legible, but match
# the photographed mint/yellow/coral/maroon inks and their matte laminate.
MAROON = material("Control fascia dark maroon", (0.13, 0.045, 0.065), 0.48)
GREEN = material("Control green", (0.18, 0.56, 0.37), 0.46)
YELLOW = material("Control yellow", (0.84, 0.68, 0.09), 0.44)
CORAL = material("Control coral", (0.84, 0.34, 0.23), 0.45)
LCD = material("LCD green-black", (0.20, 0.30, 0.10), 0.28)
# The source set shows a deep cobalt medical tube with a glossy wall—not an
# emissive electric-blue cable. Lowering saturation and value keeps the tubing
# readable without making it the visual focal point.
BLUE = material("Tubing blue", (0.012, 0.065, 0.28), 0.26)
WHITE = material("Tubing white", (0.86, 0.86, 0.82), 0.38)
TEXT = material("Printed markings", (0.03, 0.035, 0.035), 0.55)
PANEL_DECAL_IMAGE = panel_decal_image(SOURCE_PHOTO)
PHOTO_FASCIA = photo_material("Photo-derived control fascia", PANEL_DECAL_IMAGE, source_reference=SOURCE_PHOTO)


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
        # Four segments preserve the molded highlight while keeping the
        # browser interaction budget responsive at the calibrated profile.
        b.segments = 4
        b.limit_method = 'ANGLE'
        # Preserve broad planar faces while keeping the molded/beveled edge
        # highlight continuous in Blender and in the exported GLB.
        weighted = o.modifiers.new("Weighted molded normals", "WEIGHTED_NORMAL")
        weighted.keep_sharp = True
        weighted.weight = 50
    return move(o, c)


def cylinder(name, loc, radius, depth, mat, c, rotation=(0, 0, 0), vertices=32, bevel=0.0):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=loc, rotation=rotation)
    o = bpy.context.object
    o.name = name
    if mat:
        o.data.materials.append(mat)
    # Round hardware, casters, poles, and tubing collars should catch light as
    # continuous surfaces. Keep the deliberately octagonal stop control flat.
    if vertices >= 16:
        for polygon in o.data.polygons:
            polygon.use_smooth = True
    if bevel:
        b = o.modifiers.new("Edge radius", "BEVEL")
        b.width = bevel
        b.segments = 3
        weighted = o.modifiers.new("Weighted edge normals", "WEIGHTED_NORMAL")
        weighted.keep_sharp = True
        weighted.weight = 50
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


def add_press_action(o, depth=0.004, axis=(0.0, 1.0, 0.0)):
    """Author a short tactile press/release clip for Blender review/export."""
    origin = o.location.copy()
    action = bpy.data.actions.new(f"{o.name} | press-release")
    o.animation_data_create()
    o.animation_data.action = action
    for frame, offset in ((1, 0.0), (3, depth), (7, 0.0)):
        o.location = origin + Vector(axis) * offset
        o.keyframe_insert(data_path="location", frame=frame, group="Tactile press")
    o.location = origin
    o["interaction_animation_action"] = action.name
    return action


def mark_interaction(o, target_id, component_id, action, display_name,
                     press_depth_meters=0.004, press_axis=(0.0, 1.0, 0.0)):
    """Keep Blender-authored interaction intent attached to the exact mesh.

    These properties are deliberately simple and export-friendly: the browser
    importer can map them to a manifest later without guessing from names.
    """
    o["component_id"] = component_id
    o["interactionTargetOwner"] = component_id
    o["interaction_target_id"] = target_id
    o["interactionTargetId"] = target_id
    o["interaction_action"] = action
    o["interaction"] = action
    o["interaction_display_name"] = display_name
    o["interactionTargetDisplayName"] = display_name
    if action == "press":
        o["press_depth_meters"] = press_depth_meters
        o["pressDepthMeters"] = press_depth_meters
        o["press_axis"] = press_axis
        # glTF exports Blender (x, y, z) as (x, z, -y); extras are not converted.
        o["pressAxis"] = (press_axis[0], press_axis[2], -press_axis[1])
        add_press_action(o, press_depth_meters, press_axis)
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


def photo_fascia(parent):
    """Place the normalized source photo beneath the authored controls."""
    width, height = 1.78, 0.70
    # Put the photographic print just in front of the authored control meshes.
    # The browser's multi-pick path still resolves the tagged targets beneath
    # this decorative layer, while the visible face retains the source-set
    # print texture and photographed surface wear.
    local_y = -0.23
    verts = [(-width, local_y, -height), (width, local_y, -height),
             (width, local_y, height), (-width, local_y, height)]
    mesh = bpy.data.meshes.new("Photo-derived control fascia mesh")
    mesh.from_pydata(verts, [], [(0, 1, 2, 3)])
    mesh.materials.append(PHOTO_FASCIA)
    uv = mesh.uv_layers.new(name="UVMap")
    for loop, coord in zip(uv.data, [(0, 0), (1, 0), (1, 1), (0, 1)]):
        loop.uv = coord
    photo = bpy.data.objects.new("Photo-derived control fascia", mesh)
    parent.users_collection[0].objects.link(photo)
    photo.parent = parent
    photo["component_id"] = "nxstage-control-panel"
    photo["decorative"] = True
    photo["pick_through_to_interaction_targets"] = True
    photo["source_photo"] = os.path.relpath(SOURCE_PHOTO, REPO_ROOT).replace("\\", "/")
    photo["texture_note"] = "Photo-derived visual reference beneath authored interactive controls; not calibrated CAD texture."
    return photo


def face_panel(c, front_y):
    panel = new_collection("01 Front control fascia", c)
    base = cube("System One control fascia", (0, front_y, 5.05), (3.92, 0.15, 1.55), PANEL, panel, .15, rotation=(math.radians(-6), 0, 0))
    base["component_id"] = "control-fascia"
    base["componentId"] = "nxstage-control-panel"
    base["interaction"] = "select"
    base["displayName"] = "NxStage control panel"
    photo_fascia(base)

    # Three dark status windows across the top.
    for x, col in zip((-1.02, 0.0, 1.02), (BLACK, BLACK, MAROON)):
        cube("Status window", (x, front_y - .10, 5.60), (.83, .035, .20), col, panel, .025)

    # Three rows of maroon center bars with colored triangular end fields.
    for row, (z, col) in enumerate(((5.25, GREEN), (4.86, YELLOW), (4.47, CORAL)), start=1):
        row_name = ("Dialysate", "Ultrafiltration", "Blood flow")[row - 1]
        lower = trapezoid(f"Row {row} left colored field", (-.86, z), .78, .34, col, panel, front_y - .14)
        mark_interaction(lower, f"NX-C01-ROW{row}-DOWN", "nxstage-control-panel", "press", f"{row_name} decrease")
        trapezoid(f"Row {row} center display", (0.0, z), 1.50, .34, MAROON, panel, front_y - .15)
        upper = trapezoid(f"Row {row} right colored field", (.86, z), .78, .34, col, panel, front_y - .14)
        mark_interaction(upper, f"NX-C01-ROW{row}-UP", "nxstage-control-panel", "press", f"{row_name} increase")
        cylinder(f"Row {row} left warning marker", (-1.18, front_y - .19, z - .11), .055, .025, BLACK, panel, rotation=(math.pi / 2, 0, 0))
        cylinder(f"Row {row} right warning marker", (1.18, front_y - .19, z + .11), .055, .025, BLACK, panel, rotation=(math.pi / 2, 0, 0))

    # Primary icon/control shapes around the bands.
    # Pale icon fields are visual-only. Keep the stable interaction contract
    # on the colored flow/rate controls and the three adjustment rows.
    cube("Add fluid icon field", (-1.64, front_y - .14, 5.08), (.46, .035, .54), CREAM_HI, panel, .07)
    cube("Volume toggle icon field", (-1.30, front_y - .15, 4.68), (.23, .035, .55), CREAM_HI, panel, .05)
    flow = cylinder("Green kidney control", (-1.64, front_y - .17, 4.48), .21, .045, GREEN, panel, rotation=(math.pi / 2, 0, 0), vertices=24)
    mark_interaction(flow, "NX-C01-FLOW", "nxstage-control-panel", "press", "Flow control")
    rate = cylinder("Green L per hour control", (1.53, front_y - .18, 5.18), .22, .045, GREEN, panel, rotation=(math.pi / 2, 0, 0), vertices=24)
    mark_interaction(rate, "NX-C01-RATE", "nxstage-control-panel", "press", "L/hr control")
    stop = cylinder("Red stop control", (1.63, front_y - .18, 4.83), .23, .07, CORAL, panel, rotation=(math.pi / 2, 0, 0), vertices=8)
    mark_interaction(stop, "NX-C01-STOP", "nxstage-control-panel", "press", "Stop control", .006)
    mute = cube("Yellow mute control", (1.63, front_y - .17, 4.46), (.42, .045, .42), YELLOW, panel, .06)
    mark_interaction(mute, "NX-C01-MUTE", "nxstage-control-panel", "press", "Mute control")
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
    cube("Upper machine shell", (0, .38, 3.60), (HEAD_W, HEAD_D - .76, HEAD_H), CREAM, head, .26)
    # The exposed chamber is deliberately simplified: the source video shows
    # its dark surface, but not enough detail to reconstruct its mechanisms.
    cube("Cycler chamber backing", (0, -.54, 3.90), (4.02, .12, 3.12), BLACK, head, .12)
    # This parent turns local X into outward travel in the exported GLB.
    axis = bpy.data.objects.new("Cycler door travel axis", None)
    head.objects.link(axis)
    axis.rotation_euler.z = -math.pi / 2
    door = bpy.data.objects.new("Cycler door assembly", None)
    head.objects.link(door)
    door.parent = axis
    door["componentId"] = "nxstage-cycler-door"
    door["displayName"] = "Upper cycler door"
    door["interaction"] = "open"
    door_shell = cube("Cycler door front shell", (0, -1.00, 3.60), (4.35, .42, 4.55), CREAM, head, .22)
    door_shell["interactionTargetOwner"] = "nxstage-cycler-door"
    door_shell["interactionTargetId"] = "NX-C03-CYCLER-DOOR"
    door_shell["interactionTargetDisplayName"] = "Upper cycler door"
    door_shell["interactionType"] = "open"
    door_shell["openTranslationMeters"] = .8
    shoulder = cube("Upper front shoulder", (0, -1.08, 4.82), (4.08, .32, 1.15), CREAM_HI, head, .18, rotation=(math.radians(-7), 0, 0))
    lower = cube("Front lower molded section", (0, -1.02, 3.15), (3.95, .34, 1.10), CREAM_HI, head, .18, rotation=(math.radians(7), 0, 0))
    recess = cube("Central recessed face", (0, -1.19, 3.80), (2.70, .035, .92), CREAM, head, .28)
    pull = cube("Cycler door pull", (0, -1.58, 2.10), (3.80, .12, .16), BLACK, head, .07)
    pull["interactionTargetOwner"] = "nxstage-cycler-handle"
    pull["interactionTargetId"] = "NX-C04-CYCLER-HANDLE"
    pull["interactionTargetDisplayName"] = "Cycler door handle"
    pull["interactionType"] = "open"
    pull["openRotationRadians"] = -math.pi / 2
    handle_arms = [curve(f"Cycler handle arm {side}", [(x, -1.18, 3.05), (x, -1.58, 2.10)], .07, BLACK, head) for side, x in (("left", -1.90), ("right", 1.90))]
    vents = add_vent_grid(head, -1.38, 3.92, width=1.30, rows=2, cols=14)
    panel = face_panel(root, -1.28)
    panel_base = bpy.data.objects["System One control fascia"]
    bpy.context.view_layer.update()
    # Preserve world poses while making controls children of the moving door.
    for obj in panel.objects:
        if obj is not panel_base and obj.parent is None:
            world = obj.matrix_world.copy()
            if obj.get("interaction_action") == "press":
                obj.animation_data_clear()
            obj.parent = panel_base
            obj.matrix_world = world
    for obj in [door_shell, shoulder, lower, recess, *vents.all_objects, panel_base]:
        world = obj.matrix_world.copy()
        obj.parent = door
        obj.matrix_world = world
    bpy.context.view_layer.update()
    # Orient the handle's local hinge axis along the horizontal crossbar.
    handle_axis = bpy.data.objects.new("Cycler handle hinge axis", None)
    head.objects.link(handle_axis)
    handle_axis.parent = door
    # The runtime exposes this as a bounded rotationY transform.  Orient the
    # local Y axis along the physical horizontal hinge so that the authored
    # rotation produces a visible upward lift instead of spinning around the
    # world-vertical axis.
    handle_axis.matrix_world = Matrix.Translation(Vector((0, -1.18, 3.05))) @ Matrix.Rotation(-math.pi / 2, 4, 'Z')
    handle = bpy.data.objects.new("Cycler handle hinge", None)
    head.objects.link(handle)
    handle.parent = handle_axis
    handle["componentId"] = "nxstage-cycler-handle"
    handle["displayName"] = "Cycler door handle"
    handle["interaction"] = "open"
    bpy.context.view_layer.update()
    for obj in [pull, *handle_arms]:
        world = obj.matrix_world.copy()
        obj.parent = handle
        obj.matrix_world = world
    for obj in panel.objects:
        if obj.get("interaction_action") == "press":
            add_press_action(obj, obj.get("pressDepthMeters", .004))

    # The black accessory case/platform is a major silhouette cue in the
    # reference photographs and sits on the head rather than floating behind it.
    accessory = new_collection("01A Upper accessory case", root)
    cube("Upper accessory platform", (0, .05, 6.14), (3.78, 1.42, .18), BLACK, accessory, .12)
    cube("Upper accessory soft case", (0, .06, 6.48), (3.52, 1.18, .56), BLACK_RUBBER, accessory, .14)
    cube("Accessory front identification window", (0, -.55, 6.49), (1.85, .035, .24), GRAY, accessory, .035)
    cube("Accessory front fabric strap left", (-1.18, -.61, 6.54), (.14, .05, .72), BLACK, accessory, .025)
    cube("Accessory front fabric strap right", (1.18, -.61, 6.54), (.14, .05, .72), BLACK, accessory, .025)
    for x in (-1.30, 1.30):
        cylinder("Accessory captive fastener", (x, -.64, 6.49), .10, .05, METAL, accessory, rotation=(math.pi / 2, 0, 0), vertices=24)

    # The large vertical side rails and front cross bar are visually dominant.
    for x in (-2.25, 2.25):
        curve("Vertical black side rail", [(x, -1.10, 1.45), (x, -1.12, 3.15), (x, -1.04, 5.70)], .10, BLACK, rails)
        curve("Angled rail mount", [(x, -1.04, 5.70), (x * .96, -.82, 5.95), (x * .96, -.76, 6.10)], .095, BLACK, rails)
    curve("Front black safety crossbar", [(-2.25, -1.20, 1.42), (0, -1.32, 1.30), (2.25, -1.20, 1.42)], .105, BLACK, rails)
    # Side pivot plates/handles, seen prominently in the oblique photographs.
    for x in (-2.34, 2.34):
        cube("Side pivot plate", (x, -.32, 3.05), (.20, .50, 1.45), BLACK, rails, .10, rotation=(0, math.radians(-22 if x < 0 else 22), 0))
        cylinder("Side pivot fastener", (x * 1.02, -.62, 3.18), .09, .04, METAL, rails, rotation=(0, math.pi / 2, 0))
    curve("Left side carry handle", [(-2.48, -.72, 4.55), (-2.90, -.76, 4.30), (-2.92, -.78, 3.40), (-2.48, -.73, 3.18)], .13, BLACK, rails)
    curve("Right side carry handle", [(2.48, -.72, 4.55), (2.90, -.76, 4.30), (2.92, -.78, 3.40), (2.48, -.73, 3.18)], .13, BLACK, rails)

    # White shelf/tray under the head with molded rounded recesses.
    cube("Upper white shelf", (0, 0, 1.05), (TRAY_W, TRAY_D, .36), CREAM_HI, tray, .18)
    cube("Shelf left recessed pad", (-1.75, -1.05, 1.25), (1.25, .62, .035), CREAM, tray, .12)
    cube("Shelf right recessed pad", (1.75, -1.05, 1.25), (1.25, .62, .035), CREAM, tray, .12)
    cube("Shelf center black insert", (0, 1.30, 1.24), (1.52, .40, .05), BLACK, tray, .06)

    # Lower cabinet: the source photographs show a left-hinged black door,
    # with an opening through which the control unit remains visible.
    # Dimensions and the hinge travel are estimates until measured.
    cube("Cabinet left wall", (-2.35, .10, -.35), (.20, BASE_D, BASE_H), BLACK, base, .05)
    cube("Cabinet right wall", (2.35, .10, -.35), (.20, BASE_D, BASE_H), BLACK, base, .05)
    cube("Cabinet rear wall", (0, 1.72, -.35), (4.55, .20, BASE_H), BLACK, base, .05)
    cube("Cabinet floor", (0, .10, -1.42), (4.55, BASE_D, .20), BLACK, base, .05)
    cube("Cabinet top", (0, .10, .72), (4.55, BASE_D, .20), BLACK, base, .05)
    door = bpy.data.objects.new("Lower cabinet door hinge", None)
    base.objects.link(door)
    door.location = (-2.35, -1.96, -.35)
    door["componentId"] = "nxstage-cabinet-door"
    door["displayName"] = "Lower cabinet door"
    door["interaction"] = "open"
    door["interactionTargetOwner"] = "nxstage-cabinet-door"
    door["interactionTargetId"] = "NX-C02-CABINET-DOOR"
    door["interactionTargetDisplayName"] = "Lower cabinet door"
    door["interactionType"] = "open"
    door["openRotationRadians"] = -math.pi / 2
    def door_part(name, center, size):
        part = cube(name, center, size, BLACK, base, .04)
        part.parent = door
        part.location -= door.location
        return part
    # Frame the rectangular viewing opening around the lower control display.
    door_part("Cabinet door lower panel", (0, -1.96, -.78), (4.70, .13, 1.35))
    door_part("Cabinet door upper rail", (0, -1.96, .70), (4.70, .13, .18))
    door_part("Cabinet door left stile", (-1.78, -1.96, .26), (1.14, .13, .70))
    door_part("Cabinet door right stile", (1.78, -1.96, .26), (1.14, .13, .70))
    door_part("Cabinet door pull", (1.96, -2.07, -.35), (.20, .13, .42))
    # The photographed lower module is offset to the operator's right and is
    # surrounded by a larger gray service panel; keeping that asymmetry makes
    # the front read like the real cart instead of a centered dashboard.
    cube("Lower gray service panel", (.62, -1.70, -.52), (2.18, .06, 1.40), GRAY, base, .07)
    # The open photographs show a gray removable container behind the door.
    cube("Container left side", (-.49, -1.22, -.52), (.08, .94, 1.40), GRAY, base, .025)
    cube("Container right side", (1.73, -1.22, -.52), (.08, .94, 1.40), GRAY, base, .025)
    cube("Container bottom", (.62, -1.22, -1.19), (2.18, .94, .08), GRAY, base, .025)
    cube("Lower front inset panel", (.66, -1.76, .25), (1.48, .06, .78), BLACK_RUBBER, base, .05)
    cube("Lower front LCD", (.66, -1.81, .36), (1.05, .035, .25), LCD, base, .03)
    for x, col in ((.18, GREEN), (1.14, CORAL)):
        cylinder("Lower status button", (x, -1.85, .03), .13, .06, col, base, rotation=(math.pi / 2, 0, 0), vertices=32)
    for x in (.30, .58):
        trapezoid("Lower blue arrow", x, .22, .22, BLUE, base, -1.85, z=.03)
    cube("Lower left connector strip", (-1.24, -1.73, -.25), (.38, .08, 1.22), BLUE, base, .04)
    for z, col in ((.18, YELLOW), (-.15, CORAL), (-.48, WHITE)):
        cylinder("Lower connector detail", (-1.24, -1.82, z), .09, .05, col, base, rotation=(math.pi / 2, 0, 0), vertices=24)
    cube("Lower warning label", (.66, -1.84, -.98), (.42, .03, .30), YELLOW, base, .02)
    for x in (-1.86, 1.86):
        for y in (-1.72, 1.72):
            cylinder("Caster wheel", (x, y, -1.62), .28, .16, BLACK_RUBBER, base, rotation=(math.pi / 2, 0, 0), vertices=32)
            cube("Caster fork", (x, y, -1.38), (.16, .16, .35), METAL, base, .04)
            if y < 0:
                cylinder("Front caster hub", (x, y - .10, -1.62), .17, .025, METAL, base, rotation=(math.pi / 2, 0, 0), vertices=32, bevel=.015)

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
    root["source_photo_set_count"] = len(SOURCE_PHOTO_SET)
    root["source_photo_set"] = ";".join(os.path.relpath(path, REPO_ROOT).replace("\\", "/") for path in SOURCE_PHOTO_SET)
    root["device"] = "NxStage System One training/demonstration machine"
    root["scale_status"] = "relative photo-derived proportions; no measured scale reference"
    root["fidelity_status"] = "visual reconstruction; hidden geometry and exact dimensions remain unverified"
    root["interaction_model"] = "front control press targets, an estimated sliding cycler door, and an estimated left-hinged lower cabinet door"
    root["interaction_targets"] = "NX-C01-FLOW, NX-C01-RATE, NX-C01-STOP, NX-C01-MUTE, NX-C01-ROW1-DOWN/UP, NX-C01-ROW2-DOWN/UP, NX-C01-ROW3-DOWN/UP, NX-C02-CABINET-DOOR"
    return root


def look_at(o, target):
    o.rotation_euler = (Vector(target) - o.location).to_track_quat('-Z', 'Y').to_euler()


def set_eevee_engine(scene):
    try:
        scene.render.engine = 'BLENDER_EEVEE_NEXT'
    except TypeError:
        scene.render.engine = 'BLENDER_EEVEE'


def ensure_world(scene, name):
    if scene.world is None:
        scene.world = bpy.data.worlds.new(name)
    return scene.world


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
    cam_data.lens = 52
    cam = bpy.data.objects.new("CAM_Hero", cam_data)
    c.objects.link(cam)
    cam.location = (9.8, -12.4, 8.0)
    look_at(cam, (0, 0, 2.9))
    bpy.context.scene.camera = cam

    scene = bpy.context.scene
    set_eevee_engine(scene)
    scene.render.resolution_x = 900
    scene.render.resolution_y = 1100
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.render.filepath = os.path.join(OUTPUT_ROOT, "fixtures", ASSET_FOLDER, "nxstage-system-one-preview.png")
    ensure_world(scene, "NxStage Studio World").color = (.008, .012, .016)
    scene.view_settings.look = 'AgX - Medium High Contrast'
    scene["preview_warning"] = "Preview is photo-grounded but not dimensionally validated."


def ensure_uvs(objects):
    """Give every exported mesh a stable UV layer for the embedded PBR maps."""
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects:
        if obj.type != 'MESH' or obj.data.uv_layers:
            continue
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.uv.smart_project(island_margin=0.02, area_weight=0.0)
        bpy.ops.object.mode_set(mode='OBJECT')
        obj.select_set(False)


def main():
    os.makedirs(os.path.join(OUTPUT_ROOT, "fixtures", ASSET_FOLDER), exist_ok=True)
    os.makedirs(os.path.join(OUTPUT_ROOT, "blender"), exist_ok=True)
    device = build_device()
    build_presentation()
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUTPUT_ROOT, "blender", "nxstage_system_one.blend"))
    bpy.ops.object.select_all(action='DESELECT')
    device_objects = list(device.all_objects)
    ensure_uvs(device_objects)
    for obj in device_objects:
        obj.select_set(True)
    if device_objects:
        bpy.context.view_layer.objects.active = device_objects[0]
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUTPUT_ROOT, "fixtures", ASSET_FOLDER, "nxstage-system-one.glb"), export_format='GLB', export_apply=True, export_extras=True, use_selection=True)
    if os.environ.get("NXSTAGE_SKIP_RENDER") != "1":
        bpy.ops.render.render(write_still=True)


if __name__ == '__main__':
    main()
