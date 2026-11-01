"""Local CPU photogrammetry benchmark. Application job/promotion integration is separate."""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import subprocess
import sys
import time

from PIL import Image, ImageOps
import pycolmap
from package_candidate import package_candidate

SFM_SETTINGS={'featureMaximumImageDimension':1536,'maximumFeatures':6000,'finalBundleLoss':'CAUCHY','finalBundleLossScale':1.0,'finalBundleMaxIterations':150,'finalBundleGradientTolerance':1e-8}


def save(path, value):
    path.write_text(json.dumps(value, indent=2, allow_nan=False) + "\n", encoding="utf-8")


def sfm(images: Path, output: Path,calibration=None,detail='standard'):
    database = output / "database.db"
    sparse = output / "sparse"
    sparse.mkdir()
    pycolmap.set_random_seed(17)
    reader={"camera_model":"SIMPLE_RADIAL"}
    mapping={"num_threads": 4, "max_runtime_seconds": 600, "random_seed": 17, "max_num_models": 3}
    if calibration:
        reader={"camera_model":"PINHOLE","camera_params":','.join(str(calibration[key]) for key in ['fx','fy','cx','cy'])}
        mapping.update(ba_refine_focal_length=False,ba_refine_extra_params=False,mapper={"abs_pose_refine_focal_length":False,"abs_pose_refine_extra_params":False})
    pycolmap.extract_features(database, images, camera_mode=pycolmap.CameraMode.SINGLE,
        reader_options=reader,
        extraction_options={"num_threads": 4, "max_image_size": 1536, "sift": {"max_num_features": 6000}}, device=pycolmap.Device.cpu)
    pycolmap.match_exhaustive(database, matching_options={"num_threads": 4}, device=pycolmap.Device.cpu)
    models = pycolmap.incremental_mapping(database, images, sparse,
        options=mapping)
    if not models:
        raise RuntimeError("NO_REGISTERED_RECONSTRUCTION")
    best = max(models.values(), key=lambda model: model.num_reg_images())
    before=best.compute_mean_reprojection_error()
    started=time.monotonic()
    # Refine all observations after incremental mapping. Ground-truth cameras or
    # reference geometry are never supplied to this optimization.
    # https://colmap.github.io/legacy/4.0/pycolmap/pycolmap.html#pycolmap.bundle_adjustment
    adjustment=pycolmap.BundleAdjustmentOptions()
    adjustment.refine_focal_length=not bool(calibration)
    adjustment.refine_extra_params=not bool(calibration)
    adjustment.refine_principal_point=False
    adjustment.ceres.loss_function_type=pycolmap.LossFunctionType.CAUCHY
    adjustment.ceres.loss_function_scale=SFM_SETTINGS['finalBundleLossScale']
    adjustment.ceres.solver_options.max_num_iterations=SFM_SETTINGS['finalBundleMaxIterations']
    adjustment.ceres.solver_options.gradient_tolerance=SFM_SETTINGS['finalBundleGradientTolerance']
    adjustment.ceres.solver_options.max_solver_time_in_seconds=60
    adjustment.ceres.solver_options.num_threads=4
    pycolmap.bundle_adjustment(best,adjustment)
    refinement={'loss':'CAUCHY','lossScalePixels':SFM_SETTINGS['finalBundleLossScale'],'maximumIterations':SFM_SETTINGS['finalBundleMaxIterations'],
        'knownIntrinsicsHeldFixed':bool(calibration),'reprojectionBeforePixels':before,'reprojectionAfterPixels':best.compute_mean_reprojection_error(),'durationSeconds':time.monotonic()-started}
    selected = output / "selected-sparse"
    selected.mkdir()
    best.write(selected)
    best.export_PLY(output / "sparse.ply")
    save(output / "registration.json", {"registeredImages": best.num_reg_images(), "sparsePoints": best.num_points3D(),
        "meanReprojectionErrorPixels": best.compute_mean_reprojection_error(),
        "registeredNames": sorted(image.name for image in best.images.values() if image.has_pose),
        "globalBundleAdjustment":refinement,
        "recoveredCameraCenters": [{"name": image.name, "center": image.projection_center().tolist()} for image in sorted(best.images.values(), key=lambda image: image.name) if image.has_pose]})
    pycolmap.undistort_images(output / "undistorted", selected, images, num_threads=4,
        undistort_options={"max_image_size": 4096 if detail=='high' else 1536})


