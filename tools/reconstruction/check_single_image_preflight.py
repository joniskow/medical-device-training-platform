"""Unit-check manifest tamper detection without installing or claiming the inference engine."""
from copy import deepcopy
import json
from pathlib import Path
import tempfile
import unittest
from single_image_assets import CODE_REVISION
from single_image_preflight import MC_REVISION, VERSIONS, code_files, verify_manifest


class RuntimeManifestChecks(unittest.TestCase):
    def test_manifest_binds_every_source_and_pinned_version(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "tsr").mkdir()
            (root / "tsr/system.py").write_text("# controlled test source")
            manifest = {"schemaVersion": "single-image-runtime.v1", "codeRevision": CODE_REVISION,
                        "marchingCubesRevision": MC_REVISION, "versions": dict(VERSIONS), "codeFiles": code_files(root)}
            self.assertEqual(verify_manifest(json.loads(json.dumps(manifest)), root), manifest)
            for key, value in [("codeRevision", "changed"), ("marchingCubesRevision", "changed"), ("schemaVersion", "v0")]:
                bad = deepcopy(manifest)
                bad[key] = value
                with self.assertRaisesRegex(ValueError, "MANIFEST_MISMATCH"):
                    verify_manifest(bad, root)
            bad = deepcopy(manifest)
            bad["versions"]["numpy"] = "2.2.6"
            with self.assertRaisesRegex(ValueError, "MANIFEST_MISMATCH"):
                verify_manifest(bad, root)
            (root / "tsr/system.py").write_text("# altered source")
            with self.assertRaisesRegex(ValueError, "MANIFEST_MISMATCH"):
                verify_manifest(manifest, root)
            (root / "tsr/system.py").unlink()
            with self.assertRaisesRegex(ValueError, "CODE_MISSING"):
                verify_manifest(manifest, root)


if __name__ == "__main__":
    unittest.main()
