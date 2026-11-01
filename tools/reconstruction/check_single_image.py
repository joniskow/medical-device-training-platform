"""Mask admission checks protect the actual visible silhouette before inference."""
from pathlib import Path
import tempfile
import unittest
from PIL import Image, ImageDraw
from single_image import prepare_image


class SingleImageChecks(unittest.TestCase):
    def test_preserves_mask_outline_and_hole(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            image = Image.new("RGBA", (512, 256))
            draw = ImageDraw.Draw(image)
            draw.rectangle((80, 32, 431, 223), fill=(200, 100, 50, 255))
            draw.rectangle((200, 64, 311, 127), fill=(0, 0, 0, 0))
            image.save(root / "source.png")
            report = prepare_image(root / "source.png", root / "input.png", "provided-alpha")
            self.assertEqual(report["foregroundBox"], [80, 32, 432, 224])
            self.assertEqual(Image.open(root / "foreground.png").tobytes(), image.tobytes())
            output = Image.open(root / "input.png")
            self.assertEqual(output.width, output.height)
            self.assertEqual(output.getpixel((0, 0)), (128, 128, 128))
            self.assertEqual(output.getpixel((output.width // 2, 100)), (128, 128, 128))
            self.assertEqual(len(report["normalizedSha256"]), 64)
            # Automatic mode must respect an existing cutout instead of eroding
            # narrow features with a second segmentation pass.
            automatic = prepare_image(root / "source.png", root / "input.png", "automatic")
            self.assertEqual(automatic["mask"], "provided-alpha-review-required")
            self.assertEqual(automatic["normalizedSha256"], report["normalizedSha256"])

    def test_rejects_no_mask_clipped_empty_and_tiny_foreground(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            images = [Image.new("RGB", (256, 256), "blue"), Image.new("RGBA", (256, 256))]
            for box in [(0, 40, 200, 200), (100, 100, 105, 105)]:
                image = Image.new("RGBA", (256, 256))
                ImageDraw.Draw(image).rectangle(box, fill="blue")
                images.append(image)
            for image in images:
                image.save(root / "source.png")
                with self.assertRaises(ValueError):
                    prepare_image(root / "source.png", root / "input.png", "provided-alpha")


if __name__ == "__main__":
    unittest.main()
