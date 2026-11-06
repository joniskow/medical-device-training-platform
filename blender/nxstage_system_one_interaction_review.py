"""Photo-grounded hard-surface reconstruction of the uploaded System One device.

This is an editable Blender scene generator, not a clinical/manufacturing model.
The proportions are normalized from the uploaded photographs; no physical scale
reference was supplied. Run from the repository root after installing Blender:

    blender -b --python blender/nxstage_system_one_interaction_review.py

Outputs:
    blender/nxstage_system_one_interaction_review.blend
    fixtures/nxstage-system-one-interaction-review/nxstage-system-one-preview.png
"""

import math
import os
from array import array
import bpy
from mathutils import Matrix, Vector


# Reset before module-level materials are created; resetting later would delete
# the material datablocks that the generated geometry references.
bpy.ops.wm.read_factory_settings(use_empty=True)
REPO_ROOT = os.getcwd()
OUTPUT_ROOT = os.path.abspath(os.environ.get("NXSTAGE_OUTPUT_ROOT", REPO_ROOT))
ASSET_FOLDER = os.environ.get("NXSTAGE_ASSET_FOLDER", "nxstage-system-one-interaction-review")
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
    output_width, output_height = 1600, 920
    trim_top = -150
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
REAR_METAL = material("Cycler rear satin panel", (0.72, 0.72, 0.71), 0.48, 0.18)
METAL = material("Brushed stainless steel", (0.55, 0.58, 0.57), 0.22, 0.72)
# The supplied open-cabinet photos show a satin metal tub, rather than the
# matte gray plastic used for the rear service cover. This is an approximate
# finish; its appearance depends on the lighting in the viewer.
TUB_STEEL = material("PureFlow tub satin metal", (0.52, 0.53, 0.54), 0.38, 0.38)
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
PUREFLOW_BUTTON_BLUE = material("PureFlow control blue", (0.045, 0.25, 0.72), 0.48)
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
    """Preserve the photo while moving only traced control silhouettes."""
    width, height, local_y = 1.78, 0.94, -0.23
    # Outlines traced on the original 1600 x 640 crop, offset into the taller crop.
    # The L/hr icon is deliberately excluded: it is printed artwork.
    regions = [
        ("NX-C01-ADD-FLUID", "Add Fluid", [(340,142),(474,142),(487,155),(489,280),(480,294),(338,295),(325,281),(325,157)]),
        ("NX-C01-VOLUME-TOGGLE", "Volume Toggle", [(549,226),(610,226),(619,238),(623,376),(611,388),(549,388),(537,377),(536,239)]),
        ("NX-C01-TREATMENT", "Treatment", [(412,349),(451,352),(477,373),(491,398),(494,426),(486,456),(471,480),(446,497),(417,502),(393,491),(378,474),(376,454),(389,434),(390,415),(377,396),(378,376),(391,358)]),
        ("NX-C01-STOP", "Stop control", [(1417,101),(1482,101),(1534,141),(1537,199),(1497,249),(1424,251),(1379,216),(1375,146)]),
        ("NX-C01-MUTE", "Mute control", [(1404,307),(1542,304),(1553,316),(1558,448),(1546,460),(1406,462),(1391,450),(1388,320)]),
        ("NX-C01-ROW1-DOWN", "Dialysate decrease", [(628,41),(802,39),(724,187)]),
        ("NX-C01-ROW1-UP", "Dialysate increase", [(1125,29),(1215,172),(1049,178)]),
        ("NX-C01-ROW2-DOWN", "Ultrafiltration decrease", [(635,230),(809,224),(732,376)]),
        ("NX-C01-ROW2-UP", "Ultrafiltration increase", [(1134,215),(1225,356),(1057,365)]),
        ("NX-C01-ROW3-DOWN", "Blood flow decrease", [(644,419),(820,414),(742,565)]),
        ("NX-C01-ROW3-UP", "Blood flow increase", [(1144,401),(1242,544),(1072,550)]),
    ]
    regions = [(target, label, [(x/1600, 1-(y+210)/920) for x,y in points]) for target,label,points in regions]
    ys = sorted({0.0, 1.0, *(y for _,_,points in regions for _,y in points)})
    def x_at(edge, y):
        (x0,y0),(x1,y1) = edge
        return x0 + (x1-x0)*(y-y0)/(y1-y0)
    def make_mesh(name, polygons):
        verts, faces, uvs = [], [], []
        for coords in polygons:
            base = len(verts)
            verts.extend([(-width+2*width*x, local_y, -height+2*height*y) for x,y in coords])
            faces.append(tuple(range(base, base+len(coords))))
            uvs.extend(coords)
        mesh = bpy.data.meshes.new(name + " mesh")
        mesh.from_pydata(verts, [], faces)
        mesh.materials.append(PHOTO_FASCIA)
        uv = mesh.uv_layers.new(name="UVMap")
        for loop, coord in zip(uv.data, uvs): loop.uv = coord
        obj = bpy.data.objects.new(name, mesh)
        parent.users_collection[0].objects.link(obj)
        obj.parent = parent
        obj["component_id"] = "nxstage-control-panel"
        return obj
    # Decompose the non-control photo into horizontal trapezoids. Each band is
    # split at the traced polygon edges, so the background and targets meet
    # exactly without overlapping or showing the underlying primitive artwork.
    background = []
    for y0,y1 in zip(ys,ys[1:]):
        mid=(y0+y1)/2
        intervals=[]
        for _,_,points in regions:
            edges=[(a,b) for a,b in zip(points,points[1:]+points[:1]) if min(a[1],b[1]) < mid < max(a[1],b[1])]
            edges.sort(key=lambda edge:x_at(edge,mid))
            if len(edges)%2: raise RuntimeError("Malformed control outline")
            intervals.extend(zip(edges[::2],edges[1::2]))
        intervals.sort(key=lambda pair:x_at(pair[0],mid))
        previous0=previous1=0.0
        for left,right in intervals:
            left0,left1=x_at(left,y0),x_at(left,y1)
            right0,right1=x_at(right,y0),x_at(right,y1)
            if left0 < previous0-1e-8 or left1 < previous1-1e-8: raise RuntimeError("Overlapping control outlines")
            background.append([(previous0,y0),(left0,y0),(left1,y1),(previous1,y1)])
            previous0,previous1=right0,right1
        background.append([(previous0,y0),(1,y0),(1,y1),(previous1,y1)])
    photo=make_mesh("Photo-derived control fascia", background)
    photo["source_photo"]=os.path.relpath(SOURCE_PHOTO, REPO_ROOT).replace("\\", "/")
    for target,label,points in regions:
        tile=make_mesh("Photographed " + label, [points])
        mark_interaction(tile,target,"nxstage-control-panel","press",label,.006 if target=="NX-C01-STOP" else .004)
    return photo


