#!/usr/bin/env node
// Proportion check against an original. Measures, then places original and candidate side by side (and as a
// difference overlay). Rule: UNIFORM SCALE ONLY. The candidate may be bigger or smaller, but width and height must
// scale by the same factor; any stretch, squash or per-axis fudge is a FAIL. Never "fix" proportions by stretching.
//
// Parts use the FIRST VISIBLE match inside the root element.
// A. Two images (checks outer image aspect ratio only; does not detect inner distortion inside a same-ratio canvas):
//   node proportion-check.mjs --orig original.png --cand candidate.png --out check.png [--tol 0.01]
// B. Two live elements (local HTML files served offline via https://app.local, or http(s) URLs), plus optional --parts:
//   node proportion-check.mjs --orig-html orig.html --orig-sel "#hero" --cand-html cand.html --cand-sel "#hero"
//        [--orig-root ./orig-site] [--cand-root ./cand-site] --parts ".logo,.title,.cta" --viewport 1200x800 --out check.png [--tol 0.01]
// Output: scale factors, aspect-ratio error, per-part normalised position/size deltas, PASS/FAIL, and the sheet PNG.
// Exit code 1 on FAIL. --tol is a fraction (0.01 = 1%).
import { readFileSync } from 'node:fs';
import { resolve, dirname, join, relative, sep } from 'node:path';
import { mkdirSync } from 'node:fs';
import { loadPlaywright, launch, serveFolder, ORIGIN, isInsideRoot, args } from './_pw.mjs';

const o = args();
const tol = Number(o.tol ?? 0.01);
const out = resolve(o.out || 'proportion-check.png');
mkdirSync(dirname(out), { recursive: true });
const [vw, vh] = String(o.viewport || '1200x800').split('x').map(Number);
const pw = await loadPlaywright();
const browser = await launch(pw);

