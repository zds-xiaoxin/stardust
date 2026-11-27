---
name: stardust-motion-audit
description: >-
  Audit and unify UI motion by STATE CHANGE (appear/disappear, move, resize, content/icon swap, number change,
  press/hover, load/complete/error), then fix, measure and verify it. Use when asked to "review/audit/unify the
  animations", "make the motion consistent", "this feels janky/jumpy", "add a transition/animation token system",
  "check prefers-reduced-motion", "measure animation performance / long tasks / CLS", or in Chinese:
  "动效审计", "动画统一", "动效规范", "过渡太生硬/太跳", "检查有没有跳变/闪烁/卡顿", "加载/完成/出错的变化没有过渡",
  "减少动态效果适配", "动画性能测试". Works for any web UI; includes the Stardust token table as a reference.
---

# Stardust Motion Audit (state-change method)

Authored by the Stardust project, MIT License. Generic: nothing here depends on Stardust code.

## The one question

Audit by **state change**, not by component list. Find every place where something changes state and ask:

> Does the user understand this change? Did it jump, or did it come and go with a clear cause?

State changes: **appear / disappear · move · resize · content swap · icon swap · number change ·
press / hover · load / complete / error**. Scope runs from a page transition down to one icon, one number, one checkmark.

## Standards (what "good" means)

1. **Motion explains.** It shows where a thing came from, where it went, what it relates to. Not decoration.
2. **One language.** The same kind of change uses the same curve and rhythm. Unify what exists; do not invent per place.
3. **Restraint.** Fast, light, never stealing the scene. Repeated actions get faster. Less motion beats messy motion.
4. **Follow the hand, stay interruptible.** Drags/resizes track the pointer directly (no transition on the dragged thing);
   re-triggering mid-animation continues naturally from the current value instead of restarting or queueing.
5. **No performance cost.** Animate only what is needed (prefer `transform` + `opacity`), keep a steady frame rate even
   with long content. Measure before you ship.
6. **No new problems.** No jitter, flash, relayout or overflow. Respect `prefers-reduced-motion`.
7. **Holds everywhere.** Mobile, narrow windows, wide screens, dark and light themes.

## Workflow

1. **Baseline first.** Run `scripts/count-motion.mjs <src>`: how many distinct durations and curves exist? Run
   `scripts/perf-trace.mjs` on the current build with a scripted interaction and keep the JSON as "before".
2. **Inventory.** Walk the UI state by state and fill the table in `references/inventory-template.md`:
   `trigger → what moves → duration/curve → problem → fix`. Include states with NO motion (a jump is a finding).
   Use slow motion (`scripts/slowmo.js`, 0.25×) to see what really happens; do not trust the code.
   Note: `slowmo.js` only slows CSS transitions/animations and WAAPI; for `requestAnimationFrame`/Canvas/timer motion,
   use the `--motion-scale` token multiplier (Variant B in `scripts/slowmo.js`) or the component's own time scale.
3. **Pick tokens, do not invent.** Map every row to a token in `references/tokens.md` (press/hover/swap/exit/enter/
   expand/pop). Only add a named token (reveal/travel/sky/ambient…) when no row fits, and document why.
4. **Fix** with the smallest change: unify durations/curves, merge opacity+transform to one timing, cancel stale timers,
   remove transitions from dragged elements, make reversals continue from the current value.
5. **Verify.** Re-run the same scripts with the same flags. Check: fast reversal (trigger, then undo mid-animation),
   keyboard focus, `--reduced-motion`, mobile + CPU throttle, dark and light, narrow and wide. Compare before/after JSON.
6. **Report** counts (distinct durations/curves before → after), the inventory table, perf numbers, and what you did NOT
   verify. Never claim "all states checked" unless every row was replayed.

## Review checklist per change type

- **Appear/disappear:** enter slower than exit? Does it animate from where it logically comes from? No layout jump of siblings?
- **Move/reorder:** neighbours make room (FLIP) instead of teleporting? Interruptible?
- **Resize/expand:** height jumps? If you must animate layout, document it as an exception and measure it.
- **Content/icon swap:** crossfade or morph at `swap` speed; the old value must not linger or flash.
- **Number change:** show the true value immediately unless counting conveys real progress; no fake count-ups.
- **Press/hover:** 80/120 ms, colour/opacity/transform only, focus ring instant.
- **Load/complete/error:** is there a visible start, end and failure state? Does an async result arriving late write to a stale element?
- **Scroll-driven:** progress bound to scroll position stays linear; discrete reactions use the shared easing.

## Files

- `references/method.md` – the method in depth, scope walk, edge cases (interrupts, stale callbacks, SSR flash).
- `references/tokens.md` – token table, curves, documented exceptions, extra tokens for scroll/ambient/mascot motion.
- `references/inventory-template.md` – the table to fill, with worked rows.
- `references/review-and-perf.md` – slow-motion review, reduced-motion, perf script usage, how to read the numbers.
- `references/lessons.md` – lessons from auditing the Stardust product site and desktop app.
- `references/tokens.css`, `references/tokens.ts` – drop-in token definitions (CSS custom properties + TS mirror).
- `scripts/count-motion.mjs` – count distinct durations/curves (CSS/SCSS/TS/JS/HTML). No dependencies.
- `scripts/slowmo.js` – slow-motion helper for CSS transitions/animations & WAAPI (DevTools or `addInitScript`; rAF/Canvas uses `--motion-scale`).
- `scripts/perf-trace.mjs` – Playwright run: long tasks, frames >16.7/33 ms, interaction-window CLS (max session window) + `layoutShiftSum`, optional Chrome trace. Needs pre-installed `playwright`.
- `scripts/_pw.mjs` – shared helper (locate Playwright, offline `https://app.local` folder router with strict root/origin boundary, step DSL).

## Output contract

Deliver: (1) the filled inventory, (2) before/after counts from `count-motion`, (3) before/after perf JSON,
(4) a list of exceptions and anything unverified. Keep prose short.
