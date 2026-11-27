// Shared helper: find Playwright, launch a browser, and serve a local folder WITHOUT a server.
// Requests to https://app.local/** are answered straight from disk; every other network call is aborted,
// so a run is offline, deterministic and leaves no process behind.
//
// Playwright lookup order: `import 'playwright'` -> node_modules above the cwd -> $PLAYWRIGHT_PATH
// (a node_modules dir or the playwright package dir). Install once with:  npm i -D playwright
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import { existsSync, statSync, realpathSync } from 'node:fs';
import { join, extname, resolve, relative, isAbsolute, sep } from 'node:path';

export async function loadPlaywright() {
  const tries = [
    () => import('playwright'),
    () => import(pathToFileURL(createRequire(join(process.cwd(), '_')).resolve('playwright')).href),
    () => {
      const p = process.env.PLAYWRIGHT_PATH;
      if (!p) throw new Error('no PLAYWRIGHT_PATH');
      const dir = existsSync(join(p, 'playwright')) ? join(p, 'playwright') : p;
      return import(pathToFileURL(createRequire(join(dir, '_')).resolve(dir)).href);
    },
  ];
  for (const t of tries) { try { const m = await t(); return m.chromium ? m : m.default; } catch {} }
  throw new Error('Playwright not found. Run `npm i -D playwright` (and `npx playwright install chromium`) or set PLAYWRIGHT_PATH.');
}

// PW_CHANNEL=chrome uses installed Google Chrome; default tries bundled Chromium, then falls back to Chrome.
export async function launch(pw, extra = {}) {
  const channel = process.env.PW_CHANNEL;
  if (channel) return pw.chromium.launch({ channel, ...extra });
  try { return await pw.chromium.launch(extra); }
  catch { return pw.chromium.launch({ channel: 'chrome', ...extra }); }
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.json': 'application/json',
  '.woff2': 'font/woff2', '.mp4': 'video/mp4', '.webm': 'video/webm' };
export const ORIGIN = 'https://app.local';

export function isInsideRoot(rootDir, targetPath) {
  const rel = relative(rootDir, targetPath);
  return rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel);
}

// mount: URL prefix that maps to `root` (e.g. '/stardust' if the site is deployed under /stardust/).
export async function serveFolder(ctx, root, mount = '') {
  const realRoot = existsSync(root) ? realpathSync(root) : resolve(root);
  mount = mount.replace(/\/$/, '');
  await ctx.route('**/*', async r => {
    const rawUrl = r.request().url();
    if (rawUrl.startsWith('data:') || rawUrl.startsWith('blob:') || rawUrl.startsWith('about:')) return r.continue();
    let u;
    try { u = new URL(rawUrl); } catch { return r.abort(); }
    if (u.origin !== ORIGIN) return r.abort();
    let p;
    try { p = decodeURIComponent(u.pathname); } catch { return r.fulfill({ status: 400, body: 'bad path' }); }
    if (mount && (p === mount || p.startsWith(mount + '/'))) p = p.slice(mount.length) || '/';
    let f = resolve(realRoot, '.' + (p.startsWith('/') ? p : '/' + p));
    if (!isInsideRoot(realRoot, f)) return r.fulfill({ status: 403, body: 'forbidden' });
    if (existsSync(f) && statSync(f).isDirectory()) f = join(f, 'index.html');
    if (!existsSync(f)) return r.fulfill({ status: 404, body: 'not found' });
    const realFile = realpathSync(f);
    if (!isInsideRoot(realRoot, realFile)) return r.fulfill({ status: 403, body: 'forbidden' });
    r.fulfill({ status: 200, contentType: TYPES[extname(realFile)] || 'application/octet-stream', body: await readFile(realFile) });
  });
}

// Tiny argv parser: --key value, --flag, repeated keys become arrays.
export function args(argv = process.argv.slice(2)) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    const k = a.slice(2), v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    out[k] = k in out ? [].concat(out[k], v) : v;
  }
  return out;
}

// Scripted interaction DSL shared by the perf and screenshot scripts. A step is one of:
//  {goto,url} {click:sel} {hover:sel} {focus:sel} {press:key} {type:{sel,text}} {scroll:"bottom"|"top"|px|sel,ms}
//  {wait:ms} {eval:"js"} {setTheme:"dark"|"light"}
export async function runSteps(page, steps = []) {
  for (const s of steps) {
    if ('click' in s) await page.click(s.click);
    else if ('hover' in s) await page.hover(s.hover);
    else if ('focus' in s) await page.focus(s.focus);
    else if ('press' in s) await page.keyboard.press(s.press);
    else if ('type' in s) await page.fill(s.type.sel, s.type.text);
    else if ('wait' in s) await page.waitForTimeout(s.wait);
    else if ('eval' in s) await page.evaluate(s.eval);
    else if ('scroll' in s) await smoothScroll(page, s.scroll, s.ms ?? 4000);
  }
}

// Human-paced scroll inside the page's own rAF loop, so frames stay smooth in video and traces.
export async function smoothScroll(page, to = 'bottom', ms = 8000) {
  await page.evaluate(([to, dur]) => new Promise(done => {
    const y0 = scrollY, t0 = performance.now();
    const target = () => {
      const max = Math.max(0, document.documentElement.scrollHeight - innerHeight);
      if (to === 'bottom') return max;
      if (to === 'top') return 0;
      if (typeof to === 'number') return Math.min(max, to);
      const el = document.querySelector(to); return el ? Math.min(max, el.getBoundingClientRect().top + scrollY - 80) : y0;
    };
    const ease = t => t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    (function step(now) {
      const f = Math.min(1, (now - t0) / dur);
      scrollTo({ top: Math.round(y0 + (target() - y0) * ease(f)), behavior: 'instant' });
      f < 1 ? requestAnimationFrame(step) : done();
    })(t0);
  }), [to, ms]);
}
