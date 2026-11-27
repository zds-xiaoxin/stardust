# Review and performance procedure

## 1. Slow-motion review

- DevTools console (affects CSS transitions/animations and WAAPI, including ones that start later):
  `document.getAnimations().forEach(a => a.playbackRate = .25)`. The `scripts/slowmo.js` helper does this continuously:
  `slowmo(0.25)`, `slowmo(1)` to restore, `slowmo(0)` to pause and scrub.
- In automated runs: `await page.addInitScript({ path: 'scripts/slowmo.js' }); await page.evaluate(() => slowmo(0.25));`
- It does not slow rAF/canvas/`setTimeout` code. For those, define tokens through a multiplier
  (`--motion-scale`, see `tokens.css`) and read it in script (`tokens.ts`). Set `--motion-scale: 4` for 4× slower.
- Capture frame strips: with slow motion on, screenshot every ~100 ms and tile them (see ui-screenshot-matrix skill).

## 2. Count the language

`node scripts/count-motion.mjs src/` prints distinct durations (interaction vs ambient), distinct curves, and token usage.
`--json` for CI. Heuristics: JS `duration: 200` is read as ms, `duration: 0.2` as seconds. Minified files are skipped.
Equivalent grep for a quick look:

```sh
grep -rEoh "cubic-bezier\([^)]*\)" src | sort | uniq -c | sort -rn
grep -rEoh "(transition|animation)(-duration)?:[^;]*[0-9.]+m?s" src | grep -Eo "[0-9.]+m?s" | sort | uniq -c | sort -rn
```

## 3. Performance run

```sh
node scripts/perf-trace.mjs --root ./dist --entry /index.html --out perf/before.json
node scripts/perf-trace.mjs --root ./dist --entry /index.html --mobile --cpu 4 --out perf/before-mobile.json
node scripts/perf-trace.mjs --root ./dist --entry /index.html --reduced-motion --out perf/before-rm.json
node scripts/perf-trace.mjs ... --trace perf/trace.json     # then open in DevTools Performance / ui.perfetto.dev
```

- `--root` serves a local folder without a server (`https://app.local`); `--mount /sub` if the site lives under a prefix;
  `--url https://...` to test a live page instead.
- `--steps steps.json` scripts the interaction. Steps: `scroll` (`"bottom"|"top"|px|selector`, `ms`), `click`, `hover`,
  `focus`, `press`, `type:{sel,text}`, `wait`, `eval`. Default is scroll to bottom and back.
- Output: `frames`, `over16_7` (>17.2 ms), `over33`, `p50`, `p95`, `maxFrameMs`, `longTasks`, `worstLongTaskMs`, `cls` (Web Vitals max session window during the post-settle interaction: ≤1 s gap, ≤5 s max span, excluding `hadRecentInput`), `layoutShiftSum` (total non-input shift sum over the same interaction window), `shifts`, `pass`.
- Default budget: ≤2 frames over 33 ms, interaction-window `cls` ≤ 0.02, no long task over 200 ms, no page errors. Adjust with
  `--max-over33 --max-cls --max-long`. Exit code 1 on failure, usable in CI. Note: `buffered: false` measures only the scripted interaction after `--settle`, not initial page-load CLS.
- Compare **before and after with identical flags**, ideally alternating two or three rounds (noise is real). Report the
  medians. Headless rAF is a proxy: say "not measured on a real device" if you did not.
- `--trace` slows the page. Use it to diagnose a bad run, never for the reported number.

## 4. Matrix to cover

reduced-motion on/off · mobile (390, CPU ×4) · desktop · dark/light · narrow window (~900) · long content · rapid repeats.
Record any combination you skipped.
