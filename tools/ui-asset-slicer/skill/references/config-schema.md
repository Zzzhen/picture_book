# UI Asset Slicer JSON Schema

The configuration file is optional. It is used to make automatic detection reproducible when a design has low-contrast paper texture, overlapping decorations, or an asset that should keep a stable production name.

```json
{
  "defaults": {
    "padding": 4,
    "keep_shadows": true,
    "min_area": 120
  },
  "images": {
    "screen.png": {
      "regions": [
        {
          "name": "profile-avatar",
          "box": [50, 145, 220, 220],
          "action": "include",
          "padding": 3
        },
        {
          "name": "ignore-title",
          "box": [270, 205, 430, 125],
          "action": "exclude"
        }
      ]
    }
  }
}
```

Rules:

- `box` is `[x, y, width, height]` in source-image pixels.
- `include` forces a named visual region into the output, even if it is small.
- `exclude` removes overlapping automatic candidates.
- `merge` reserves a named explicit region for a combined visual asset.
- `padding` is non-negative and is applied before the final alpha-bound crop.
- Names must be unique per image and are normalized into safe PNG filenames.
- Invalid, negative, zero-sized, or out-of-bounds regions must be corrected before running the CLI.
