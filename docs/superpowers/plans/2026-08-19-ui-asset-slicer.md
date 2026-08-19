# UI Asset Slicer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and validate an offline Python CLI that extracts visual UI assets from design images as transparent RGBA PNGs, then package the working CLI as the reusable `ui-asset-slicer` Codex skill.

**Architecture:** Keep the tool isolated under `tools/ui-asset-slicer/` with separate configuration, extraction, reporting, and CLI modules. Automatic detection provides candidates; explicit JSON regions override names and boundaries for reliable production output. The sample profile image is an integration fixture, while the existing profile assets remain read-only references.

**Tech Stack:** Python 3.10+, Pillow, NumPy, Python `unittest`, JSON, SHA-256 reports.

---

## File map

- Create `tools/ui-asset-slicer/slicer.py`: command-line entry point and input dispatch.
- Create `tools/ui-asset-slicer/config.py`: dataclasses and JSON validation.
- Create `tools/ui-asset-slicer/pipeline.py`: background modeling, candidate detection, soft alpha extraction, crop, and PNG export.
- Create `tools/ui-asset-slicer/report.py`: manifest, validation report, and checkerboard contact sheet.
- Create `tools/ui-asset-slicer/tests/test_config.py`: configuration unit tests.
- Create `tools/ui-asset-slicer/tests/test_pipeline.py`: alpha and candidate unit tests.
- Create `tools/ui-asset-slicer/tests/test_cli.py`: end-to-end CLI tests using temporary files.
- Create `tools/ui-asset-slicer/configs/03-profile.json`: sample corrections and stable names for the supplied design.
- Create `tools/ui-asset-slicer/README.md`: local usage and fixture command.
- Create `tools/ui-asset-slicer/skill/SKILL.md`: source copy of the reusable skill instructions.
- Create `tools/ui-asset-slicer/skill/references/config-schema.md`: reusable JSON schema reference.
- Create `tools/ui-asset-slicer/skill/scripts/ui_asset_slicer.py`: self-contained skill-bundled launcher.
- Install the validated skill at `C:\Users\Administrator\.codex\skills\ui-asset-slicer\` with the same three skill files.

## Task 1: Lock configuration behavior with failing tests

**Files:**
- Create: `tools/ui-asset-slicer/tests/test_config.py`
- Create: `tools/ui-asset-slicer/config.py`

- [ ] **Step 1: Write failing tests for defaults, image selection, and invalid regions.**

```python
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

MODULE = Path(__file__).parents[1] / "config.py"
SPEC = importlib.util.spec_from_file_location("ui_asset_config", MODULE)
config = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(config)


