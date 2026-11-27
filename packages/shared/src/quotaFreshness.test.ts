import { describe, expect, it } from "vite-plus/test";
import { quotaReadingStale } from "./quotaFreshness.ts";

describe("quota reading age", () => {
  it("applies the consumer's time limit using the real clock", () => {
    const checked = Date.UTC(2026, 0, 1);
    const limits = { checkedAt: new Date(checked).toISOString(), windows: [] };
    const maxAgeMs = 30 * 60_000;
    expect(quotaReadingStale(limits, checked + maxAgeMs, true, false, maxAgeMs)).toBe(false);
    expect(quotaReadingStale(limits, checked + maxAgeMs + 1, true, false, maxAgeMs)).toBe(true);
    expect(quotaReadingStale(limits, checked, false, false, maxAgeMs)).toBe(true);
  });
});