async function capture(src, sel, parts, file, rootOverride) {
  const ctx = await browser.newContext({ viewport: { width: vw, height: vh }, reducedMotion: 'reduce' });
  let targetUrl = src;
  if (!/^https?:\/\//i.test(src)) {
    const absFile = resolve(src.replace(/^file:\/\//i, ''));
    let rootDir = rootOverride ? resolve(rootOverride) : dirname(absFile);
    if (!isInsideRoot(rootDir, absFile)) rootDir = dirname(absFile);
    await serveFolder(ctx, rootDir);
    const relPath = relative(rootDir, absFile).split(sep).map(encodeURIComponent).join('/');
    targetUrl = `${ORIGIN}/${relPath}`;
  }
  const page = await ctx.newPage();
  await page.goto(targetUrl, { waitUntil: 'load' }); await page.waitForTimeout(600);
  const el = page.locator(sel).first(); await el.scrollIntoViewIfNeeded();
  const box = await el.boundingBox(); await el.screenshot({ path: file });
  const rel = [];
  for (const p of parts) {
    const b = await el.locator(p + ' >> visible=true').first().boundingBox({ timeout: 1500 }).catch(() => null);
    rel.push(b ? { part: p, x: (b.x - box.x) / box.width, y: (b.y - box.y) / box.height, w: b.width / box.width, h: b.height / box.height } : { part: p, missing: true });
  }
  await ctx.close();
  return { box, rel };
}

let origImg = o.orig, candImg = o.cand, partsO = [], partsC = [], boxO, boxC;
if (o['orig-html']) {
  const parts = o.parts ? String(o.parts).split(',') : [];
  const dir = join(dirname(out), '_capture'); mkdirSync(dir, { recursive: true });
  const a = await capture(o['orig-html'], o['orig-sel'] || 'body', parts, join(dir, 'orig.png'), o['orig-root']);
  const b = await capture(o['cand-html'], o['cand-sel'] || 'body', parts, join(dir, 'cand.png'), o['cand-root']);
  origImg = join(dir, 'orig.png'); candImg = join(dir, 'cand.png'); partsO = a.rel; partsC = b.rel; boxO = a.box; boxC = b.box;
}
if (!origImg || !candImg) { console.error('need --orig/--cand images or --orig-html/--cand-html'); process.exit(2); }

const dataUrl = f => 'data:image/png;base64,' + readFileSync(f).toString('base64');
const sheet = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await sheet.setContent(`<body style="margin:0;background:#888"><img id=a src="${dataUrl(origImg)}"><img id=b src="${dataUrl(candImg)}"></body>`);
const nat = await sheet.evaluate(() => ['a', 'b'].map(i => { const e = document.getElementById(i); return { w: e.naturalWidth, h: e.naturalHeight }; }));
const [A, B] = nat;
const sx = B.w / A.w, sy = B.h / A.h;
const stretch = Math.abs(sx / sy - 1);                     // 0 = perfectly uniform
const checks = [{ name: 'uniform scale (sx vs sy)', value: stretch, ok: stretch <= tol }];
for (let i = 0; i < partsO.length; i++) {
  const p = partsO[i], q = partsC[i];
  if (p.missing || q.missing) { checks.push({ name: `part ${p.part}`, value: NaN, ok: false, note: 'missing in ' + (p.missing ? 'original' : 'candidate') }); continue; }
  const d = Math.max(Math.abs(p.x - q.x), Math.abs(p.y - q.y), Math.abs(p.w - q.w), Math.abs(p.h - q.h));
  checks.push({ name: `part ${p.part} (max Δ of x,y,w,h as fraction of root)`, value: d, ok: d <= tol });
}
const pass = checks.every(c => c.ok);

// Place both at the SAME HEIGHT with one factor each (uniform), then add a difference overlay at the original's scale.
const H = 560, wa = Math.round(A.w * H / A.h), wb = Math.round(B.w * H / B.h);
const label = (t, c = '#fff') => `<div style="font:600 14px system-ui;color:${c};margin:0 0 6px">${t}</div>`;
await sheet.setViewportSize({ width: Math.max(1200, wa + wb + wa + 100), height: H + 120 });
await sheet.setContent(`<body style="margin:0;padding:16px;background:#2a2a2e;display:flex;gap:20px;align-items:flex-start;font-family:system-ui">
 <div>${label(`original ${A.w}×${A.h}`)}<img src="${dataUrl(origImg)}" style="height:${H}px;display:block;outline:1px solid #f0f4"></div>
 <div>${label(`candidate ${B.w}×${B.h}  (scale ${sx.toFixed(3)} × ${sy.toFixed(3)})`)}<img src="${dataUrl(candImg)}" style="height:${H}px;display:block;outline:1px solid #0f04"></div>
 <div>${label('difference (candidate scaled uniformly to original height)', pass ? '#9f9' : '#f99')}<div style="position:relative;height:${H}px;width:${wa}px;background:#000"><img src="${dataUrl(origImg)}" style="position:absolute;inset:0;height:${H}px"><img src="${dataUrl(candImg)}" style="position:absolute;left:0;top:0;height:${H}px;mix-blend-mode:difference"></div></div></body>`);
await sheet.waitForTimeout(300);
await sheet.screenshot({ path: out, fullPage: true });

console.log(`original ${A.w}×${A.h}, candidate ${B.w}×${B.h}; scale x=${sx.toFixed(4)} y=${sy.toFixed(4)}; aspect error ${(stretch * 100).toFixed(2)}%`);
for (const c of checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}: ${isNaN(c.value) ? c.note : (c.value * 100).toFixed(2) + '%'} (tol ${(tol * 100).toFixed(1)}%)`);
console.log(pass ? 'RESULT: PASS (uniform scale)' : 'RESULT: FAIL. Fix the layout, not the scale. Do not stretch to match.');
if (!partsO.length) console.log('note: outer box/image ratio checked only; inspect the diff sheet (or pass --orig-html/--cand-html with --parts) to catch inner geometry distortion.');
console.log('sheet →', out);
await browser.close();
process.exitCode = pass ? 0 : 1;
