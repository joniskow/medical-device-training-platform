import json
from pathlib import Path
import struct
import tempfile
import unittest

from PIL import Image
from package_candidate import package_candidate

MODEL = Path(__file__).resolve().parents[2] / "fixtures/aurora-training/aurora-training.glb"


def rewrite(raw, update):
    size = struct.unpack_from("<I", raw, 12)[0]
    doc = json.loads(raw[20:20+size])
    update(doc)
    encoded = json.dumps(doc).encode()
    encoded += b" "*((-len(encoded)) % 4)
    binary = raw[28+size:]
    return struct.pack("<4sII", b"glTF", 2, 28+len(encoded)+len(binary))+struct.pack("<II", len(encoded), 0x4E4F534A)+encoded+struct.pack("<II", len(binary), 0x004E4942)+binary


class CandidateChecks(unittest.TestCase):
    def test_geometry_and_local_texture_embedding(self):
        with tempfile.TemporaryDirectory(prefix="reconstruction-test-") as directory:
            root = Path(directory)
            Image.new("RGB", (8, 4), "blue").save(root / "texture.jpg")
            source = root / "engine.glb"
            source.write_bytes(rewrite(MODEL.read_bytes(), lambda doc: doc.update(images=[{"uri": "texture.jpg"}])))
            result = package_candidate(source, root / "candidate.glb")
            self.assertEqual(result["triangles"], 1228)
            self.assertEqual(result["degenerateTriangles"], 0)
            self.assertEqual(result["textureMemoryBytes"], 8*4*4)
            self.assertFalse(result["scaleVerified"])
            self.assertFalse(result["componentMappingVerified"])
            packed = (root / "candidate.glb").read_bytes()
            doc = json.loads(packed[20:20+struct.unpack_from("<I", packed, 12)[0]])
            self.assertNotIn("uri", doc["images"][0])
            self.assertEqual(doc["images"][0]["mimeType"], "image/jpeg")

    def test_reject_external_resources_and_bad_geometry(self):
        with tempfile.TemporaryDirectory(prefix="reconstruction-test-") as directory:
            root = Path(directory)
            source = root / "engine.glb"
            raw = MODEL.read_bytes()
            source.write_bytes(rewrite(raw, lambda doc: doc.update(buffers=[{"uri": "https://example.invalid/source"}])))
            with self.assertRaisesRegex(ValueError, "BUFFER_INVALID"):
                package_candidate(source, root / "candidate.glb")
            source.write_bytes(rewrite(raw, lambda doc: doc.update(images=[{"uri": str(MODEL)}])))
            with self.assertRaisesRegex(ValueError, "TEXTURE_PATH_INVALID"):
                package_candidate(source, root / "candidate.glb")
            source.write_bytes(rewrite(raw, lambda doc: doc["accessors"][0].update(count=10000000)))
            with self.assertRaisesRegex(ValueError, "ACCESSOR_BOUNDS_INVALID"):
                package_candidate(source, root / "candidate.glb")
            source.write_bytes(raw[:20])
            with self.assertRaisesRegex(ValueError, "HEADER_INVALID"):
                package_candidate(source, root / "candidate.glb")


if __name__ == "__main__":
    unittest.main()
