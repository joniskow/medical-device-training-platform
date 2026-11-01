import json
import hashlib
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from PIL import Image

SCRIPT=Path(__file__).with_name("reconstruct.py")


class CaptureChecks(unittest.TestCase):
    def rejected(self, source, output, code, resume=False):
        command=[sys.executable,str(SCRIPT),"--images",str(source),"--output",str(output)]
        if resume:
            command.append("--resume")
        result=subprocess.run(command,capture_output=True,timeout=30)
        self.assertNotEqual(result.returncode,0)
        self.assertIn(code,(result.stderr+result.stdout).decode())

    def test_unsupported_count_and_duplicate_views(self):
        with tempfile.TemporaryDirectory(prefix="capture-check-") as directory:
            root=Path(directory)
            images=root/"images"
            images.mkdir()
            self.rejected(images,root/"run","CAPTURE_IMAGE_COUNT")
            image=Image.new("RGB",(1920,1080),"gray")
            for index in range(20):
                image.save(images/f"view-{index:03}.png")
            self.rejected(images,root/"run","INSUFFICIENT_DISTINCT_VIEWS")
            self.assertFalse((root/"run").exists())

    def test_source_evidence_and_resume_fencing(self):
        with tempfile.TemporaryDirectory(prefix="capture-check-") as directory:
            root=Path(directory)
            images=root/"images"
            images.mkdir()
            for index in range(20):
                image=Image.new("RGB",(1920,1080),(index,80,120))
                image.save(images/f"view-{index:03}.png")
            (root/"video-views.json").write_text(json.dumps({"status":"REVIEW_REQUIRED","frames":[]}),encoding="utf-8")
            self.rejected(images,root/"run","VIDEO_SOURCE_EVIDENCE_MISMATCH")
            (root/"video-views.json").unlink()
            run=root/"run"
            run.mkdir()
            report={"schemaVersion":"reconstruction-quality.v1","status":"REJECTED","inputImages":[]}
            (run/"quality.json").write_text(json.dumps(report),encoding="utf-8")
            self.rejected(images,run,"RESUME_SOURCE_OR_STATE_MISMATCH",resume=True)
            self.assertEqual(json.loads((run/"quality.json").read_text()),report)
            report['inputImages']=[{'name':path.name,'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'bytes':path.stat().st_size} for path in sorted(images.iterdir())]
            report['geometrySettings']={'cropToROI':True}
            (run/'quality.json').write_text(json.dumps(report),encoding='utf-8')
            self.rejected(images,run,'RESUME_GEOMETRY_PROFILE_CHANGED',resume=True)
            self.assertEqual(json.loads((run/'quality.json').read_text()),report)
            image=Image.new("RGB",(1080,1920),"blue")
            image.save(images/"view-000.png")
            self.rejected(images,root/"different-run","CAPTURE_DIMENSIONS_MISMATCH")


if __name__=="__main__":
    unittest.main()
