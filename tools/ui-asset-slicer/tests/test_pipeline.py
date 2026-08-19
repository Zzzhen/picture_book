import importlib.util
import unittest
from pathlib import Path
from PIL import Image, ImageDraw


MODULE = Path(__file__).parents[1] / "pipeline.py"
SPEC = importlib.util.spec_from_file_location("ui_asset_pipeline", MODULE)
pipeline = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(pipeline)


class PipelineTests(unittest.TestCase):
    def test_extract_region_makes_paper_corners_transparent(self):
        image = Image.new("RGB", (80, 80), (245, 240, 228))
        draw = ImageDraw.Draw(image)
        draw.ellipse((22, 20, 58, 60), fill=(115, 76, 43))
        result = pipeline.extract_region(image, (10, 10, 60, 60), padding=0)
        self.assertEqual(result.mode, "RGBA")
        self.assertEqual(result.getpixel((0, 0))[3], 0)
        self.assertGreater(result.getpixel((30, 30))[3], 200)
        self.assertEqual(result.getpixel((30, 30))[:3], (115, 76, 43))

    def test_explicit_region_is_kept_even_when_candidate_is_small(self):
        image = Image.new("RGB", (40, 40), (245, 240, 228))
        draw = ImageDraw.Draw(image)
        draw.rectangle((18, 18, 21, 21), fill=(120, 80, 40))
        regions = pipeline.resolve_regions(image, [
            {"name": "tiny", "box": (14, 14, 12, 12), "action": "include"}
        ], min_area=100)
        self.assertEqual([region.name for region in regions], ["tiny"])

    def test_auto_candidates_drop_text_rows_and_card_containers(self):
        source = Path("design/ui-concepts/homepage-v1/03-profile.png")
        with Image.open(source) as loaded:
            candidates = pipeline.auto_candidates(loaded.convert("RGB"), min_area=120)
            width, height = loaded.size
        self.assertLess(len(candidates), 25)
        self.assertFalse(any(
            candidate.box[2] >= candidate.box[3] * 2.0 and candidate.box[3] <= 55
            for candidate in candidates
        ))
        self.assertFalse(any(
            candidate.box[2] > width * 0.35 and candidate.box[3] > height * 0.08
            for candidate in candidates
        ))
        self.assertFalse(any(
            candidate.box[1] > height * 0.86 and candidate.box[3] > 80
            for candidate in candidates
        ))


if __name__ == "__main__":
    unittest.main()
