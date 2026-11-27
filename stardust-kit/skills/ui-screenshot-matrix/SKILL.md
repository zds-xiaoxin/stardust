---
name: ui-screenshot-matrix
description: >-
  Produce acceptance evidence for a UI change: screenshots across language (zh/en) x theme (dark/light) x viewport
  (desktop 1440 / narrow ~900 / mobile 390), full-page plus key states, a top-to-bottom scroll recording, a
  before/after comparison, and a proportion check against an original (uniform scale only). Use when asked to
  "verify the page on mobile/dark/light", "take acceptance screenshots", "record a scroll video", "compare before and
  after", "check this matches the original / mockup", "check proportions", or in Chinese: "验收截图", "多端截图",
  "中英文深浅色截图", "手机/窄屏/宽屏检查", "录滚动视频", "改前改后对比", "和原稿比例对一下", "等比缩放核对".
  Offline Node + Playwright scripts; no dev server required.
---

# UI Screenshot Matrix

Authored by the Stardust project, MIT License. Generic; works on any static HTML or live URL.

Evidence beats assertion. After any visual change, produce the matrix, look at the images yourself, and report what
you saw, including what you did not capture.

## Prerequisites

**Scripts never install or download packages at runtime.** They require an already-installed `playwright` package in your
project's `node_modules` (or pointed to via `PLAYWRIGHT_PATH`) and either Playwright's Chromium or an existing Google Chrome
(`PW_CHANNEL=chrome`). See `../README.md` for one-time environment setup.

Scripts live in `scripts/` and import `_pw.mjs`. No script starts a long-running server: local files (including local HTML
inputs to `proportion-check.mjs`) are served strictly inside the target root via Playwright request routing at
`https://app.local/` (use `--mount /prefix` if the site is deployed under a path), and requests to any other origin are
aborted offline. Passing an explicit `--url` accesses that live URL.

## The matrix

| Axis | Values |
|---|---|
| Language | zh, en (or any set: `--entries zh=/,en=/en/`) |
| Theme | dark, light (`--themes`; sets `colorScheme` and `html[data-theme]`; override with `--theme-attr`, `--theme-key`) |
| Viewport | desktop 1440x900, narrow 900x800, mobile 390x844 @2x touch |
| Capture | `full` (full page), `fold` (first screen), then each key state from `states.json` |

If the product is dark-only (e.g. the Stardust site), still run both themes once to prove it stays dark/consistent.

## Commands

```sh
# 1. The matrix (before the change, then after, into different folders)
node scripts/capture-matrix.mjs --root ./site --entries zh=/,en=/en/ --out shots/before --name home --states states.json
# 2. A scroll recording for motion and layout flow (webm; --mp4 if ffmpeg exists; --stills N key frames)
node scripts/record-scroll.mjs --root ./site --entry /index.html --viewport mobile --ms 11000 --stills 6 --mp4 --out video/home-mobile
# 3. Before/after sheets for every matching file name
node scripts/compare-sheet.mjs --before shots/before --after shots/after --out shots/compare --only desktop,mobile
# 4. Proportion check against the original (uniform scale only)
node scripts/proportion-check.mjs --orig original.png --cand candidate.png --out check.png
node scripts/proportion-check.mjs --orig-html orig.html --orig-sel "#x" --cand-html new.html --cand-sel "#x" --parts ".logo,.title"
```

Each script prints a summary and exits 1 on failure (overflow or page errors in the matrix; non-uniform scale or part
drift in the proportion check).

## Rules

1. **Same script, same flags, before and after.** Different capture code makes comparisons meaningless.
2. **Naming:** `{name}__{lang}__{theme}__{viewport}__{state}.png`. Never rename by hand; the compare sheet pairs by name.
3. **Look at every image class** (at least one per viewport and theme). Check clipping, overflow, contrast, wrapping,
   long Chinese/English strings, sticky headers covering content (use `--hide` to hide a floating nav for full-page shots).
4. **Proportions: uniform scale only.** A candidate may be 0.5x or 2x, but width and height must scale by the same factor.
   Image mode (`--orig`/`--cand`) verifies only outer image aspect ratio; use HTML mode (`--orig-html`/`--cand-html` with
   `--parts`) plus visual inspection of the difference overlay to catch inner geometry distortion. If it does not match,
   change the layout; never stretch the image or tweak one axis. See `references/proportion-rule.md`.
5. **Full-page shots of reveal-on-scroll pages** need a prescroll (default on) or half the page is blank.
6. **Reduced motion is on by default** for stable stills; pass `--motion` to keep animations.
7. **Report honestly:** list which matrix cells were captured and which were skipped; quote overflow/error lines verbatim.
8. Keep generated media out of the repo unless asked; no private data in screenshots (use sample data).

## Files

- `references/matrix.md` – matrix definition, state selection, naming, folder layout, what to look for per viewport.
- `references/recording.md` – scroll recording details, stills, mp4/X-ready export, frame strips.
- `references/proportion-rule.md` – the uniform-scale rule, measuring parts, tolerance, common failures.
- `references/comparison-layout.md` – before/after sheet layout and how to present evidence.
- `scripts/capture-matrix.mjs`, `record-scroll.mjs`, `compare-sheet.mjs`, `proportion-check.mjs`, `_pw.mjs`.
