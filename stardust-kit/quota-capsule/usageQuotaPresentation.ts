import { readUiLocale } from "~/i18n";
import { uiText as copy } from "~/i18n";
import type { LimitPool } from "@t3tools/shared/usageLimits";
import { displayLimitWindows } from "@t3tools/shared/usageLimits";
import type { ServerProviderUsageLimits, ServerProviderUsageWindow } from "@t3tools/contracts";

export function quotaForecast(window: ServerProviderUsageWindow, now: number) {
  const resetAt = Date.parse(window.resetsAt ?? "");
  const duration = (window.windowDurationMins ?? 0) * 60_000;
  const startAt = resetAt - duration;
  const elapsed =
    duration > 0 && Number.isFinite(resetAt) && now >= startAt && now < resetAt
      ? (now - startAt) / duration
      : null;
  const used = Math.max(0, Math.min(100, window.usedPercent));
  const remaining = 100 - used;
  const projected = elapsed !== null && elapsed > 0.12 && used > 0 ? used / elapsed : null;
  const runOutAt = projected === null ? null : startAt + (duration * 100) / projected;
  return { elapsed, remaining, projected, runOutAt };
}

export function quotaForecastState(windows: readonly ServerProviderUsageWindow[], now: number) {
  const active = windows.filter((w) => !w.resetsAt || Date.parse(w.resetsAt) > now);
  const forecasts = active.map((w) => quotaForecast(w, now));
  const projected = Math.max(0, ...forecasts.map((f) => f.projected ?? 0));
  const left = Math.min(100, ...forecasts.map((f) => f.remaining));
  return projected >= 130 || left < 10 ? "early" : projected >= 95 || left < 30 ? "tight" : "ample";
}

export function quotaWindowLabel(label: string, chinese: boolean): string {
  if (!chinese) return label;
  return label
    .replace(/Claude\s*&\s*GPT\s*\(shared\)/gi, copy("Claude/GPT shared", undefined, "zh-CN"))
    .replace(/Claude\s*\/\s*GPT\s*shared/gi, copy("Claude/GPT shared", undefined, "zh-CN"))
    .replace(/\bWeekly\b/gi, copy("Weekly", undefined, "zh-CN"))
    .replace(/\bMonthly\b/gi, copy("Monthly", undefined, "zh-CN"))
    .replace(/\bDaily\b/gi, copy("Today", undefined, "zh-CN"))
    .replace(/\b(\d+)[ -]hours?\b/gi, copy("$1 hours", undefined, "zh-CN"))
    .replace(/\bSession\b/gi, copy("Current window", undefined, "zh-CN"));
}

export { quotaReadingStale } from "./quotaFreshness";
export function quotaReadingLabel(limits: ServerProviderUsageLimits | undefined) {
  const checked = Date.parse(limits?.checkedAt ?? "");
  const stamp = Number.isFinite(checked)
    ? new Date(checked).toLocaleTimeString(readUiLocale(), {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })
    : copy("Unknown time");
  return copy("Last reading {time} · Forecast unavailable", { time: stamp });
}

export function quotaPlanLabel(plan: string) {
  if (readUiLocale() !== "zh-CN") return plan;
  return plan
    .replace(/Subscription/gi, copy("Subscription"))
    .replace(/Grok account/gi, copy("Grok account"))
    .replace(/Google account/gi, copy("Google account."))
    .replace(/ChatGPT Pro (\d+) Subscription/gi, copy("ChatGPT Pro $1 Subscription"));
}

/** Antigravity only exposes Gemini to T3. Keep the shared third-party bucket informational. */
export function t3LimitWindows(pool: LimitPool) {
  return displayLimitWindows(pool).filter(
    (w) => pool.driver !== "antigravity" || w.id.startsWith("gemini-"),
  );
}
