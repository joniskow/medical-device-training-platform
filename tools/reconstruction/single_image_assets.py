"""Download public engine assets only. Inference itself runs offline with these assets read-only."""
import argparse
import hashlib
import json
import os
from pathlib import Path

CODE_REVISION = "107cefdc244c39106fa830359024f6a2f1c78871"
WEIGHTS_REVISION = "5b521936b01fbe1890f6f9baed0254ab6351c04a"
WEIGHTS_SHA256 = "429e2c6b22a0923967459de24d67f05962b235f79cde6b032aa7ed2ffcd970ee"
DINO_REVISION = "f205d5d8e640a89a2b8ef0369670dfc37cc07fc2"
EXPECTED_FILES = {
    "model/model.ckpt": WEIGHTS_SHA256,
    "model/config.yaml": "74ca708ce086bf68e97709ea6b3d91f14717921c04691e84043f0eb8fcc68e62",
    f"hub/models--facebook--dino-vitb16/snapshots/{DINO_REVISION}/config.json": "b87c0270b97db085fd82cf114a761fd0f62ae7914fbd407c752a2260646b689c",
    "u2net/u2net.onnx": "8d10d2f3bb75ae3b6d527c77944fc5e7dcd94b29809d47a739a7a728a912b491",
}


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def verify_assets(root):
    report = json.loads((root / "assets.json").read_text())
    if report.get("codeRevision") != CODE_REVISION or report.get("weightsRevision") != WEIGHTS_REVISION:
        raise ValueError("ENGINE_ASSET_REVISION_MISMATCH")
    if len(report["files"]) != len(EXPECTED_FILES) or {entry["path"]: entry["sha256"] for entry in report["files"]} != EXPECTED_FILES:
        raise ValueError("ENGINE_ASSET_SET_MISMATCH")
    if (root / "hub/models--facebook--dino-vitb16/refs/main").read_text().strip() != DINO_REVISION:
        raise ValueError("DINO_CONFIG_REVISION_CHANGED")
    for entry in report["files"]:
        path = (root / entry["path"]).resolve(strict=True)
        if not path.is_relative_to(root.resolve()) or sha256(path) != entry["sha256"]:
            raise ValueError("ENGINE_ASSET_HASH_MISMATCH")
    return report


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--assets", required=True, type=Path)
    args = parser.parse_args()
    root = args.assets.resolve()
    root.mkdir(parents=True, exist_ok=True)
    # Official download API, pinned model revision; no user media is sent.
    # https://huggingface.co/docs/huggingface_hub/v0.17.3/guides/download
    from huggingface_hub import hf_hub_download
    files = []
    for name in ["config.yaml", "model.ckpt"]:
        file = Path(hf_hub_download("stabilityai/TripoSR", name, revision=WEIGHTS_REVISION,
            local_dir=root / "model", local_dir_use_symlinks=False, cache_dir=root / "hub"))
        files.append(file)
    if sha256(root / "model/model.ckpt") != WEIGHTS_SHA256:
        raise ValueError("ENGINE_WEIGHTS_HASH_MISMATCH")
    # Upstream tokenizer requests main. Populate its offline cache and require the
    # exact reviewed revision instead of accepting a changed configuration.
    config = Path(hf_hub_download("facebook/dino-vitb16", "config.json", revision="main", cache_dir=root / "hub"))
    if config.parent.name != DINO_REVISION:
        raise ValueError("DINO_CONFIG_REVISION_CHANGED")
    files.append(config)
    os.environ["U2NET_HOME"] = str(root / "u2net")
    import rembg
    rembg.new_session("u2net", providers=["CPUExecutionProvider"])
    files.extend((root / "u2net").glob("*.onnx"))
    report = {"codeRevision": CODE_REVISION, "weightsRevision": WEIGHTS_REVISION,
        "weightsSha256": WEIGHTS_SHA256, "dinoRevision": DINO_REVISION,
        "files": [{"path": str(path.relative_to(root)), "sha256": sha256(path), "bytes": path.stat().st_size} for path in files]}
    (root / "assets.json").write_text(json.dumps(report, indent=2) + "\n")
    verify_assets(root)
    print("Pinned engine, tokenizer and background-removal assets verified.")


if __name__ == "__main__":
    main()
