import json
import subprocess
import sys
import unittest
from pathlib import Path
from PIL import Image, ImageDraw


ROOT = Path(__file__).parents[1]
RUNTIME = ROOT / "test-runtime"
CLI = ROOT / "slicer.py"


class CliTests(unittest.TestCase):
    def test_cli_writes_rgba_asset_manifest_and_validation(self):
        source = RUNTIME / "screen.png"
        image = Image.new("RGB", (100, 80), (245, 240, 228))
        ImageDraw.Draw(image).ellipse((30, 20, 70, 60), fill=(90, 60, 35))
        image.save(source)
        config = RUNTIME / "cli-config.json"
        config.write_text(json.dumps({"images": {"screen.png": {"regions": [{
            "name": "icon", "box": [20, 10, 60, 60], "action": "include"
        }]}}}), encoding="utf-8")
        output = RUNTIME / "cli-out"
        result = subprocess.run([
            sys.executable, str(CLI), str(source), "--out", str(output),
            "--config", str(config), "--force"
        ], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        with Image.open(output / "screen" / "assets" / "icon.png") as asset:
            self.assertEqual(asset.mode, "RGBA")
        self.assertTrue((output / "screen" / "manifest.json").exists())
        self.assertTrue((output / "screen" / "validation.json").exists())

        second = subprocess.run([
            sys.executable, str(CLI), str(source), "--out", str(output),
            "--config", str(config)
        ], capture_output=True, text=True)
        self.assertNotEqual(second.returncode, 0)

    def test_profile_fixture_has_expected_visual_families_and_transparent_output(self):
        source = Path("design/ui-concepts/homepage-v1/03-profile.png")
        config = ROOT / "configs" / "03-profile.json"
        output = RUNTIME / "profile-out"
        before = source.read_bytes()
        result = subprocess.run([
            sys.executable, str(CLI), str(source), "--out", str(output),
            "--config", str(config), "--force"
        ], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(source.read_bytes(), before)
        manifest = json.loads((output / "03-profile" / "manifest.json").read_text(encoding="utf-8"))
        validation = json.loads((output / "03-profile" / "validation.json").read_text(encoding="utf-8"))
        names = {entry["name"] for entry in manifest["assets"]}
        self.assertTrue({"profile-avatar", "profile-more", "reading-bear"} <= names)
        self.assertTrue(validation["passed"])


if __name__ == "__main__":
    unittest.main()
