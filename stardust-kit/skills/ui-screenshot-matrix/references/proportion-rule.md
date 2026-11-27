# Proportion check: uniform scale only

**Rule.** A candidate (your implementation, a re-render, a thumbnail) is correct when it equals the original multiplied by
ONE scale factor. If width scales by `sx` and height by `sy`, then `sx == sy` within tolerance (default 1%). Anything else
is a stretched or re-drawn imitation and fails.

## Why

Stretching hides real differences (a pill becomes an ellipse, a star changes its angles) and makes thumbnails look "almost
right". Use the original as the source of truth; never redraw an imitation to get proportions to match.

## Procedure

1. **Measure the original** at its natural size: root box plus the parts you care about (logo, title, buttons).
2. **Capture the candidate** at any size, from the same element.
3. Run `proportion-check.mjs` in image mode or HTML mode.
   - **Image mode** (`--orig` / `--cand`) checks only the outer image aspect ratio (`sx == sy`). A candidate whose outer
     canvas has the right ratio can still squash an inner icon or card, so always inspect the difference overlay visually.
   - **HTML mode** (`--orig-html` / `--cand-html`) serves local files offline via `https://app.local` (pass `--orig-root` /
     `--cand-root` when assets live in a parent folder) and also normalises sub-parts:
     `x/rootW, y/rootH, w/rootW, h/rootH` for the first visible match of each `--parts` selector; the part delta must be
     <= tolerance of the root size.
4. Open the sheet: original, candidate (same height), and a difference overlay. A clean overlay is near-black; coloured
   ghosting shows where geometry differs.
5. If FAIL, change the layout/CSS of the candidate (not the screenshot), re-capture, re-run.

## Reading the result

- `uniform scale: 0.00%` and part deltas near zero: PASS.
- `uniform scale` large: the candidate has a different aspect ratio. Fix crop/padding/`object-fit`; check that
  `width:100%; height:100%` is not stretching a fixed-ratio image.
- Part deltas large but root OK: internal layout differs (spacing, order, wrapping).
- Part missing: the selector does not exist in one side. Match the real DOM, do not add a decoy element.

## Thumbnails

Capture thumbnails from the real original element and downscale uniformly (`--device-scale-factor`, or `ffmpeg -vf scale=W:-1`,
which keeps the ratio). Never export a thumbnail at a fixed WxH that differs in ratio from the original.

## Tolerance

Default 1% fits anti-aliasing and subpixel layout. Use 0.5% for icons and 2% for text-heavy blocks with font differences.
Never raise it just to turn FAIL into PASS.
