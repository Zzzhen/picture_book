import importlib.util
import json
import unittest
from pathlib import Path


MODULE = Path(__file__).parents[1] / "config.py"
SPEC = importlib.util.spec_from_file_location("ui_asset_config", MODULE)
config = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(config)


class ConfigTests(unittest.TestCase):
    def test_defaults_and_image_overrides_are_merged(self):
        path = Path(__file__).parents[1] / "test-runtime" / "config.json"
        path.write_text(json.dumps({
            "defaults": {"padding": 4, "min_area": 120},
            "images": {"profile.png": {"regions": [{
                "name": "avatar", "box": [10, 20, 30, 40], "action": "include"
            }]}}
        }), encoding="utf-8")
        loaded = config.load_config(path, "profile.png")
        self.assertEqual(loaded.padding, 4)
        self.assertEqual(loaded.min_area, 120)
        self.assertEqual(loaded.regions[0].name, "avatar")
        self.assertEqual(loaded.regions[0].box, (10, 20, 30, 40))

    def test_invalid_box_is_rejected_with_a_path(self):
        path = Path(__file__).parents[1] / "test-runtime" / "invalid.json"
        path.write_text(json.dumps({"images": {"x.png": {"regions": [{
            "name": "bad", "box": [1, 2, -3, 4], "action": "include"
        }]}}}), encoding="utf-8")
        with self.assertRaisesRegex(config.ConfigError, "images.x.png.regions\\[0\\].box"):
            config.load_config(path, "x.png")


if __name__ == "__main__":
    unittest.main()
