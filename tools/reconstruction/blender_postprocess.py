"""Headless Blender normalization/export stage for Azure reconstruction jobs.

This stage deliberately does not infer scale, orientation, or component identity.
Those remain review decisions. Blender is used as the server-side GLB import/export
boundary so the artifact delivered to Babylon is self-contained and Blender-backed.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import bpy


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    source = args.input.resolve(strict=True)
    destination = args.output.resolve()
    if source.suffix.lower() != ".glb" or destination.suffix.lower() != ".glb":
        raise ValueError("BLENDER_GLB_PATH_INVALID")
    if source == destination:
        raise ValueError("BLENDER_INPUT_OUTPUT_MUST_DIFFER")
    if source.stat().st_size < 28 or source.stat().st_size > 64 * 1024 * 1024:
        raise ValueError("BLENDER_INPUT_SIZE_INVALID")
    destination.parent.mkdir(parents=True, exist_ok=True)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(source))
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    if not meshes or not any(len(obj.data.vertices) > 0 for obj in meshes):
        raise ValueError("BLENDER_IMPORTED_MESH_MISSING")

    for obj in meshes:
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)

    bpy.ops.export_scene.gltf(filepath=str(destination), export_format="GLB", export_apply=True)
    if not destination.is_file() or destination.stat().st_size < 28 or destination.stat().st_size > 64 * 1024 * 1024:
        raise ValueError("BLENDER_OUTPUT_INVALID")
    print(json.dumps({
        "stage": "blender",
        "version": bpy.app.version_string,
        "inputSha256": sha256(source),
        "outputSha256": sha256(destination),
        "meshObjects": len(meshes),
        "outputBytes": destination.stat().st_size,
    }))


if __name__ == "__main__":
    main()
