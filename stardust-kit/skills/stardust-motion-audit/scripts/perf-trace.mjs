#!/usr/bin/env node
// Measure smoothness during a scripted interaction: long tasks, frames over 16.7 / 33 ms, interaction-window CLS
// (Web Vitals max session window: <=1s gap, <=5s max span, excluding hadRecentInput), layoutShiftSum, p95 frame time.
// ("over16_7" counts frames > 17.2 ms = 16.7 plus 0.5 ms timer jitter; "over33" counts frames > 33.3 ms.)
// Optionally throttles the CPU (mobile proxy) and writes a Chrome trace you can open in DevTools / Perfetto.
//
//   node perf-trace.mjs --root ./site --entry /index.html [--steps steps.json] [--mobile] [--cpu 4]
//                       [--reduced-motion] [--trace out/trace.json] [--out out/perf.json] [--label before]
//   node perf-trace.mjs --url https://example.com/ ...            (live URL instead of a local folder)
//
// steps.json example (omit it for a default top-to-bottom scroll):
//   [{"scroll":"bottom","ms":6000},{"click":"#tab-2"},{"wait":300},{"hover":".card"},{"press":"Escape"},{"scroll":"top","ms":3000}]
// Run it once on the baseline and once after the change with the same flags, then compare the two JSON files.
// Caveats: headless rAF cadence is a proxy for a real device; absolute numbers matter less than before/after.
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { readFileSync } from 'node:fs';
import { loadPlaywright, launch, serveFolder, ORIGIN, args, runSteps } from './_pw.mjs';

const o = args();
const entry = o.entry || '/';
const steps = o.steps ? JSON.parse(readFileSync(o.steps, 'utf8')) : [{ scroll: 'bottom', ms: 6000 }, { wait: 300 }, { scroll: 'top', ms: 3000 }];
const pw = await loadPlaywright();
const browser = await launch(pw);
const ctx = await browser.newContext({
  ...(o.mobile ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : { viewport: { width: 1440, height: 900 } }),
  ...(o['reduced-motion'] ? { reducedMotion: 'reduce' } : {}),
});
if (!o.url) await serveFolder(ctx, o.root || '.', o.mount || '');
const page = await ctx.newPage();
const errors = []; page.on('pageerror', e => errors.push(e.message));
const cdp = await ctx.newCDPSession(page);
if (o.cpu) await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(o.cpu) });

await page.goto(o.url || ORIGIN + entry, { waitUntil: 'load' });
await page.waitForTimeout(Number(o.settle ?? 1000)); // let intro animations finish; they are not the interaction under test

if (o.trace) await browser.startTracing(page, { categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'blink.user_timing', 'loading'] });
await page.evaluate(() => {
  const long = [], shifts = [], frames = []; let raf, last = performance.now();
  const obs = [];
  for (const [type, sink] of [['longtask', long], ['layout-shift', shifts]]) {
    try { const ob = new PerformanceObserver(l => sink.push(...l.getEntries())); ob.observe({ type, buffered: false }); obs.push(ob); } catch {}
  }
  const tick = now => { frames.push(now - last); last = now; raf = requestAnimationFrame(tick); };
  raf = requestAnimationFrame(tick);
  window.__perfStop = () => {
    cancelAnimationFrame(raf); obs.forEach(x => x.disconnect());
    const f = frames.slice(1), sorted = [...f].sort((a, b) => a - b);
    const pct = p => sorted.length ? +sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))].toFixed(1) : 0;
    const validShifts = shifts.filter(e => !e.hadRecentInput);
    let cls = 0, winVal = 0, winStart = 0, prevTime = 0;
    for (const e of validShifts) {
      const t = e.startTime;
      if (!winVal || t - prevTime > 1000 || t - winStart > 5000) {
        winStart = t; winVal = e.value;
      } else {
        winVal += e.value;
      }
      prevTime = t;
      if (winVal > cls) cls = winVal;
    }
    const layoutShiftSum = validShifts.reduce((s, e) => s + e.value, 0);
    return {
      frames: f.length, over16_7: f.filter(x => x > 17.2).length, over33: f.filter(x => x > 33.3).length,
      maxFrameMs: sorted.length ? +sorted.at(-1).toFixed(1) : 0, p50: pct(.5), p95: pct(.95),
      longTasks: long.length, longTaskMs: +long.reduce((s, e) => s + e.duration, 0).toFixed(0),
      worstLongTaskMs: long.length ? +Math.max(...long.map(e => e.duration)).toFixed(0) : 0,
      cls: +cls.toFixed(4), layoutShiftSum: +layoutShiftSum.toFixed(4), shifts: validShifts.length,
    };
  };
});
await runSteps(page, steps);
await page.waitForTimeout(300);
const m = await page.evaluate(() => window.__perfStop());
if (o.trace) { await mkdir(dirname(o.trace), { recursive: true }); await writeFile(o.trace, await browser.stopTracing()); }

const report = { label: o.label || '', entry: o.url || entry, mobile: !!o.mobile, cpuThrottle: Number(o.cpu || 1), reducedMotion: !!o['reduced-motion'], ...m, pageErrors: errors };
// Budgets: tweak to taste. A run "passes" when interaction stays smooth and nothing jumps.
const budget = { over33: Number(o['max-over33'] ?? 2), cls: Number(o['max-cls'] ?? 0.02), worstLongTaskMs: Number(o['max-long'] ?? 200) };
report.pass = m.over33 <= budget.over33 && m.cls <= budget.cls && m.worstLongTaskMs <= budget.worstLongTaskMs && !errors.length;
report.budget = budget;
console.log(JSON.stringify(report, null, 2));
if (o.out) { await mkdir(dirname(o.out), { recursive: true }); await writeFile(o.out, JSON.stringify(report, null, 2)); }
await browser.close();
process.exitCode = report.pass ? 0 : 1;
// Tip: --trace adds heavy overhead (frames get slower, budgets may fail). Use it to DIAGNOSE a failing run, then
// re-measure without --trace for the number you report.