def stage(command, work: Path, name: str, timeout=600):
    print("Starting " + name, flush=True)
    started = time.monotonic()
    env = {**os.environ, "OMP_NUM_THREADS": "4", "OPENBLAS_NUM_THREADS": "4"}
    with (work / (name + ".log")).open("wb") as log:
        result = subprocess.run([str(arg) for arg in command], cwd=work, env=env, stdout=log, stderr=subprocess.STDOUT,
            timeout=timeout, creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
    if result.returncode:
        raise RuntimeError(name.upper() + "_FAILED: inspect local stage log")
    executable=Path(command[0])
    return {"stage": name, "durationSeconds": round(time.monotonic()-started, 3),
        "executable": executable.name, "executableSha256": hashlib.sha256(executable.read_bytes()).hexdigest()}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--images", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--openmvs-dir", type=Path)
    parser.add_argument("--camera-calibration",type=Path,help="Known pinhole camera intrinsics, not camera poses")
    parser.add_argument("--detail",choices=['standard','high'],default='standard')
    parser.add_argument("--resume", action="store_true", help="Resume an existing run only when original source hashes match")
    parser.add_argument("--rerun-texture", action="store_true", help="With --resume, repeat texturing after a configuration repair")
    parser.add_argument("--internal-sfm", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args()
    calibration=json.loads(args.camera_calibration.read_text()) if args.camera_calibration else None
    if calibration:
        if not all(isinstance(calibration.get(key),(int,float)) and math.isfinite(calibration[key]) for key in ['width','height','fx','fy','cx','cy']) or calibration['fx']<=0 or calibration['fy']<=0 or not 0<=calibration['cx']<=calibration['width'] or not 0<=calibration['cy']<=calibration['height']:
            raise ValueError('CAMERA_CALIBRATION_INVALID')
    if args.internal_sfm:
        sfm(args.images.resolve(), args.output.resolve(),calibration,args.detail)
        return
    output = args.output.resolve()
    if output.exists() and not args.resume:
        raise ValueError("OUTPUT_MUST_BE_NEW: preserve previous run evidence")
    root = args.images.resolve(strict=True)
    paths = sorted(root.iterdir())
    if not 20 <= len(paths) <= 100:
        raise ValueError("CAPTURE_IMAGE_COUNT: expected 20-100 images")
    inputs, total = [], 0
    dimensions=set()
    for path in paths:
        if not path.is_file() or not path.resolve().is_relative_to(root) or path.suffix.lower() not in {".jpg", ".jpeg", ".png", ".webp"}:
            raise ValueError("CAPTURE_FORMAT_UNSUPPORTED")
        size = path.stat().st_size
        total += size
        if size > 25*1024*1024 or total > 1024*1024*1024:
            raise ValueError("CAPTURE_BYTE_LIMIT")
        with Image.open(path) as image:
            if min(image.size) < 1080 or max(image.size) > 4096 or getattr(image, "n_frames", 1) != 1:
                raise ValueError("CAPTURE_DIMENSIONS: expected 1080p+ stills, max 4096 per axis")
            image.verify()
        with Image.open(path) as image:
            dimensions.add(ImageOps.exif_transpose(image).size)
        inputs.append({"name": path.name, "sha256": hashlib.sha256(path.read_bytes()).hexdigest(), "bytes": size})
    if len({item["sha256"] for item in inputs}) < 20:
        raise ValueError("INSUFFICIENT_DISTINCT_VIEWS")
    if len(dimensions)!=1:
        raise ValueError("CAPTURE_DIMENSIONS_MISMATCH: a stable single-camera profile is required")
    if calibration and next(iter(dimensions))!=(calibration['width'],calibration['height']):
        raise ValueError('CAMERA_CALIBRATION_DIMENSIONS_MISMATCH')
    video_source=None
    video_report=root.parent/"video-views.json"
    if video_report.is_file():
        views=json.loads(video_report.read_text(encoding="utf-8"))
        if views.get("status")!="REVIEW_REQUIRED" or [{key:frame[key] for key in ["name","sha256","bytes"]} for frame in views.get("frames",[])]!=inputs:
            raise ValueError("VIDEO_SOURCE_EVIDENCE_MISMATCH")
        video_source={key:views[key] for key in ["sourceSha256","sourceBytes","durationSeconds","width","height","frames"]}
    normalized = output / "images"
    if args.resume:
        report=json.loads((output/"quality.json").read_text(encoding="utf-8"))
        if report.get("schemaVersion")!="reconstruction-quality.v1" or report.get("inputImages")!=inputs or report.get("status") not in {"REJECTED", "REVIEW_REQUIRED"}:
            raise ValueError("RESUME_SOURCE_OR_STATE_MISMATCH")
        if report.get('cameraCalibration',{}).get('sha256')!=(hashlib.sha256(args.camera_calibration.read_bytes()).hexdigest() if args.camera_calibration else None):
            raise ValueError('RESUME_CALIBRATION_MISMATCH')
        expected_geometry={'estimateROI':False,'cropToROI':False,'towerMode':False,'maximumImageDimension':4096 if args.detail=='high' else 1536}
        if report.get('geometrySettings')!=expected_geometry:
            raise ValueError('RESUME_GEOMETRY_PROFILE_CHANGED: create a new run instead of reusing differently cropped/resized depth maps')
        if report.get('sfmSettings')!=SFM_SETTINGS:
            raise ValueError('RESUME_SFM_PROFILE_CHANGED: create a new run with final camera refinement')
        report.setdefault("resumePipelineSha256", []).append(hashlib.sha256(Path(__file__).read_bytes()).hexdigest())
        report.pop("failure", None)
        report["status"]="PROCESSING"
    else:
        output.mkdir(parents=True)
        normalized.mkdir()
        for index, path in enumerate(paths):
            with Image.open(path) as image:
                ImageOps.exif_transpose(image).convert("RGB").save(normalized / f"capture-{index:03}.png")
        report = {"schemaVersion": "reconstruction-quality.v1", "status": "PROCESSING", "inputImages": inputs,
            "pipelineSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
            "adapter": {"sfm": "pycolmap", "sfmVersion": pycolmap.__version__, "dense": "OpenMVS 2.4.0 CPU"},
            "stages": [], "warnings": ["SCALE_UNVERIFIED", "ORIENTATION_UNVERIFIED", "COMPONENT_MAPPING_REQUIRED", "SURFACE_COMPLETENESS_UNMEASURED", "ENGINE_LICENSE_REVIEW_PENDING"],
            "approvedForScoredUse": False}
    finished={entry["stage"] for entry in report["stages"]}
    if args.rerun_texture:
        if not args.resume:
            raise ValueError("RERUN_REQUIRES_RESUME")
        report.setdefault("supersededStages", []).extend(entry for entry in report["stages"] if entry["stage"]=="texture")
        report["stages"]=[entry for entry in report["stages"] if entry["stage"]!="texture"]
        finished.discard("texture")
    report["textureSettings"]={"globalSeamLeveling": False, "localSeamLeveling": False, "maxTextureSize": 2048}
    if args.resume and report.get('detail','standard')!=args.detail:
        raise ValueError('RESUME_DETAIL_MISMATCH')
    report['detail']=args.detail
    report['sfmSettings']=SFM_SETTINGS
    width,height=next(iter(dimensions))
    report['captureProfile']={'width':width,'height':height,'sourceImageCount':len(inputs)}
    report['geometrySettings']={'estimateROI':False,'cropToROI':False,'towerMode':False,'maximumImageDimension':4096 if args.detail=='high' else 1536}
    if calibration:
        report['cameraCalibration']={**calibration,'sha256':hashlib.sha256(args.camera_calibration.read_bytes()).hexdigest()}
    if video_source:
        report["sourceVideo"]=video_source
    if "TEXTURE_VISUAL_REVIEW_REQUIRED" not in report["warnings"]:
        report["warnings"].append("TEXTURE_VISUAL_REVIEW_REQUIRED")
    save(output / "quality.json", report)
    try:
        if "sfm" not in finished:
            command=[sys.executable, Path(__file__).resolve(), "--internal-sfm", "--images", normalized, "--output", output,"--detail",args.detail]
            if args.camera_calibration:
                command.extend(['--camera-calibration',args.camera_calibration.resolve()])
            report["stages"].append(stage(command, output, "sfm", timeout=900))
        registration = json.loads((output / "registration.json").read_text())
        report.update(registration)
        report["registrationFraction"] = registration["registeredImages"] / len(inputs)
        save(output / "quality.json", report)
        if report["registrationFraction"] < .8 or report["sparsePoints"] < 100 or report["meanReprojectionErrorPixels"] > 4:
            raise RuntimeError("CAMERA_REGISTRATION_QUALITY_FAILED")
        if not args.openmvs_dir:
            raise RuntimeError("DENSE_ENGINE_UNAVAILABLE")
        binaries = args.openmvs_dir.resolve(strict=True)
        extension = ".exe" if os.name == "nt" else ""
        def tool(name):
            result = binaries / (name+extension)
            if not result.is_file():
                raise RuntimeError("DENSE_ENGINE_UNAVAILABLE")
            return result
        stages = [
            ("import", [tool("InterfaceCOLMAP"), "-i", output/"undistorted", "-o", output/"scene.mvs", "--max-threads", "4"]),
            ("dense", [tool("DensifyPointCloud"), "-i", output/"scene.mvs", "-o", output/"dense.mvs", "--max-threads", "4", "--resolution-level", "0" if args.detail=='high' else "1", "--min-resolution", "1080" if args.detail=='high' else "640", "--max-resolution", "4096" if args.detail=='high' else "960","--estimate-roi","0","--crop-to-roi","0","--tower-mode","0"]),
            ("mesh", [tool("ReconstructMesh"), "-i", output/"dense.mvs", "-o", output/"mesh.mvs", "--max-threads", "4", "--close-holes", "0"]),
            ("texture", [tool("TextureMesh"), "-i", output/"dense.mvs", "--mesh-file", output/"mesh.ply", "-o", output/"candidate.mvs", "--max-threads", "4", "--export-type", "glb", "--max-texture-size", "2048", "--global-seam-leveling", "0", "--local-seam-leveling", "0"])]
        for name, command in stages:
            if name in finished:
                continue
            report["stages"].append(stage(command, output, name))
            save(output / "quality.json", report)
        glb = output / "candidate.glb"
        if not glb.is_file() or glb.stat().st_size > 64*1024*1024:
            raise RuntimeError("CANDIDATE_GLB_MISSING_OR_TOO_LARGE")
        report["candidate"] = package_candidate(glb, output / "candidate-private.glb")
        for key,warning in [("boundaryEdges","OPEN_SURFACE_BOUNDARIES"),("nonManifoldEdges","NON_MANIFOLD_EDGES")]:
            if report["candidate"][key] and warning not in report["warnings"]:
                report["warnings"].append(warning)
        report["status"] = "REVIEW_REQUIRED"
    except Exception as error:
        report["status"] = "REJECTED"
        report["failure"] = str(error)
        raise
    finally:
        save(output / "quality.json", report)
    print(json.dumps({"status": report["status"], "output": str(output), "registeredImages": report["registeredImages"], "candidate": report["candidate"]}), flush=True)


if __name__ == "__main__":
    main()
