# Install “Quota chips” in your workbench

Status: **In Stardust**. Shown only when a provider reports quota readings.

Send the prompt below to Claude Code / Codex / T3 Code as is:

```text
Using `QuotaTopbar.tsx`, `quotaTopbar.module.css`, `quotaTopbarModel.ts` in `stardust-kit/quota-capsule/`, add a set of “quota chips” to my workbench top bar:
Install the adjacent `quotaFreshness.ts` and `usageQuotaPresentation.ts` into the quota component directory together. The freshness function depends only on a contract type and supports the 30-minute window on older hosts.
1. One chip per subscription: an 18px progress ring + name + remaining percentage + window abbreviation; the number turns amber at 20% or less;
2. Clicking a chip opens a panel with each subscription’s 5-hour and weekly windows, progress bars and reset times, with Refresh and Done buttons; Esc closes it;
3. Pin up to four chips, store the preference locally and sort by remaining quota by default;
4. Grey out and label readings older than 30 minutes, and refresh every 10 minutes;
5. Feed it from the quota API your project already has; hard-code no accounts or paths. Then run lint, typecheck and the QuotaTopbar browser tests.
```
