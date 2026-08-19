# UI Asset Slicer

Local command-line extraction of illustrations, avatars, icons, and decorative UI assets from PNG/JPG design images.

## Requirements

- Python 3.10+
- Pillow
- NumPy

## Usage

Process one design image:

```text
python tools/ui-asset-slicer/slicer.py design/ui-concepts/homepage-v1/03-profile.png --out artifacts/ui-asset-slicer --config tools/ui-asset-slicer/configs/03-profile.json
```

Process every PNG/JPG in a directory:

```text
python tools/ui-asset-slicer/slicer.py design/ui-concepts/homepage-v1 --out artifacts/ui-asset-slicer
```

Use `--debug` to write candidate boxes and the automatic foreground mask. Use `--force` only when replacing an existing output directory. The default output includes transparent PNGs, `manifest.json`, `validation.json`, and a checkerboard `contact-sheet.png`.

## Configuration

The optional JSON file can provide stable names and explicit pixel boxes. `include` keeps a region even if it is small, `exclude` removes an automatic candidate, and `merge` reserves a named explicit region for a combined visual asset. See `configs/03-profile.json` for the supplied sample and `skill/references/config-schema.md` for the reusable schema.

## Validation

Run the tool tests:

```text
python -m unittest discover -s tools/ui-asset-slicer/tests -v
```

Run the supplied design fixture:

```text
python tools/ui-asset-slicer/slicer.py design/ui-concepts/homepage-v1/03-profile.png --out artifacts/ui-asset-slicer --config tools/ui-asset-slicer/configs/03-profile.json --debug --force
```

The fixture must finish with exit code `0`, report `passed: true`, preserve the source SHA-256 hash, and leave the source file and existing `miniprogram/assets/profile/` references unchanged.
