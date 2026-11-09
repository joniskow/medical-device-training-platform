"""Fail closed before a worker advertises the separately packaged offline engine."""
import argparse
import hashlib
import importlib
import importlib.metadata
import json
from pathlib import Path
from single_image_assets import CODE_REVISION, verify_assets

VERSIONS = {"torch": "2.6.0+cpu", "numpy": "1.26.4", "Pillow": "10.1.0",
            "transformers": "4.35.0", "trimesh": "4.0.5", "rembg": "2.0.57", "onnxruntime": "1.19.2"}
MC_REVISION = "bc36b08c62c5931e1dfc666581b3a8589278647f"


def code_files(root):
    root = root.resolve(strict=True)
    files = {}
    for file in sorted((root / "tsr").rglob("*.py")):
        if file.is_symlink() or not file.resolve().is_relative_to(root):
            raise ValueError("SINGLE_IMAGE_CODE_PATH_INVALID")
        files[file.relative_to(root).as_posix()] = hashlib.sha256(file.read_bytes()).hexdigest()
    if not files or "tsr/system.py" not in files:
        raise ValueError("SINGLE_IMAGE_CODE_MISSING")
    return files


def verify_manifest(manifest, code):
    expected = {"schemaVersion": "single-image-runtime.v1", "codeRevision": CODE_REVISION,
                "marchingCubesRevision": MC_REVISION, "versions": VERSIONS, "codeFiles": code_files(code)}
    if manifest != expected:
        raise ValueError("SINGLE_IMAGE_RUNTIME_MANIFEST_MISMATCH")
    return expected


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--assets", required=True, type=Path)
    parser.add_argument("--code", required=True, type=Path)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--write-manifest", action="store_true", help="Build stage only; runtime never sets this flag")
    args = parser.parse_args()
    # Imports prove the extension and native libraries load in the target image, not only that metadata exists.
    for module in ["torch", "tsr.system", "torchmcubes", "rembg", "onnxruntime"]:
        importlib.import_module(module)
    import tsr.system
    if not Path(tsr.system.__file__).resolve().is_relative_to(args.code.resolve(strict=True)):
        raise ValueError("SINGLE_IMAGE_CODE_IMPORT_MISMATCH")
    for package, version in VERSIONS.items():
        if importlib.metadata.version(package) != version:
            raise ValueError("SINGLE_IMAGE_DEPENDENCY_VERSION_MISMATCH:" + package)
    verify_assets(args.assets)
    if args.write_manifest:
        manifest = {"schemaVersion": "single-image-runtime.v1", "codeRevision": CODE_REVISION,
                    "marchingCubesRevision": MC_REVISION, "versions": VERSIONS, "codeFiles": code_files(args.code)}
        args.manifest.write_text(json.dumps(manifest, sort_keys=True, indent=2) + "\n")
    verify_manifest(json.loads(args.manifest.read_text()), args.code)
    print("Pinned single-image runtime, native extensions, code and offline model assets verified.")


if __name__ == "__main__":
    main()