def face_panel(c, front_y):
    panel = new_collection("01 Front control fascia", c)
    base = cube("System One control fascia", (0, front_y, 4.95), (3.92, 0.15, 1.95), PANEL, panel, .15, rotation=(math.radians(-6), 0, 0))
    base["component_id"] = "control-fascia"
    base["componentId"] = "nxstage-control-panel"
    base["interaction"] = "select"
    base["displayName"] = "NxStage control panel"
    photo_fascia(base)
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
    # The supplied front views show a shallow, curved depression below the
    # fascia, tapering to a rounded point above the black handle. Its depth and
    # outline are visual estimates; it remains part of the sliding door.
    vertices, faces = [], []
    columns, rows = 40, 20
    for row in range(rows + 1):
        t = row / rows
        for col in range(columns + 1):
            u = (col / columns) * 2 - 1
            x = u * 1.83
            bottom = 2.47 + 1.03 * abs(u) ** 2
            z = bottom + (4.04 - bottom) * t
            y = -1.32 - .035 * (1 - u * u) * math.sin(math.pi * t)
            vertices.append((x, y, z))
    for row in range(rows):
        for col in range(columns):
            a = row * (columns + 1) + col
            faces.append((a, a + 1, a + columns + 2, a + columns + 1))
    mesh = bpy.data.meshes.new("Central recessed face mesh")
    mesh.from_pydata(vertices, [], faces)
    # A restrained tonal falloff follows the shallow bowl visible in the
    # photographs; it is an illustrative surface cue, not a measured depth.
    colors = mesh.color_attributes.new(name="Recess shading", type="FLOAT_COLOR", domain="POINT")
    mesh.color_attributes.active_color = colors
    for index, datum in enumerate(colors.data):
        row, col = divmod(index, columns + 1)
        u, t = col / columns * 2 - 1, row / rows
        shade = 1 - .18 * (1 - u * u) ** 2 * math.sin(math.pi * t) ** 2
        datum.color = (shade, shade, shade, 1)
    recess_material = CREAM.copy()
    recess_material.name = "Cycler curved face"
    nodes, links = recess_material.node_tree.nodes, recess_material.node_tree.links
    base_color = next(node for node in nodes if node.type == "BSDF_PRINCIPLED").inputs["Base Color"]
    albedo = base_color.links[0].from_socket
    vertex_color = nodes.new("ShaderNodeVertexColor")
    vertex_color.layer_name = "Recess shading"
    multiply = nodes.new("ShaderNodeMixRGB")
    multiply.blend_type = "MULTIPLY"
    multiply.inputs[0].default_value = 1
    links.new(albedo, multiply.inputs[1])
    links.new(vertex_color.outputs["Color"], multiply.inputs[2])
    links.new(multiply.outputs[0], base_color)
    mesh.materials.append(recess_material)
    recess = bpy.data.objects.new("Central recessed face", mesh)
    head.objects.link(recess)
    recess["decorative"] = True
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    # The frontal open-cabinet photograph shows one shallow arched row of
    # narrow vents below the fascia. Slot dimensions and curvature are visual estimates.
    front_vents = []
    for i in range(15):
        x = (i - 7) * .085
        z = 3.62 - .075 * (x / .595) ** 2
        slot = cube("Cycler arched front vent %02d" % (i + 1), (x, -1.37, z), (.038, .018, .17), BLACK, head, .014, rotation=(0, -x * .32, 0))
        slot["decorative"] = True
        front_vents.append(slot)
    # One crossbar spans the lower front in the closed reference photos. Its
    # placement is approximate, as its raised position was not photographed.
    pull = cube("Cycler door pull", (0, -1.58, 1.42), (4.50, .18, .18), BLACK, head, .08)
    # The two visible side links have a broad pivot end and taper toward the
    # lower crossbar. Their profile is a visual estimate from the closed views.
    handle_arms = []
    profile = [(-1.50, 3.20), (-1.28, 3.34), (-.99, 3.25), (-.86, 3.04),
               (-.96, 2.85), (-1.18, 2.78), (-1.48, 1.43), (-1.67, 1.42),
               (-1.53, 2.81), (-1.58, 3.02)]
    for side, x in (("left", -2.25), ("right", 2.25)):
        vertices = [(x + dx, y, z) for dx in (-.075, .075) for y, z in profile]
        n = len(profile)
        faces = [tuple(reversed(range(n))), tuple(range(n, 2*n))]
        faces.extend((i, (i+1) % n, (i+1) % n+n, i+n) for i in range(n))
        mesh = bpy.data.meshes.new("Cycler handle arm " + side + " mesh")
        mesh.from_pydata(vertices, [], faces)
        mesh.materials.append(BLACK)
        arm = bpy.data.objects.new("Cycler handle arm " + side, mesh)
        head.objects.link(arm)
        bevel = arm.modifiers.new("Rounded handle edge", "BEVEL")
        bevel.width = .035
        bevel.segments = 3
        arm.modifiers.new("Weighted handle normals", "WEIGHTED_NORMAL")
        handle_arms.append(arm)
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
    for obj in [door_shell, shoulder, recess, *front_vents, panel_base]:
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
    handle_axis.matrix_world = Matrix.Translation(Vector((0, -1.18, 3.05))) @ Matrix.Rotation(math.pi / 2, 4, 'Y')
    handle = bpy.data.objects.new("Cycler handle hinge", None)
    head.objects.link(handle)
    handle.parent = handle_axis
    handle["componentId"] = "nxstage-cycler-handle"
    handle["displayName"] = "Cycler door handle"
    handle["interaction"] = "open"
    handle["interactionTargetOwner"] = "nxstage-cycler-handle"
    handle["interactionTargetId"] = "NX-C04-CYCLER-HANDLE"
    handle["interactionTargetDisplayName"] = "Cycler door handle"
    handle["interactionType"] = "open"
    handle["openRotationRadians"] = -math.pi / 2
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
    # The photographs show the Express Fluid Warmer's control strip in this
    # holder. The arrows are controls; the power symbol and bar are indicators.
    warmer_panel = cube("Express warmer control panel", (0, -.55, 6.49), (1.85, .035, .24), PANEL, accessory, .025)
    warmer_panel["componentId"] = "express-warmer-panel"
    warmer_panel["displayName"] = "Express warmer control panel"
    warmer_panel["interaction"] = "select"
    warmer_parts = []
    for x, up, target, label in ((-.57, False, "FW-C01-DOWN", "Warmer cooler"), (.57, True, "FW-C01-UP", "Warmer warmer")):
        top, bottom = (6.565, 6.415) if up else (6.415, 6.565)
        mesh = bpy.data.meshes.new(label + " mesh")
        mesh.from_pydata([(x, -.579, top), (x-.075, -.579, bottom), (x+.075, -.579, bottom)], [], [(0, 1, 2) if up else (0, 2, 1)])
        mesh.materials.append(PUREFLOW_BUTTON_BLUE)
        control = bpy.data.objects.new(label, mesh)
        accessory.objects.link(control)
        warmer_parts.append(mark_interaction(control, target, "express-warmer-panel", "press", label))
    for index in range(9):
        warmer_parts.append(cube("Warmer setting indicator " + str(index + 1), (-.32 + index * .08, -.576, 6.49), (.035, .008, .105), GRAY, accessory, .004))
    for x, name in ((-.80, "Warmer power indicator"), (.80, "Warmer status indicator")):
        warmer_parts.append(cylinder(name, (x, -.576, 6.49), .045, .008, GRAY, accessory, rotation=(math.pi / 2, 0, 0), vertices=24))
    bpy.context.view_layer.update()
    for obj in warmer_parts:
        world = obj.matrix_world.copy()
        if obj.get("interaction_action") == "press":
            obj.animation_data_clear()
        obj.parent = warmer_panel
        obj.matrix_world = world
    cube("Accessory front fabric strap left", (-1.18, -.61, 6.54), (.14, .05, .72), BLACK, accessory, .025)
    cube("Accessory front fabric strap right", (1.18, -.61, 6.54), (.14, .05, .72), BLACK, accessory, .025)
    for x in (-1.30, 1.30):
        cylinder("Accessory captive fastener", (x, -.64, 6.49), .10, .05, METAL, accessory, rotation=(math.pi / 2, 0, 0), vertices=24)

    # The large vertical side rails and front cross bar are visually dominant.
    for x in (-2.25, 2.25):
        curve("Vertical black side rail", [(x, -1.10, 1.45), (x, -1.12, 3.15), (x, -1.04, 5.70)], .10, BLACK, rails)
        curve("Angled rail mount", [(x, -1.04, 5.70), (x * .96, -.82, 5.95), (x * .96, -.76, 6.10)], .095, BLACK, rails)
    # The pivot centers stay fixed relative to the door while the links rotate;
    # they must travel with the door and its handle assembly when it opens.
    for x in (-2.34, 2.34):
        pivot = cylinder("Side pivot fastener", (x, -1.18, 3.05), .065, .045, METAL, head, rotation=(0, math.pi / 2, 0))
        world = pivot.matrix_world.copy()
        pivot.parent = door
        pivot.matrix_world = world
    # The side view shows a horizontal mounting block and a recessed,
    # roughly rectangular grip below it. Its depth and exact shape are
    # estimated; it is a fixed carry handle, not the movable door handle.
    for side, x in (("Left", -2.32), ("Right", 2.32)):
        cube(side + " side carry handle mount", (x, -.25, 4.57), (.18, 1.16, .24), BLACK, rails, .055)
        for y in (-.69, .19):
            cube(side + " side carry handle end", (x, y, 4.30), (.15, .15, .48), BLACK, rails, .055)
        cube(side + " side carry handle grip", (x, -.25, 4.10), (.15, 1.00, .15), BLACK, rails, .055)

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
    # The source photographs show a removable tub; its unmeasured travel is
    # represented along the outward axis, separately from the cabinet door.
    tub_orientation = bpy.data.objects.new("PureFlow tub outward orientation", None)
    base.objects.link(tub_orientation)
    tub_orientation.rotation_euler.z = -math.pi / 2
    tub = bpy.data.objects.new("PureFlow tub travel axis", None)
    base.objects.link(tub)
    # Translation is expressed in the parent's coordinates. Rotating the
    # movable node itself only turns its contents; the parent sets the actual
    # direction of local X travel to outward from the cabinet.
    tub.parent = tub_orientation
    tub["componentId"] = "pureflow-tub"
    tub["displayName"] = "PureFlow tub"
    tub["interaction"] = "open"
    front = cube("PureFlow tub front", (.62, -1.70, -.52), (2.18, .06, 1.40), TUB_STEEL, base, .07)
    tub["interactionTargetOwner"] = "pureflow-tub"
    tub["interactionTargetId"] = "PF-C02-TUB"
    tub["interactionTargetDisplayName"] = "PureFlow tub"
    tub["interactionType"] = "open"
    tub["openTranslationMeters"] = 2.1
    tub_parts = [front,
        cube("Container left side", (-.49, -.80, -.52), (.08, 1.80, 1.40), TUB_STEEL, base, .025),
        cube("Container right side", (1.73, -.80, -.52), (.08, 1.80, 1.40), TUB_STEEL, base, .025),
        cube("Container back", (.62, .10, -.52), (2.18, .08, 1.40), TUB_STEEL, base, .025),
        cube("Container bottom", (.62, -.80, -1.19), (2.18, 1.80, .08), TUB_STEEL, base, .025),
        cube("Tub front rim", (.62, -1.70, .18), (2.18, .09, .055), METAL, base, .018),
        cube("Tub back rim", (.62, .10, .18), (2.18, .09, .055), METAL, base, .018),
        cube("Tub left rim", (-.49, -.80, .18), (.09, 1.80, .055), METAL, base, .018),
        cube("Tub right rim", (1.73, -.80, .18), (.09, 1.80, .055), METAL, base, .018)]
    bpy.context.view_layer.update()
    for obj in tub_parts:
        world = obj.matrix_world.copy()
        obj.parent = tub
        obj.matrix_world = world
    lower_panel = cube("PureFlow control panel", (.66, -1.76, .25), (1.48, .06, .78), CREAM_HI, base, .05)
    lower_panel["componentId"] = "pureflow-control-panel"
    lower_panel["displayName"] = "PureFlow control panel"
    lower_panel["interaction"] = "select"
    # The photographed lower display sits within a black controller case.
    # Keep the housing fixed to the panel rather than the pull-out tub.
    controller_housing = cube("PureFlow controller housing", (.66, -1.675, .25), (1.72, .16, .99), BLACK_RUBBER, base, .065)
    # The supplied open-cabinet views show a separate white-and-gray housing
    # to the right of the display. Its fittings and function are not visible
    # clearly enough to model as controls; dimensions and depth are estimates.
    cube("Lower right equipment housing", (1.83, -1.36, .30), (.68, .55, .76), CREAM_HI, base, .09)
    cube("Lower right equipment cover", (1.83, -1.68, .28), (.55, .12, .57), GRAY, base, .16)
    for x in (1.60, 2.06):
        cylinder("Lower equipment fastener", (x, -1.755, .05), .025, .014, BLACK_RUBBER, base, rotation=(math.pi / 2, 0, 0), vertices=16)
    # Dark outlines on the photographed membrane panel frame the LCD,
    # indicator windows and buttons. They are fixed decoration, not controls.
    bezels = [cube("PureFlow LCD bezel", (.66, -1.80, .36), (1.38, .012, .29), BLACK_RUBBER, base, .025)]
    for x, name in ((.35, "operating"), (.66, "caution"), (.97, "alarm")):
        bezels.append(cube("PureFlow " + name + " indicator bezel", (x, -1.80, .58), (.205, .012, .12), BLACK_RUBBER, base, .009))
    for x, label, vertices in ((1.02, "GO", 32), (1.27, "STOP", 8)):
        bezels.append(cylinder("PureFlow " + label + " button bezel", (x, -1.835, .03), .108, .012, BLACK_RUBBER, base, rotation=(math.pi / 2, 0, 0), vertices=vertices))
    for x, up, label in ((.14, True, "up"), (.38, False, "down")):
        top, bottom = (.135, -.075) if up else (-.075, .135)
        mesh = bpy.data.meshes.new("PureFlow " + label + " bezel mesh")
        mesh.from_pydata([(x, -1.835, top), (x-.105, -1.835, bottom), (x+.105, -1.835, bottom)], [], [(0, 1, 2) if up else (0, 2, 1)])
        mesh.materials.append(BLACK_RUBBER)
        bezel = bpy.data.objects.new("PureFlow " + label + " button bezel", mesh)
        base.objects.link(bezel)
        bezels.append(bezel)
    # The reference has a blue Nx mark followed by a dark STAGE wordmark.
    # These are approximations, not a traced or legible reproduction.
    wordmark = [text("PureFlow blue wordmark", "Nx", (.57, -1.831, .002), .073, PUREFLOW_BUTTON_BLUE, base),
                text("PureFlow dark wordmark", "STAGE", (.70, -1.831, .002), .057, BLACK_RUBBER, base)]
    lcd = cube("Lower front LCD", (.66, -1.81, .36), (1.34, .035, .25), LCD, base, .03)
    indicators = [cube("PureFlow " + name + " indicator", (x, -1.81, .58), (.18, .012, .095), col, base, .008) for x, name, col in ((.35, "operating", GREEN), (.66, "caution", YELLOW), (.97, "alarm", CORAL))]
    controls = []
    for x, col, target, label in ((1.02, GREEN, "PF-C01-GO", "PureFlow GO"), (1.27, CORAL, "PF-C01-STOP", "PureFlow STOP")):
        control = cylinder(label, (x, -1.85, .03), .095, .018, col, base, rotation=(math.pi / 2, 0, 0), vertices=8 if target == "PF-C01-STOP" else 32)
        # Keep the circular button face flat; only the thin edge is smooth.
        if target == "PF-C01-GO":
            for polygon in control.data.polygons:
                polygon.use_smooth = len(polygon.vertices) == 4
        controls.append(mark_interaction(control, target, "pureflow-control-panel", "press", label))
    for x, up, target, label in ((.14, True, "PF-C01-UP", "PureFlow up"), (.38, False, "PF-C01-DOWN", "PureFlow down")):
        top, bottom = (.12, -.06) if up else (-.06, .12)
        mesh = bpy.data.meshes.new(label + " mesh")
        mesh.from_pydata([(x, -1.85, top), (x-.09, -1.85, bottom), (x+.09, -1.85, bottom)], [], [(0, 1, 2) if up else (0, 2, 1)])
        mesh.materials.append(PUREFLOW_BUTTON_BLUE)
        control = bpy.data.objects.new(label, mesh)
        base.objects.link(control)
        controls.append(mark_interaction(control, target, "pureflow-control-panel", "press", label))
    bpy.context.view_layer.update()
    for obj in [controller_housing, lcd, *indicators, *bezels, *wordmark, *controls]:
        world = obj.matrix_world.copy()
        if obj in controls: obj.animation_data_clear()
        obj.parent = lower_panel
        obj.matrix_world = world
    cube("Lower left connector strip", (-1.24, -1.73, -.25), (.38, .08, 1.22), BLUE, base, .04)
    # The open-cabinet photo shows a red-ringed fitting above a light-colored
    # connector and a narrow hanging tube. These are fixed visual details;
    # their exact geometry and connection path cannot be established here.
    cylinder("Lower connector detail red collar", (-1.24, -1.80, .18), .105, .035, CORAL, base, rotation=(math.pi / 2, 0, 0), vertices=32)
    cylinder("Lower connector detail dark socket", (-1.24, -1.83, .18), .061, .035, BLACK_RUBBER, base, rotation=(math.pi / 2, 0, 0), vertices=32)
    cylinder("Lower connector detail metal fitting", (-1.24, -1.85, .18), .034, .05, METAL, base, rotation=(math.pi / 2, 0, 0), vertices=24)
    cylinder("Lower connector detail light fitting", (-1.24, -1.84, -.13), .075, .08, WHITE, base, rotation=(math.pi / 2, 0, 0), vertices=32, bevel=.01)
    curve("Lower connector detail tubing", [(-1.24, -1.89, .18), (-1.29, -1.91, -.04), (-1.30, -1.92, -.35), (-1.42, -1.90, -.65), (-1.60, -1.78, -.84)], .025, WHITE, base)
    cube("Lower connector detail yellow clip", (-1.30, -1.92, -.42), (.115, .065, .14), YELLOW, base, .02)
    # The source photo places the yellow heat-warning label on the tub itself.
    # Its symbol is an approximate graphic, not a readable safety label.
    warning = cube("Tub warning label", (.66, -1.745, -.98), (.30, .012, .25), YELLOW, base, .008)
    def warning_triangle(name, y, width, bottom, top, mat):
        mesh = bpy.data.meshes.new(name + " mesh")
        mesh.from_pydata([(.66-width, y, bottom), (.66+width, y, bottom), (.66, y, top)], [], [(0, 1, 2)])
        mesh.materials.append(mat)
        obj = bpy.data.objects.new(name, mesh)
        base.objects.link(obj)
        return obj
    warning_border = warning_triangle("Tub warning triangle", -1.754, .105, -1.065, -.875, BLACK_RUBBER)
    warning_inset = warning_triangle("Tub warning triangle inset", -1.757, .077, -1.048, -.908, YELLOW)
    warning_marks = [curve("Tub warning heat mark " + str(index), [(x, -1.762, -1.035), (x-.006, -1.762, -1.012), (x+.006, -1.762, -.995), (x, -1.762, -.978)], .003, BLACK_RUBBER, base) for index, x in enumerate((.64, .66, .68))]
    # The photographs also show small white identification labels on the
    # front. Their text is not legible, so represent only their shapes.
    tub_labels = [cube(name, (x, -1.739, z), (width, .008, height), WHITE, base, .005)
                  for name, x, z, width, height in (
                      ("Tub upper left label", -.20, .035, .28, .085),
                      ("Tub upper right label", 1.48, .035, .19, .085),
                      ("Tub lower right label", 1.43, -1.03, .16, .065))]
    bpy.context.view_layer.update()
    for obj in [warning, warning_border, warning_inset, *warning_marks, *tub_labels]:
        world = obj.matrix_world.copy()
        obj.parent = tub
        obj.matrix_world = world
    for x in (-1.86, 1.86):
        for y in (-1.72, 1.72):
            cylinder("Caster wheel", (x, y, -1.62), .28, .16, BLACK_RUBBER, base, rotation=(math.pi / 2, 0, 0), vertices=32)
            cube("Caster fork", (x, y, -1.38), (.16, .16, .35), METAL, base, .04)
            if y < 0:
                cylinder("Front caster hub", (x, y - .10, -1.62), .17, .025, METAL, base, rotation=(math.pi / 2, 0, 0), vertices=32, bevel=.015)

    # Rear rocker position is based on the supplied rear photograph. Its travel
    # is estimated, and changing it does not model electrical power.
    cube("Cycler rear power panel", (-.465, 1.45, 2.52), (.78, .10, .57), GRAY, head, .025)
    cube("Cycler rear power inlet", (-.28, 1.515, 2.52), (.23, .045, .32), BLACK, head, .025)
    cube("Cycler rear switch bezel", (-.65, 1.515, 2.52), (.28, .045, .38), BLACK, head, .025)
    switch_axis = bpy.data.objects.new("Cycler power switch pivot", None)
    head.objects.link(switch_axis)
    switch_axis.matrix_world = Matrix.Translation(Vector((-.65, 1.55, 2.52))) @ Matrix.Rotation(math.pi / 2, 4, 'Y')
    switch_axis["componentId"] = "cycler-rear-power-switch"
    switch_axis["displayName"] = "Cycler rear power switch"
    switch_axis["interaction"] = "open"
    rocker = cube("Cycler rear power rocker", (-.65, 1.55, 2.52), (.20, .07, .30), BLACK_RUBBER, head, .025)
    rocker["interactionTargetOwner"] = "cycler-rear-power-switch"
    rocker["interactionTargetId"] = "NX-C05-POWER-SWITCH"
    rocker["interactionTargetDisplayName"] = "Cycler rear power switch"
    rocker["interactionType"] = "open"
    rocker["openRotationRadians"] = -0.24
    rocker["openRotationSpace"] = "local"
    rocker["touchTapSlopPixels"] = 12
    bpy.context.view_layer.update()
    rocker_world = rocker.matrix_world.copy()
    rocker.parent = switch_axis
    rocker.matrix_world = rocker_world
    # Off and on should rest on opposite sides of the rocker pivot, rather
    # than showing a centered rocker in the initial visual-only state.
    center = Vector((-.65, 1.55, 2.52))
    rocker.matrix_world = Matrix.Translation(center) @ Matrix.Rotation(.12, 4, 'X') @ Matrix.Translation(-center) @ rocker.matrix_world

    # Rear service side visible in the photographs.
    cube("Rear gray service cover", (0, 1.38, -.05), (3.60, .08, 1.85), GRAY, base, .06)
    # The lower rear view shows a broad flat service cover. The wider
    # 20261020_131328 photograph also shows two perforated fields and three
    # central horizontal louvers above it. Their spacing is a visual estimate.
    cube("Cycler rear service panel", (0, 1.38, 4.18), (3.55, .09, 2.94), REAR_METAL, head, .075)
    for side, center_x in (("left", -1.02), ("right", 1.02)):
        vertices, faces = [], []
        for row in range(12):
            for col in range(13):
                x = center_x + (col - 6) * .075
                z = 4.67 + row * .063
                first = len(vertices)
                vertices.extend((x + .018 * math.cos(angle * math.tau / 8), 1.435, z + .018 * math.sin(angle * math.tau / 8)) for angle in range(8))
                faces.append(tuple(reversed(range(first, first + 8))))
        mesh = bpy.data.meshes.new("Cycler rear " + side + " perforation mesh")
        mesh.from_pydata(vertices, [], faces)
        mesh.materials.append(BLACK_RUBBER)
        grille = bpy.data.objects.new("Cycler rear " + side + " perforations", mesh)
        head.objects.link(grille)
        grille["decorative"] = True
    for i in range(3):
        cube("Cycler rear central louver %d" % (i + 1), (0, 1.45, 4.78 + i * .20), (.62, .055, .085), REAR_METAL, head, .025)
    # The supplied rear view shows a shallow rounded rectangular enclosure
    # mounted below the perforations. It is a fixed visual approximation; the
    # reference does not establish its internal parts or service behavior.
    rear_module = cube("Cycler rear raised enclosure", (0, 1.58, 3.73), (2.65, .28, 1.22), REAR_METAL, head, .10)
    rear_module["decorative"] = True
    cube("Cycler rear label strip", (0, 1.435, 2.99), (3.08, .012, .35), GRAY, head, .015)
    for x, width in ((-1.12, .68), (-.34, .68), (.68, 1.22)):
        cube("Cycler rear unreadable label", (x, 1.445, 2.99), (width, .008, .26), PANEL, head, .006)
    for x in (-1.55, 1.55):
        for z in (2.87, 4.03, 5.33):
            cylinder("Cycler rear panel screw", (x, 1.438, z), .038, .018, BLACK, head, rotation=(math.pi / 2, 0, 0), vertices=20)
    cube("Rear lower port panel", (0, 1.47, -1.00), (3.55, .08, .55), BLACK, base, .04)
    for x, col in ((-1.25, WHITE), (-.60, BLACK), (.65, BLUE), (1.32, BLACK)):
        cylinder("Rear cable port", (x, 1.56, -1.02), .13, .16, col, base, rotation=(math.pi / 2, 0, 0), vertices=32, bevel=.02)
    cube("Rear central pole socket", (0, 1.55, -1.42), (.42, .28, .34), BLACK, base, .08)

    # Tubing and cables follow the major paths visible in the photos.
    curve("Blue rear fluid tube", [(1.18, 1.60, -1.05), (1.75, 1.85, -1.50), (2.25, 1.70, -2.25), (2.45, .80, -2.65)], .065, BLUE, tubing)
    curve("Black rear hose", [(-1.1, 1.62, -1.04), (-1.55, 1.88, -.55), (-2.15, 1.70, -1.30), (-2.40, .90, -2.15)], .075, BLACK_RUBBER, tubing)
    curve("White rear cable", [(-1.75, 1.62, -.95), (-1.72, 1.95, -1.35), (-1.35, 1.90, -2.25), (-.90, 1.30, -2.55)], .045, WHITE, tubing)
    curve("Front left blue tube", [(-2.45, -.65, 1.00), (-2.75, -1.0, .35), (-2.80, -1.45, -.25), (-2.30, -1.85, -1.35)], .055, BLUE, tubing)
    # A separate white canister and its mounting block are visible on the
    # right side of the rear view in 20261020_131259 and 20261020_131328.
    # This depicts the photographed external assembly, not working plumbing;
    # dimensions, connections and the small unlabelled fittings are estimates.
    cube("Rear canister mounting block", (-1.23, 1.93, -.38), (1.48, .22, .34), BLACK_RUBBER, tubing, .045)
    cylinder("Rear white canister body", (-1.42, 2.06, -1.35), .24, 1.65, WHITE, tubing, vertices=40, bevel=.09)
    cylinder("Rear canister top collar", (-1.42, 2.06, -.49), .26, .18, CREAM_HI, tubing, vertices=32, bevel=.025)
    cylinder("Rear canister bottom cap", (-1.42, 2.06, -2.19), .22, .12, CREAM, tubing, vertices=32, bevel=.04)
    for x in (-1.75, -.72):
        cylinder("Rear mounting screw", (x, 2.06, -.38), .034, .025, METAL, tubing, rotation=(math.pi / 2, 0, 0), vertices=16)
    curve("Rear canister blue loop", [(-1.95, 2.05, -.42), (-2.18, 2.16, -.70), (-2.12, 2.23, -1.36), (-1.87, 2.23, -1.50), (-1.55, 2.10, -1.10), (-1.42, 2.06, -.43)], .045, BLUE, tubing)
    cylinder("Rear blue tube connector", (-2.08, 2.20, -1.08), .078, .20, WHITE, tubing, vertices=24, bevel=.015)
    pole_y = 1.81
    cylinder("IV pole rear section", (0, pole_y, 3.95), .065, 3.85, METAL, tubing)
    for z in (6.45, 7.10):
        cylinder("IV pole", (0, pole_y, z), .055, 1.0, METAL, tubing)
    cylinder("IV pole lower", (0, pole_y, 6.0), .065, 1.5, METAL, tubing)
    # Four looped metal hooks around a dark central collar, as visible in
    # the supplied 20261020_130938 image. Dimensions are visual estimates.
    cylinder("IV hanger hub", (0, pole_y, 7.57), .105, .31, BLACK_RUBBER, tubing, vertices=32, bevel=.018)
    for name, dx, dy in (("left", -1, 0), ("right", 1, 0), ("front", 0, -1), ("back", 0, 1)):
        points = [(dx * distance, pole_y + dy * distance, z) for distance, z in
                  ((.06, 7.68), (.69, 7.68), (.82, 7.57), (.81, 7.38), (.69, 7.30), (.57, 7.38), (.57, 7.57))]
        curve("IV hanger " + name, points, .026, METAL, tubing)


    # Comparison-only proportion study: keep the top of the cabinet and its
    # control unit fixed, extend the cabinet downward, and widen the tub around
    # its own center. All values are visual estimates, not measurements.
    cabinet_top = .82
    lower_scale = bpy.data.objects.new("Cabinet proportion study", None)
    base.objects.link(lower_scale)
    lower_scale.location.z = cabinet_top
    prefixes = ("Cabinet left wall", "Cabinet right wall", "Cabinet rear wall",
                "Cabinet floor", "Cabinet top", "Lower cabinet door hinge",
                "PureFlow tub outward orientation", "Lower left connector strip",
                "Lower connector detail", "Rear gray service cover",
                "Rear lower port panel", "Rear cable port", "Rear central pole socket")
    bpy.context.view_layer.update()
    for obj in list(base.objects):
        if obj is lower_scale or obj.parent is not None or not obj.name.startswith(prefixes):
            continue
        world = obj.matrix_world.copy()
        obj.parent = lower_scale
        obj.matrix_world = world
    lower_scale.scale.z = 1.5
    # Keep the pull-out axis directed toward the user while widening the tub
    # around its approximate center, without enlarging the controller panel.
    tub_orientation.scale.y = 1.4
    tub_orientation.location.x -= .62 * .4
    for obj in base.objects:
        if obj.name.startswith(("Caster wheel", "Caster fork", "Front caster hub")):
            obj.location.z = cabinet_top + (obj.location.z - cabinet_top) * 1.5
    bpy.context.view_layer.update()

    root["source"] = "20 uploaded photos under Downloads/Photos-1-001"
    root["source_photo_set_count"] = len(SOURCE_PHOTO_SET)
    root["source_photo_set"] = ";".join(os.path.relpath(path, REPO_ROOT).replace("\\", "/") for path in SOURCE_PHOTO_SET)
    root["device"] = "NxStage System One training/demonstration machine"
    root["scale_status"] = "relative photo-derived proportions; no measured scale reference"
    root["fidelity_status"] = "visual reconstruction; hidden geometry and exact dimensions remain unverified"
    root["interaction_model"] = "front control press targets, an estimated sliding cycler door, and an estimated left-hinged lower cabinet door"
    root["interaction_targets"] = "NX-C01-ADD-FLUID, NX-C01-VOLUME-TOGGLE, NX-C01-TREATMENT, NX-C01-STOP, NX-C01-MUTE, NX-C01-ROW1-DOWN/UP, NX-C01-ROW2-DOWN/UP, NX-C01-ROW3-DOWN/UP, NX-C02-CABINET-DOOR, PF-C01-UP, PF-C01-DOWN, PF-C01-GO, PF-C01-STOP, PF-C02-TUB"
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
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUTPUT_ROOT, "blender", "nxstage_system_one_interaction_review.blend"))
    bpy.ops.object.select_all(action='DESELECT')
    device_objects = list(device.all_objects)
    ensure_uvs(device_objects)
    for obj in device_objects:
        obj.select_set(True)
    if device_objects:
        bpy.context.view_layer.objects.active = device_objects[0]
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUTPUT_ROOT, "fixtures", ASSET_FOLDER, "nxstage-system-one.glb"), export_format='GLB', export_apply=True, export_extras=True, export_vertex_color='ACTIVE', export_all_vertex_colors=False, use_selection=True)
    if os.environ.get("NXSTAGE_SKIP_RENDER") != "1":
        bpy.ops.render.render(write_still=True)


if __name__ == '__main__':
    main()