class ConfigTests(unittest.TestCase):
    def test_defaults_and_image_overrides_are_merged(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "config.json"
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
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "config.json"
            path.write_text(json.dumps({"images": {"x.png": {"regions": [{
                "name": "bad", "box": [1, 2, -3, 4], "action": "include"
            }]}}}), encoding="utf-8")
            with self.assertRaisesRegex(config.ConfigError, "images.x.png.regions\[0\].box"):
                config.load_config(path, "x.png")


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run the new tests and verify they fail because the config module is missing.**

Run: `rtk python -m unittest discover -s tools/ui-asset-slicer/tests -p "test_config.py" -v`

Expected: FAIL with an import or attribute error for `config.load_config`.

- [ ] **Step 3: Implement typed configuration loading.**

```python
from dataclasses import dataclass, field
import json
from pathlib import Path


class ConfigError(ValueError):
    pass


@dataclass(frozen=True)
class RegionSpec:
    name: str
    box: tuple[int, int, int, int]
    action: str = "include"
    padding: int | None = None


@dataclass(frozen=True)
class SlicerConfig:
    padding: int = 4
    keep_shadows: bool = True
    min_area: int = 120
    regions: tuple[RegionSpec, ...] = field(default_factory=tuple)


def load_config(path: Path | None, image_name: str) -> SlicerConfig:
    if path is None:
        return SlicerConfig()
    raw = json.loads(path.read_text(encoding="utf-8"))
    defaults = raw.get("defaults", {})
    image = raw.get("images", {}).get(image_name, {})
    regions = []
    for index, item in enumerate(image.get("regions", [])):
        prefix = f"images.{image_name}.regions[{index}]"
        name = item.get("name")
        box = item.get("box")
        action = item.get("action", "include")
        if not isinstance(name, str) or not name.strip():
            raise ConfigError(f"{prefix}.name must be a non-empty string")
        if (not isinstance(box, list) or len(box) != 4 or
                any(not isinstance(value, int) for value in box) or
                box[2] <= 0 or box[3] <= 0 or box[0] < 0 or box[1] < 0):
            raise ConfigError(f"{prefix}.box must be [x, y, width, height] with positive size")
        if action not in {"include", "exclude", "merge"}:
            raise ConfigError(f"{prefix}.action must be include, exclude, or merge")
        regions.append(RegionSpec(name, tuple(box), action, item.get("padding")))
    names = [region.name for region in regions]
    if len(names) != len(set(names)):
        raise ConfigError(f"images.{image_name}.regions contains duplicate names")
    return SlicerConfig(
        padding=int(defaults.get("padding", 4)),
        keep_shadows=bool(defaults.get("keep_shadows", True)),
        min_area=int(defaults.get("min_area", 120)),
        regions=tuple(regions),
    )
```

- [ ] **Step 4: Re-run the focused tests and verify they pass.**

Run: `rtk python -m unittest discover -s tools/ui-asset-slicer/tests -p "test_config.py" -v`

Expected: `OK` with 2 tests.

## Task 2: Implement deterministic visual extraction and alpha preservation

**Files:**
- Create: `tools/ui-asset-slicer/tests/test_pipeline.py`
- Create: `tools/ui-asset-slicer/pipeline.py`

- [ ] **Step 1: Write failing tests for soft alpha, source color retention, and explicit regions.**

```python
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


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run the pipeline tests and verify they fail before implementation.**

Run: `rtk python -m unittest discover -s tools/ui-asset-slicer/tests -p "test_pipeline.py" -v`

Expected: FAIL with missing `extract_region` or `resolve_regions`.

- [ ] **Step 3: Implement background estimation, candidate discovery, and soft alpha extraction.**

```python
from dataclasses import dataclass
from PIL import Image, ImageFilter
import numpy as np


@dataclass(frozen=True)
class Candidate:
    name: str
    box: tuple[int, int, int, int]
    confidence: float
    source: str = "auto"


def _border_color(array: np.ndarray) -> np.ndarray:
    pixels = np.concatenate([
        array[0, :, :], array[-1, :, :], array[:, 0, :], array[:, -1, :]
    ], axis=0)
    return np.median(pixels, axis=0)


def _soft_alpha(rgb: np.ndarray, background: np.ndarray, keep_shadows: bool) -> np.ndarray:
    distance = np.sqrt(np.sum((rgb.astype(np.float32) - background) ** 2, axis=2))
    low, high = ((5.0, 26.0) if keep_shadows else (12.0, 32.0))
    alpha = np.clip((distance - low) / (high - low), 0.0, 1.0)
    alpha = (alpha * 255.0).astype(np.uint8)
    return alpha


def extract_region(image: Image.Image, box: tuple[int, int, int, int],
                   padding: int = 4, keep_shadows: bool = True) -> Image.Image:
    x, y, width, height = box
    crop = image.convert("RGB").crop((x, y, x + width, y + height))
    array = np.asarray(crop)
    background = _border_color(array)
    alpha = _soft_alpha(array, background, keep_shadows)
    alpha_image = Image.fromarray(alpha, mode="L").filter(ImageFilter.GaussianBlur(0.35))
    rgba = crop.convert("RGBA")
    rgba.putalpha(alpha_image)
    bbox = alpha_image.getbbox()
    if bbox is None:
        return Image.new("RGBA", (1, 1), (0, 0, 0, 0))
    left = max(0, bbox[0] - padding)
    top = max(0, bbox[1] - padding)
    right = min(rgba.width, bbox[2] + padding)
    bottom = min(rgba.height, bbox[3] + padding)
    return rgba.crop((left, top, right, bottom))
```

The implementation must use connected-component labeling on the foreground mask, merge components separated by small gaps, discard components whose fill/shape statistics are text-like or container-sized, and return low-confidence candidates in the report. Explicit `include` regions bypass the automatic area filter; `exclude` regions remove overlapping automatic candidates.

- [ ] **Step 4: Re-run the pipeline tests and verify they pass.**

Run: `rtk python -m unittest discover -s tools/ui-asset-slicer/tests -p "test_pipeline.py" -v`

Expected: `OK` with 2 tests.

## Task 3: Add CLI dispatch, manifests, validation, and contact sheets

**Files:**
- Create: `tools/ui-asset-slicer/tests/test_cli.py`
- Create: `tools/ui-asset-slicer/slicer.py`
- Create: `tools/ui-asset-slicer/report.py`

- [ ] **Step 1: Write an end-to-end failing test for single-file output and collision safety.**

```python
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from PIL import Image, ImageDraw


ROOT = Path(__file__).parents[1]
CLI = ROOT / "slicer.py"


class CliTests(unittest.TestCase):
    def test_cli_writes_rgba_asset_manifest_and_validation(self):
        with tempfile.TemporaryDirectory() as folder:
            work = Path(folder)
            source = work / "screen.png"
            image = Image.new("RGB", (100, 80), (245, 240, 228))
            ImageDraw.Draw(image).ellipse((30, 20, 70, 60), fill=(90, 60, 35))
            image.save(source)
            config = work / "config.json"
            config.write_text(json.dumps({"images": {"screen.png": {"regions": [{
                "name": "icon", "box": [20, 10, 60, 60], "action": "include"
            }]}}}), encoding="utf-8")
            output = work / "out"
            result = subprocess.run([
                sys.executable, str(CLI), str(source), "--out", str(output),
                "--config", str(config)
            ], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            asset = Image.open(output / "screen" / "assets" / "icon.png")
            self.assertEqual(asset.mode, "RGBA")
            self.assertTrue((output / "screen" / "manifest.json").exists())
            self.assertTrue((output / "screen" / "validation.json").exists())
            second = subprocess.run([
                sys.executable, str(CLI), str(source), "--out", str(output),
                "--config", str(config)
            ], capture_output=True, text=True)
            self.assertNotEqual(second.returncode, 0)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run the CLI test and verify it fails because the entry point is absent.**

Run: `rtk python -m unittest discover -s tools/ui-asset-slicer/tests -p "test_cli.py" -v`

Expected: FAIL because `slicer.py` does not yet create the output.

- [ ] **Step 3: Implement report generation and CLI dispatch.**

The public CLI must expose these functions so tests and the skill can reuse them:

```python
def process_image(source: Path, output_root: Path, config_path: Path | None,
                  padding: int | None, min_area: int | None,
                  debug: bool, force: bool) -> dict:
    """Process one source image and return its manifest dictionary."""


def main(argv: list[str] | None = None) -> int:
    """Parse arguments, process a file or directory, and return an exit code."""
```

`report.py` must write a SHA-256 source hash, each asset's source box and dimensions, alpha coverage, corner alpha values, and warnings. `validation.json` must mark `passed: false` when an asset has no alpha coverage, a clipped box, or a large opaque paper-colored component. `contact-sheet.png` must place each output on a checkerboard background with its filename rendered above it.

- [ ] **Step 4: Re-run the CLI test and the full local tool suite.**

Run: `rtk python -m unittest discover -s tools/ui-asset-slicer/tests -v`

Expected: `OK` with all current tests passing.

## Task 4: Configure and validate the supplied profile design

**Files:**
- Create: `tools/ui-asset-slicer/configs/03-profile.json`
- Modify: `tools/ui-asset-slicer/tests/test_cli.py`
- Create: `tools/ui-asset-slicer/README.md`

- [ ] **Step 1: Add explicit sample regions for the visual assets in `03-profile.png`.**

The fixture must include stable regions for the avatar, overflow icon, four metric icons, weekly-reading bear illustration, family and report illustrations, the three menu icons, the account/lock icon, and one shared arrow icon. It must explicitly exclude the title, profile name, metric labels, card surfaces, menu labels, and tab-bar text.

- [ ] **Step 2: Add a fixture test that runs the real source image without modifying it.**

```python
def test_profile_fixture_has_expected_visual_families(self):
    source = Path("design/ui-concepts/homepage-v1/03-profile.png")
    config = Path("tools/ui-asset-slicer/configs/03-profile.json")
    before = source.read_bytes()
    with tempfile.TemporaryDirectory() as folder:
        output = Path(folder) / "profile"
        result = subprocess.run([
            sys.executable, str(CLI), str(source), "--out", str(output),
            "--config", str(config)
        ], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(source.read_bytes(), before)
        manifest = json.loads((output / "03-profile" / "manifest.json").read_text(encoding="utf-8"))
        validation = json.loads((output / "03-profile" / "validation.json").read_text(encoding="utf-8"))
        names = {entry["name"] for entry in manifest["assets"]}
        self.assertTrue({"profile-avatar", "profile-more", "reading-bear"} <= names)
        self.assertTrue(validation["passed"])
```

The test is a Python `unittest.TestCase` method in `tools/ui-asset-slicer/tests/test_cli.py`, so it uses the imports and `CLI` path defined in Task 3.

- [ ] **Step 3: Run the fixture command and inspect the generated contact sheet and report.**

Run: `rtk python tools/ui-asset-slicer/slicer.py design/ui-concepts/homepage-v1/03-profile.png --out artifacts/ui-asset-slicer --config tools/ui-asset-slicer/configs/03-profile.json --debug`

Expected: exit code `0`; `artifacts/ui-asset-slicer/03-profile/assets/` contains the configured visual assets, `validation.json` reports `passed: true`, and the source hash in the report matches the pre-run hash.

- [ ] **Step 4: Confirm the existing profile references are untouched.**

Run: `rtk git status --short -- miniprogram/assets/profile design/ui-concepts/homepage-v1/03-profile.png`

Expected: no changes under either path.

## Task 5: Package and validate the reusable Codex skill

**Files:**
- Create: `tools/ui-asset-slicer/skill/SKILL.md`
- Create: `tools/ui-asset-slicer/skill/references/config-schema.md`
- Create: `tools/ui-asset-slicer/skill/scripts/ui_asset_slicer.py`
- Install: `C:\Users\Administrator\.codex\skills\ui-asset-slicer\SKILL.md`
- Install: `C:\Users\Administrator\.codex\skills\ui-asset-slicer\references\config-schema.md`
- Install: `C:\Users\Administrator\.codex\skills\ui-asset-slicer\scripts\ui_asset_slicer.py`

- [ ] **Step 1: Write the skill instructions around the validated CLI.**

`SKILL.md` must contain YAML frontmatter with the name `ui-asset-slicer` and a discriminating description, then state: use for extracting illustrations/avatars/icons/decorations from UI designs; ignore text/background/card surfaces by default; preserve shadows and watercolor details; use JSON for correction; run the bundled script; inspect `validation.json`; never claim success without running the fixture or the user's input.

- [ ] **Step 2: Add the schema reference and make the bundled script self-contained.**

The bundled script must run with `python scripts/ui_asset_slicer.py INPUT --out OUTPUT` from the installed skill directory and produce the same manifest and validation fields as the project tool. It may import the project modules only in the source copy; the installed copy must include its required implementation in the script itself so the skill remains usable from another workspace.

- [ ] **Step 3: Validate the skill package.**

Run: `rtk python C:\Users\Administrator\.codex\skills\.system\skill-creator\scripts\quick_validate.py tools/ui-asset-slicer/skill`

Expected: validator exits `0` with no frontmatter, naming, or unfinished-scaffold errors.

- [ ] **Step 4: Run the installed skill script against the supplied design.**

Run: `rtk python C:\Users\Administrator\.codex\skills\ui-asset-slicer\scripts\ui_asset_slicer.py design/ui-concepts/homepage-v1/03-profile.png --out artifacts/ui-asset-slicer-installed --config tools/ui-asset-slicer/configs/03-profile.json`

Expected: exit code `0`, RGBA PNG assets and `validation.json` are written, and the report passes the same checks as the project CLI.

- [ ] **Step 5: Run final verification before claiming completion.**

Run:

```text
rtk python -m unittest discover -s tools/ui-asset-slicer/tests -v
rtk python tools/ui-asset-slicer/slicer.py design/ui-concepts/homepage-v1/03-profile.png --out artifacts/ui-asset-slicer-final --config tools/ui-asset-slicer/configs/03-profile.json
rtk git diff --check
rtk git status --short
```

Expected: all tool tests pass, the sample report says `passed: true`, `git diff --check` produces no output, and only the requested tool, skill, docs, and generated artifact paths are changed; pre-existing user modifications remain intact.
