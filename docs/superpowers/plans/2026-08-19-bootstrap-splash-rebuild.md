# Bootstrap Splash Screen Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `pages/bootstrap/index` to match `00-splash-screen-watercolor-v1.png` while preserving the existing bootstrap states and navigation behavior.

**Architecture:** Keep `index.js` as the existing data-flow controller. Replace only the splash markup/styles and add a sliced watercolor illustration; reuse the existing paper texture asset and native safe-area layout so the device chrome remains platform-owned.

**Tech Stack:** WeChat Mini Program WXML/WXSS/JavaScript, existing component library, `ui-asset-slicer`, Node test suite.

---

### Task 1: Add the visual regression contract

**Files:**
- Modify: `tests/frontend-behavior.test.js`

- [x] **Step 1: Write assertions for the splash structure and asset usage.**
  Assert that the bootstrap template uses a real watercolor image, keeps the loading/error/offline/disabled/deleting states and retry/feedback handlers, and no longer depends on `bookplate-mark` for the splash artwork. Assert that WXSS references paper texture, safe-area spacing and the loading animation.

- [x] **Step 2: Run `rtk npm test` and confirm the new test fails because the old template is still present.**

### Task 2: Extract the watercolor illustration

**Files:**
- Create: `miniprogram/assets/bootstrap/splash-book-watercolor.png`
- Create: `miniprogram/assets/bootstrap/splash-book-watercolor-slices.json`
- Create: `miniprogram/assets/bootstrap/slicer-validation.json`
- Create: `miniprogram/assets/bootstrap/slicer-contact-sheet.png`

- [x] **Step 1: Use `ui_asset_slicer.py` with an explicit include region around the book-and-branch illustration, excluding the device chrome, text, progress bar and paper background.**
- [x] **Step 2: Inspect `validation.json` and `contact-sheet.png`; require a transparent corner, preserved watercolor edges/shadows and unchanged source hash.**
- [x] **Step 3: Copy the validated PNG into the runtime asset folder with a stable lowercase name.**

### Task 3: Rebuild the bootstrap visual layer

**Files:**
- Modify: `miniprogram/pages/bootstrap/index.wxml`
- Modify: `miniprogram/pages/bootstrap/index.wxss`
- Keep unchanged: `miniprogram/pages/bootstrap/index.js`, `miniprogram/pages/bootstrap/index.json`

- [x] **Step 1: Replace the `bookplate-mark` splash brand with the sliced watercolor image and existing Chinese brand copy.**
- [x] **Step 2: Use `paper-texture.png` as the page background, preserve safe-area top/bottom padding, and align the central brand block and bottom loading block to the reference proportions.**
- [x] **Step 3: Keep all existing state branches and event handlers visually compatible with the same frame.**
- [x] **Step 4: Respect reduced motion for the loading indicator without removing the default animation.**

### Task 4: Verify the implementation

**Files:**
- Inspect: `miniprogram/pages/bootstrap/index.js`, `miniprogram/pages/bootstrap/index.wxml`, `miniprogram/pages/bootstrap/index.wxss`, `miniprogram/assets/bootstrap/splash-book-watercolor.png`

- [x] **Step 1: Run the focused frontend behavior test and `rtk node --check miniprogram\\pages\\bootstrap\\index.js`.**
- [x] **Step 2: Run `rtk npm test` and confirm zero failures.**
- [x] **Step 3: Run the project check; if the known inaccessible temporary directories still cause `EPERM`, rerun with only those two paths skipped and report that limitation.**
- [x] **Step 4: Inspect the final asset validation and source hash before handoff.**
