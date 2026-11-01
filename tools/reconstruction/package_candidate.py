"""Embed local engine textures and measure a candidate; never infer component identity or metric scale."""
import hashlib
import json
from pathlib import Path
import struct
from collections import Counter
from io import BytesIO

import numpy as np
from PIL import Image


def package_candidate(source: Path, destination: Path):
    raw = source.read_bytes()
    if len(raw) < 28 or raw[:4] != b"glTF" or struct.unpack_from("<II", raw, 4) != (2, len(raw)):
        raise ValueError("CANDIDATE_GLB_HEADER_INVALID")
    json_size, kind = struct.unpack_from("<II", raw, 12)
    if kind != 0x4E4F534A:
        raise ValueError("CANDIDATE_GLB_JSON_INVALID")
    doc = json.loads(raw[20:20+json_size])
    bin_offset = 20+json_size
    size, kind = struct.unpack_from("<II", raw, bin_offset)
    if kind != 0x004E4942 or bin_offset+8+size != len(raw) or len(doc.get("buffers", [])) != 1 or doc["buffers"][0].get("uri"):
        raise ValueError("CANDIDATE_BUFFER_INVALID")
    binary = bytearray(raw[bin_offset+8:])
    texture_memory = 0
    for index,image in enumerate(doc.get("images", [])):
        image["name"] = f"reconstructed-texture-{index}"
        if "uri" in image:
            path = (source.parent / image["uri"]).resolve(strict=True)
            if not path.is_relative_to(source.parent.resolve()) or path.stat().st_size > 16*1024*1024:
                raise ValueError("CANDIDATE_TEXTURE_PATH_INVALID")
            data = path.read_bytes()
            while len(binary) % 4:
                binary.append(0)
            view = len(doc["bufferViews"])
            doc["bufferViews"].append({"buffer": 0, "byteOffset": len(binary), "byteLength": len(data)})
            with Image.open(BytesIO(data)) as decoded:
                image["mimeType"] = Image.MIME[decoded.format]
            image.pop("uri")
            image["bufferView"] = view
            binary.extend(data)
        view = doc["bufferViews"][image["bufferView"]]
        with Image.open(BytesIO(binary[view.get("byteOffset", 0):view.get("byteOffset", 0)+view["byteLength"]])) as decoded:
            if max(decoded.size) > 4096:
                raise ValueError("CANDIDATE_TEXTURE_DIMENSION_LIMIT")
            texture_memory += decoded.width*decoded.height*4

    def accessor(index):
        a = doc["accessors"][index]
        view = doc["bufferViews"][a["bufferView"]]
        types = {5121: "u1", 5123: "<u2", 5125: "<u4", 5126: "<f4"}
        dtype = np.dtype(types[a["componentType"]])
        dimension = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}[a["type"]]
        offset = view.get("byteOffset", 0)+a.get("byteOffset", 0)
        stride = view.get("byteStride", dtype.itemsize*dimension)
        if a["count"] < 1 or offset+(a["count"]-1)*stride+dimension*dtype.itemsize > view.get("byteOffset", 0)+view["byteLength"]:
            raise ValueError("CANDIDATE_ACCESSOR_BOUNDS_INVALID")
        return np.ndarray((a["count"], dimension), dtype=dtype, buffer=binary, offset=offset, strides=(stride, dtype.itemsize)).copy()

    triangles, vertices, degenerate = 0, 0, 0
    bounds_min = np.array([np.inf]*3)
    bounds_max = -bounds_min
    edges = Counter()
    for mesh in doc.get("meshes", []):
        for primitive in mesh["primitives"]:
            if primitive.get("mode", 4) != 4:
                raise ValueError("CANDIDATE_PRIMITIVE_UNSUPPORTED")
            positions = accessor(primitive["attributes"]["POSITION"])
            if not np.isfinite(positions).all():
                raise ValueError("CANDIDATE_GEOMETRY_NONFINITE")
            indices = accessor(primitive["indices"]).reshape(-1)
            if len(indices) % 3 or max(indices) >= len(positions):
                raise ValueError("CANDIDATE_INDICES_INVALID")
            faces = indices.reshape((-1, 3))
            face_positions = positions[faces]
            areas = np.linalg.norm(np.cross(face_positions[:, 1]-face_positions[:, 0], face_positions[:, 2]-face_positions[:, 0]), axis=1)
            degenerate += int(np.count_nonzero(areas <= 1e-15))
            triangles += len(faces)
            vertices += len(positions)
            bounds_min = np.minimum(bounds_min, positions.min(axis=0))
            bounds_max = np.maximum(bounds_max, positions.max(axis=0))
            # Weld by position for edge accounting across texture seams.
            keys = [tuple(float(value) for value in row) for row in positions.round(6)]
            for a, b, c in faces:
                for x, y in [(a, b), (b, c), (c, a)]:
                    edges[tuple(sorted((keys[x], keys[y])))] += 1
    if triangles < 1 or degenerate or triangles > 1000000:
        raise ValueError("CANDIDATE_GEOMETRY_LIMIT_OR_DEGENERATE")
    transforms_present = any("matrix" in node or "rotation" in node or "scale" in node or "translation" in node for node in doc.get("nodes", []))
    doc.setdefault("extras", {}).update({"provenance": "image-reconstruction-candidate", "scaleVerified": False, "componentMappingVerified": False, "reviewRequired": True})
    while len(binary) % 4:
        binary.append(0)
    doc["buffers"][0]["byteLength"] = len(binary)
    encoded = json.dumps(doc, separators=(",", ":"), allow_nan=False).encode()
    encoded += b" "*((-len(encoded)) % 4)
    result = struct.pack("<4sII", b"glTF", 2, 28+len(encoded)+len(binary))+struct.pack("<II", len(encoded), 0x4E4F534A)+encoded+struct.pack("<II", len(binary), 0x004E4942)+binary
    if len(result) > 64*1024*1024:
        raise ValueError("CANDIDATE_SIZE_LIMIT")
    destination.write_bytes(result)
    return {"file": destination.name, "sha256": hashlib.sha256(result).hexdigest(), "bytes": len(result),
        "triangles": triangles, "vertices": vertices, "degenerateTriangles": degenerate,
        "boundaryEdges": sum(count == 1 for count in edges.values()), "nonManifoldEdges": sum(count > 2 for count in edges.values()),
        "boundsCoordinateSpace": "mesh-local" if transforms_present else "scene", "boundsMin": bounds_min.tolist(), "boundsMax": bounds_max.tolist(),
        "dimensionsUnscaled": (bounds_max-bounds_min).tolist(), "textureCount": len(doc.get("images", [])), "textureMemoryBytes": texture_memory,
        "externalResources": False, "componentMappingVerified": False, "scaleVerified": False}


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("run", type=Path)
    args = parser.parse_args()
    report_path = args.run / "quality.json"
    report = json.loads(report_path.read_text(encoding="utf-8"))
    if report["status"] != "REVIEW_REQUIRED":
        raise ValueError("Only a completed engine run can be packaged")
    report["candidate"] = package_candidate(args.run / "candidate.glb", args.run / "candidate-private.glb")
    report_path.write_text(json.dumps(report, indent=2, allow_nan=False)+"\n", encoding="utf-8")
    print(json.dumps(report["candidate"]))
