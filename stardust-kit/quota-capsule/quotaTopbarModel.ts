import type { ServerProviderUsageWindow } from "@t3tools/contracts";
import { quotaAccounts, type QuotaAccount } from "@t3tools/shared/usageLimits";
export { quotaAccounts, type QuotaAccount } from "@t3tools/shared/usageLimits";
import * as Schema from "effect/Schema";

import { quotaReadingStale } from "./usageQuotaPresentation";

export const QUOTA_PREFERENCES_KEY = "t3code:quota-topbar:v1";
/** The top bar refreshes readings every 10 minutes while visible, so a reading this young still counts as current. */
export const QUOTA_TOPBAR_FRESH_MS = 30 * 60_000;
export const QUOTA_TOPBAR_REFRESH_MS = 10 * 60_000;
export const QuotaPreferencesSchema = Schema.Struct({
  pins: Schema.NullOr(Schema.Array(Schema.String)),
  pinsEdited: Schema.optionalKey(Schema.Boolean),
  windows: Schema.Record(Schema.String, Schema.String),
  showNames: Schema.Boolean,
  followSession: Schema.optionalKey(Schema.Boolean),
  /** False once the user reorders pins by hand; their order then wins over remaining quota. */
  sortByRemaining: Schema.optionalKey(Schema.Boolean),
});
export type QuotaPreferences = typeof QuotaPreferencesSchema.Type;
export const DEFAULT_QUOTA_PREFERENCES: QuotaPreferences = {
  pins: null,
  pinsEdited: false,
  windows: {},
  showNames: true,
  followSession: true,
  sortByRemaining: true,
};
export function quotaPins(
  preferences: QuotaPreferences,
  accounts: readonly QuotaAccount[],
): readonly string[] {
  if (preferences.pinsEdited === true && preferences.pins !== null)
    return [...new Set(preferences.pins)].slice(0, 4);
  const drivers = new Set<string>();
  const priority = ["codex", "claudeAgent", "antigravity"];
  return [...accounts]
    .sort(
      (a, b) =>
        (priority.indexOf(a.driver) < 0 ? 10 : priority.indexOf(a.driver)) -
        (priority.indexOf(b.driver) < 0 ? 10 : priority.indexOf(b.driver)),
    )
    .filter((a) => {
      if (
        !a.limits?.windows.length ||
        a.limits.unavailable?.reason === "unsupported" ||
        drivers.has(a.driver)
      )
        return false;
      drivers.add(a.driver);
      return true;
    })
    .slice(0, 3)
    .map((a) => a.id);
}
/** The login the open thread's provider instance signs in with, when it has a quota to show. */
export function followedQuotaAccount(
  accounts: readonly QuotaAccount[],
  current: { readonly environmentId: string; readonly instanceId: string } | null,
): QuotaAccount | null {
  if (current === null) return null;
  return (
    accounts.find(
      (account) =>
        account.limits?.windows.length &&
        account.limits.unavailable?.reason !== "unsupported" &&
        account.instances.some(
          (instance) =>
            instance.environmentId === current.environmentId &&
            instance.instanceId === current.instanceId,
        ),
    ) ?? null
  );
}

/**
 * Pinned accounts, plus the open thread's account first when it is not pinned and following is on.
 * The extra chip is never saved, so it leaves with the thread.
 */
export function quotaShownIds(
  preferences: QuotaPreferences,
  accounts: readonly QuotaAccount[],
  current: { readonly environmentId: string; readonly instanceId: string } | null,
): { readonly ids: readonly string[]; readonly followedId: string | null } {
  const pins = quotaPins(preferences, accounts);
  const followed =
    preferences.followSession === false ? null : followedQuotaAccount(accounts, current);
  if (followed === null) return { ids: pins, followedId: null };
  return {
    ids: pins.includes(followed.id) ? pins : [followed.id, ...pins].slice(0, 4),
    followedId: followed.id,
  };
}
export function quotaWindow(
  account: QuotaAccount,
  preferences: QuotaPreferences,
): ServerProviderUsageWindow | null {
  if (account.limits?.unavailable?.reason === "unsupported") return null;
  const wanted = preferences.windows[account.id];
  if (wanted) return account.limits?.windows.find((w) => `${w.kind}:${w.id}` === wanted) ?? null;
  return (
    account.limits?.windows.find((w) => w.kind === "weekly") ?? account.limits?.windows[0] ?? null
  );
}
export function quotaState(
  account: QuotaAccount,
  window: ServerProviderUsageWindow | null,
  now: number,
) {
  if (!window || !Number.isFinite(window.usedPercent))
    return { remaining: null, state: "unknown" as const };
  const reset = Date.parse(window.resetsAt ?? "");
  if (Number.isFinite(reset) && reset <= now)
    return { remaining: Math.round(100 - window.usedPercent), state: "reset" as const };
  const stale = quotaReadingStale(
    account.limits,
    now,
    account.connected,
    account.failed,
    QUOTA_TOPBAR_FRESH_MS,
  );
  return {
    remaining: Math.round(100 - Math.max(0, Math.min(100, window.usedPercent))),
    state: stale ? ("stale" as const) : ("current" as const),
  };
}

/** Keep quota derivation and subscribers asleep for catalog/status-only pushes. */
export function createQuotaAccountsSelector() {
  let previousInputs: readonly unknown[] | undefined;
  let previous: readonly QuotaAccount[] = [];
  return (presentations: Parameters<typeof quotaAccounts>[0]): readonly QuotaAccount[] => {
    const inputs = [...presentations].flatMap(([id, p]) => [
      id,
      p.entry.target.label,
      p.connection.phase,
      p.serverConfig === null,
      p.serverConfig?.usageLimitSources,
      p.serverConfig?.providers.length,
      ...(p.serverConfig?.providers ?? []).flatMap((provider) => [
        provider.instanceId,
        provider.driver,
        provider.enabled,
        provider.installed,
        provider.availability,
        provider.displayName,
        provider.accentColor,
        provider.auth,
        provider.usageLimits,
      ]),
    ]);
    if (
      previousInputs?.length === inputs.length &&
      inputs.every((value, i) => value === previousInputs![i])
    )
      return previous;
    previousInputs = inputs;
    previous = quotaAccounts(presentations);
    return previous;
  };
}

/**
 * The open thread's account first, then the most remaining quota first, unreadable accounts last.
 * Ties keep their original order.
 */
export function sortQuotaAccounts(
  accounts: readonly QuotaAccount[],
  preferences: QuotaPreferences,
  now: number,
  followedId: string | null,
): QuotaAccount[] {
  const rank = (account: QuotaAccount) => {
    if (account.id === followedId) return Number.POSITIVE_INFINITY;
    const { remaining } = quotaState(account, quotaWindow(account, preferences), now);
    return remaining ?? -1;
  };
  if (preferences.sortByRemaining === false) {
    // Manual order: keep the pinned order, with only the open thread's account moved to the front.
    return accounts.toSorted((a, b) => Number(b.id === followedId) - Number(a.id === followedId));
  }
  return accounts
    .map((account, index) => ({ account, index, rank: rank(account) }))
    .toSorted((a, b) => b.rank - a.rank || a.index - b.index)
    .map(({ account }) => account);
}
