import type { ServerProviderUsageLimits } from "@t3tools/contracts";

export function quotaReadingStale(
  limits: ServerProviderUsageLimits | undefined,
  now: number,
  connected = true,
  failed = false,
  maxAgeMs = 10 * 60_000,
) {
  const checked = Date.parse(limits?.checkedAt ?? "");
  return (
    !connected ||
    failed ||
    limits?.unavailable?.reason === "probeFailed" ||
    !Number.isFinite(checked) ||
    now - checked > maxAgeMs
  );
}
