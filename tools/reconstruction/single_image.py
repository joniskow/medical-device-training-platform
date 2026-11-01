"""Single-photo *hypothesis*, never a dimensional-accuracy acceptance.

Uses the official TripoSR inference/extraction APIs with vertex colors. Source:
https://github.com/VAST-AI-Research/TripoSR/blob/107cefdc244c39106fa830359024f6a2f1c78871/run.py
"""
import argparse
import json
import importlib.metadata
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time

import numpy as np
from PIL import Image, ImageOps

from package_candidate import package_candidate
from single_image_assets import CODE_REVISION, sha256, verify_assets


def save(path, value):
    path.write_text(json.dumps(value, indent=2, allow_nan=False) + "\n", encoding="utf-8")


def prepare_image(source, destination, background):
    if source.stat().st_size > 25 * 1024 * 1024:
        raise ValueError("SOURCE_SIZE_LIMIT")
    with Image.open(source) as opened:
        if opened.format not in {"PNG", "JPEG", "WEBP"} or getattr(opened, "n_frames", 1) != 1:
            raise ValueError("SOURCE_FORMAT_INVALID")
        if min(opened.size) < 256 or max(opened.size) > 4096:
            raise ValueError("SOURCE_DIMENSIONS_INVALID")
        image = ImageOps.exif_transpose(opened).convert("RGBA")
    # Upstream remove_background preserves an existing alpha mask. Do not run a
    # second segmentation over a source whose fine outline was already supplied.
    automatic_mask = background == "automatic" and image.getchannel("A").getextrema()[0] == 255
    if automatic_mask:
        import rembg
        image = rembg.remove(image, session=rembg.new_session("u2net", providers=["CPUExecutionProvider"]))
    alpha = np.asarray(image.getchannel("A"))
    if alpha.min() == 255 or alpha.max() < 128:
        raise ValueError("FOREGROUND_MASK_REQUIRED_OR_EMPTY")
    ys, xs = np.nonzero(alpha >= 128)
    # A clipped part cannot be recovered by silently extending its outline.
    if xs.min() == 0 or ys.min() == 0 or xs.max() == image.width - 1 or ys.max() == image.height - 1:
        raise ValueError("FOREGROUND_TOUCHES_IMAGE_EDGE")
    crop_box = [int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1]
    crop = image.crop(crop_box)
    if min(crop.size) < 64:
        raise ValueError("FOREGROUND_TOO_SMALL")
    image.save(destination.parent / "foreground.png")
    size = int(np.ceil(max(crop.size) / .85))
    square = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    square.paste(crop, ((size - crop.width) // 2, (size - crop.height) // 2))
    # Upstream composites masked foreground on 50% gray and consumes 512 pixels.
    rgba = np.asarray(square).astype(np.float32) / 255
    rgb = rgba[:, :, :3] * rgba[:, :, 3:4] + .5 * (1 - rgba[:, :, 3:4])
    Image.fromarray(np.round(rgb * 255).astype(np.uint8)).save(destination)
    return {"sourceWidth": image.width, "sourceHeight": image.height, "foregroundBox": crop_box,
        "mask": "automatic-u2net-review-required" if automatic_mask else "provided-alpha-review-required",
        "foregroundRatio": .85, "conditioningResolution": 512, "normalizedSha256": sha256(destination),
        "foregroundSha256": sha256(destination.parent / "foreground.png")}


def infer(args):
    import torch
    from tsr.system import TSR
    torch.set_num_threads(4)
    torch.manual_seed(17)
    model = TSR.from_pretrained(str(args.assets / "model"), config_name="config.yaml", weight_name="model.ckpt")
    model.eval()
    model.renderer.set_chunk_size(8192)
    with torch.inference_mode():
        scene = model([Image.open(args.output / "input.png").convert("RGB")], device="cpu")
        mesh = model.extract_mesh(scene, has_vertex_color=True, resolution=args.resolution)[0]
    # Trimesh's GLB exporter otherwise adds an identity matrix rejected by our
    # deliberately untransformed single-surface preparation format. Export its
    # single geometry without that redundant identity, never drop a real transform.
    from trimesh.exchange.gltf import export_glb
    def finish(document):
        for node in document.get("nodes", []):
            if "matrix" in node:
                if not np.array_equal(np.asarray(node["matrix"]).reshape(4, 4), np.eye(4)):
                    raise ValueError("UNEXPECTED_ENGINE_TRANSFORM")
                del node["matrix"]
        if not document.get("materials"):
            document["materials"] = [{"name": "Generated vertex colors", "pbrMetallicRoughness": {
                "baseColorFactor": [1, 1, 1, 1], "metallicFactor": 0, "roughnessFactor": 1}}]
            for geometry in document["meshes"]:
                for primitive in geometry["primitives"]:
                    primitive["material"] = 0
        document.setdefault("extras", {}).update({"reconstructionMethod": "single-image-generative-hypothesis",
            "hiddenGeometryVerified": False, "dimensionsVerified": False, "approvedForScoredUse": False})
    (args.output / "candidate.glb").write_bytes(export_glb(mesh.scene(), include_normals=True, tree_postprocessor=finish))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--image", type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--assets", required=True, type=Path)
    parser.add_argument("--background", choices=["automatic", "provided-alpha"], default="automatic")
    parser.add_argument("--resolution", type=int, choices=[128, 256], default=256)
    parser.add_argument("--internal-inference", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args()
    args.output = args.output.resolve()
    args.assets = args.assets.resolve(strict=True)
    os.environ.update(HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1", HF_HUB_DISABLE_TELEMETRY="1",
        HUGGINGFACE_HUB_CACHE=str(args.assets / "hub"), U2NET_HOME=str(args.assets / "u2net"),
        TRANSFORMERS_CACHE=str(Path(tempfile.gettempdir()) / "mdt-transformers"))
    if args.internal_inference:
        infer(args)
        return
    if not args.image:
        parser.error("--image is required")
    source = args.image.resolve(strict=True)
    if args.output.exists():
        raise ValueError("OUTPUT_MUST_BE_NEW")
    assets = verify_assets(args.assets)
    args.output.mkdir(parents=True)
    report = {"schemaVersion": "reconstruction-quality.v1", "status": "PROCESSING",
        "inputImages": [{"name": source.name, "sha256": sha256(source), "bytes": source.stat().st_size}],
        "pipelineSha256": sha256(Path(__file__)), "method": "single-image-generative-hypothesis",
        "adapter": {"engine": "TripoSR", "codeRevision": CODE_REVISION, "device": "cpu", "assets": assets,
            "marchingCubesCodeRevision": "bc36b08c62c5931e1dfc666581b3a8589278647f",
            "versions": {name: importlib.metadata.version(name) for name in ["torch", "transformers", "trimesh", "rembg", "onnxruntime", "numpy", "Pillow"]}},
        "stages": [], "warnings": ["SINGLE_IMAGE_INFERRED_GEOMETRY", "HIDDEN_SURFACES_UNVERIFIED", "SCALE_UNVERIFIED",
            "ORIENTATION_UNVERIFIED", "COMPONENT_MAPPING_REQUIRED", "SURFACE_COMPLETENESS_UNMEASURED",
            "TEXTURE_VISUAL_REVIEW_REQUIRED", "FOREGROUND_MASK_REVIEW_REQUIRED", "DETAILS_AND_LABELS_UNVERIFIED"],
        "accuracy": {"metricScaleVerified": False, "hiddenGeometryVerified": False,
            "surfaceErrorMeasured": False, "deviceDetailsVerified": False, "generatedViewsAreAdditionalEvidence": False},
        "settings": {"marchingCubesResolution": args.resolution, "densityThreshold": 25, "seed": 17,
            "colorMode": "vertex-colors", "meshSimplification": False}, "approvedForScoredUse": False}
    save(args.output / "quality.json", report)
    started = time.monotonic()
    try:
        print("Extracting foreground; inspect foreground.png before trusting the surface.", flush=True)
        report["preprocessing"] = prepare_image(source, args.output / "input.png", args.background)
        save(args.output / "quality.json", report)
        command = [sys.executable, str(Path(__file__).resolve()), "--internal-inference", "--assets", str(args.assets),
            "--output", str(args.output), "--resolution", str(args.resolution)]
        with (args.output / "inference.log").open("wb") as log:
            print("Running offline TripoSR inference and surface extraction.", flush=True)
            subprocess.run(command, stdout=log, stderr=subprocess.STDOUT, check=True, timeout=900)
        report["candidate"] = package_candidate(args.output / "candidate.glb", args.output / "candidate-private.glb")
        if report["candidate"]["boundaryEdges"]:
            report["warnings"].append("OPEN_SURFACE_BOUNDARIES")
        if report["candidate"]["nonManifoldEdges"]:
            report["warnings"].append("NON_MANIFOLD_EDGES")
        report["status"] = "REVIEW_REQUIRED"
    except Exception as error:
        report["status"] = "REJECTED"
        report["failure"] = {"type": type(error).__name__, "message": str(error)[:1000]}
        raise
    finally:
        report["stages"].append({"stage": "single-image-inference", "durationSeconds": round(time.monotonic() - started, 3)})
        save(args.output / "quality.json", report)
    print(json.dumps({"status": report["status"], "candidate": report["candidate"]}))


if __name__ == "__main__":
    main()
