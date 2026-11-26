import { Profiler } from "react";
import { limitSlotCandidates } from "./UsageLimitSlots";
import { providerClients } from "../settings/providerDriverMeta";
import { LIMIT_SLOTS_KEY, LimitSlotsToggle, UsageLimitSlots } from "./UsageLimitSlots";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { ProviderDriverKind } from "@t3tools/contracts";
import { collectLimitPools, type LimitAccount } from "@t3tools/shared/usageLimits";
import { act, render } from "../../../test/render";
import { testUiLocale } from "../../../test/uiLocale";
import { applyThemePalette } from "../../themePalette";
import { UsageLimitRings } from "./UsageLimitRings";
import { UsageResetTimeline, resetTimelineGeometry } from "./UsageResetTimeline";
import { UsageTokenChart } from "./UsageTokenChart";
import { UsageSkeleton } from "./UsageLoadingLayout";
import { UsageDetailsSheet } from "./UsageDetailsSheet";
import { UsageModelBars } from "./UsageModelBars";
import { analysisFixture, analysisHours } from "./usageAnalysis.fixture";
import { mergeUsageEnvironments, tokenPeriodTotals } from "./usageAnalysis";
import "~/index.css";
import "./usagePresentation.css";
import "./limitsV9.css";
function theme() {
  const root = document.documentElement,
    previous = root.getAttribute("style"),
    name = root.getAttribute("data-theme-id");
  applyThemePalette("apple", "light");
  return {
    [Symbol.dispose]() {
      if (previous === null) root.removeAttribute("style");
      else root.setAttribute("style", previous);
      if (name === null) root.removeAttribute("data-theme-id");
      else root.setAttribute("data-theme-id", name);
    },
  };
}
const now = Date.parse("2026-11-17T16:00:00Z");
function pools() {
  return collectLimitPools(
    ["codex", "antigravity"].map((driver, index): LimitAccount => ({
      key: driver,
      driver: ProviderDriverKind.make(driver),
      displayName: driver,
      email: undefined,
      plan: "Pro",
      accentColor: undefined,
      environments: [],
      sourceLabel: null,
      redeem: null,
      limits: {
        checkedAt: new Date(now).toISOString(),
        windows: Array.from({ length: index ? 3 : 1 }, (_, i) => ({
          id: `weekly-${i}`,
          kind: "weekly",
          label: `Weekly ${i}`,
          usedPercent: 80 - i * 20,
          windowDurationMins: 10080,
          resetsAt: new Date(now + 86400000 * (i + 3)).toISOString(),
        })),
      },
    })),
    now,
  );
}
it("aligns four quota-card sections and locates reset dots at actual instants", async () => {
  using _theme = theme();
  const data = pools();
  await using screen = await render(
    <div style={{ width: 1000 }}>
      <div data-usage-limit-grid>
        {data.map((pool) => (
          <section data-usage-card className="usage-limit-ring-card" key={pool.driver}>
            <UsageLimitRings pool={pool} now={now} label={pool.driver}>
              {pool.driver === "codex" ? <button type="button">使用</button> : null}
            </UsageLimitRings>
          </section>
        ))}
      </div>
      <UsageResetTimeline pools={data} now={now} />
    </div>,
  );
  const cards = [...screen.container.querySelectorAll<HTMLElement>(".usage-limit-ring-card")],
    rects = cards.map((c) => c.getBoundingClientRect());
  expect(rects[0]!.height).toBe(rects[1]!.height);
  expect(rects[0]!.width).toBe(rects[1]!.width);
  for (const selector of [
    "[data-usage-limit-header]",
    '[data-lv9~="v13-figure"]',
    "[data-usage-limit-windows]",
    ".usage-limit-action-slot",
  ]) {
    expect(cards[0]!.querySelector(selector)!.getBoundingClientRect().height).toBe(
      cards[1]!.querySelector(selector)!.getBoundingClientRect().height,
    );
  }
  const geometry = resetTimelineGeometry(now);
  for (const dot of screen.container.querySelectorAll("[data-reset-at]")) {
    expect(Number(dot.getAttribute("cx"))).toBeCloseTo(
      geometry.x(Number(dot.getAttribute("data-reset-at"))),
      5,
    );
  }
  expect(screen.container.querySelector("[data-timeline-gap]")).not.toBeNull();
});

it.each([false, true])("opens reset details on demand in the v9=%s layout", async (v9) => {
  using _theme = theme();
  using _locale = testUiLocale("zh-CN");
  const commit = vi.fn();
  const data = pools();
  await using screen = await render(
    <div data-lv9-root={v9 ? "" : undefined} style={{ width: 760 }}>
      <button id="usage-limit-codex" type="button">
        上方卡片
      </button>
      <Profiler id="resets" onRender={commit}>
        <UsageResetTimeline pools={data} now={now} v9={v9} />
      </Profiler>
      <button type="button">时间线之外</button>
    </div>,
  );
  const chart = screen.container.querySelector("[data-reset-calendar]")!;
  const rows = [...chart.querySelectorAll<SVGGElement>("[data-timeline-lane]")];
  const popover = () => chart.querySelector<HTMLElement>("[data-timeline-detail]");
  const lane = screen.getByRole("button", { name: /Codex ·/ });
  const codex = chart.querySelector<SVGGElement>('[data-timeline-lane="codex"]')!;
  const target = screen.container.querySelector<HTMLElement>("#usage-limit-codex")!;
  const scroll = vi.spyOn(target, "scrollIntoView").mockImplementation(() => {});
  const markup = chart.innerHTML;
  commit.mockClear();
  for (const row of rows) {
    const rect = row.querySelector("[data-timeline-row-hit]")!.getBoundingClientRect();
    // The middle of the row's vertical padding is now a hit target as well.
    const padding = document.elementFromPoint(rect.left + rect.width / 2, rect.top + 3);
    expect(padding?.closest("[data-timeline-lane]")).toBe(row);
    await userEvent.hover(page.elementLocator(row));
    await act(() => {
      row.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
      padding!.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      padding!.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
    });
  }
  expect(chart.innerHTML).toBe(markup);
  expect(commit).not.toHaveBeenCalled();
  expect(chart.querySelector("[data-usage-readout]")!.textContent).toBe(
    "点一行看详情，再点一次或按 Esc 收起",
  );

  await userEvent.click(lane);
  await expect.element(lane).toHaveAttribute("aria-expanded", "true");
  expect(popover()?.textContent).toContain("20% 剩余");
  expect(popover()?.querySelector(".usage-timeline-detail-gap")?.textContent).toMatch(
    /约 .*用不了/,
  );
  expect(
    codex.querySelector("[data-timeline-row-hit]")!.getBoundingClientRect().bottom,
  ).toBeLessThanOrEqual(popover()!.getBoundingClientRect().top);
  expect(getComputedStyle(popover()!).animationDuration).toBe("0.12s");
  expect(scroll).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "定位到上面的卡片 ↑" }));
  expect(scroll).toHaveBeenCalledExactlyOnceWith({ behavior: "smooth", block: "nearest" });
  await userEvent.keyboard("{Escape}");
  await expect.element(lane).toHaveFocus();
  expect(popover()).toBeNull();

  await userEvent.keyboard("{Enter}");
  await expect.element(lane).toHaveAttribute("aria-expanded", "true");
  await userEvent.tab();
  await expect.element(screen.getByRole("button", { name: "定位到上面的卡片 ↑" })).toHaveFocus();
  await userEvent.keyboard("{Escape}");
  await expect.element(lane).toHaveFocus();
  await userEvent.keyboard(" ");
  await expect.element(lane).toHaveAttribute("aria-expanded", "true");
  await userEvent.click(lane);
  await expect.element(lane).toHaveAttribute("aria-expanded", "false");

  await userEvent.click(lane);
  await userEvent.click(screen.getByRole("button", { name: "时间线之外" }));
  await expect.element(lane).toHaveAttribute("aria-expanded", "false");
  expect(popover()).toBeNull();
});

it("keeps the token readout above hovered bars without fading other bars", async () => {
  using _locale = testUiLocale("zh-CN");
  using _theme = theme();
  const data = analysisFixture();
  await using screen = await render(
    <div style={{ width: 700 }}>
      <UsageTokenChart
        periods={analysisHours}
        totals={tokenPeriodTotals(data, analysisHours, true)}
        formatPeriod={(p) => p.slice(11, 16)}
        selectedHour={null}
        onSelectHour={() => {}}
        hourly
      />
    </div>,
  );
  await userEvent.hover(screen.getByRole("button", { name: /13:52，/ }));
  const bar = screen.container.querySelector<HTMLElement>("[data-hovered] [data-usage-bar]")!,
    read = screen.container.querySelector<HTMLElement>("[data-usage-readout]")!;
  const a = bar.getBoundingClientRect(),
    b = read.getBoundingClientRect();
  expect(b.bottom).toBeLessThanOrEqual(a.top);
  expect(screen.container.querySelectorAll("[data-dim]")).toHaveLength(0);
  expect(read.textContent).toContain("1.60K");
});
it("fits 720 and 560 analysis panels without horizontal scrolling and keeps model readouts above data", async () => {
  using _theme = theme();
  const usage = mergeUsageEnvironments(analysisFixture());
  for (const width of [720, 560] as const) {
    await using screen = await render(
      <UsageDetailsSheet open width={width} onOpenChange={() => {}} title="分析">
        <UsageModelBars
          usage={usage}
          window={{
            resolution: "hour",
            hours: analysisHours,
            days: [],
            timeZone: "UTC",
            hour12: false,
            referenceTime: undefined,
          }}
          metric="cost"
        />
      </UsageDetailsSheet>,
    );
    for (const animation of document.getAnimations()) animation.finish();
    const panel = document.querySelector<HTMLElement>("[data-usage-sheet]")!;
    expect(panel.getBoundingClientRect().width).toBe(Math.min(width, window.innerWidth - 16));
    for (const element of [
      panel,
      ...panel.querySelectorAll<HTMLElement>(".usage-sheet-content,.usage-model-bars"),
    ])
      expect(element.scrollWidth).toBeLessThanOrEqual(element.clientWidth);
    const target = page.getByRole("dialog").getByRole("img", { name: /13:52 ·/ });
    await userEvent.hover(target);
    const read = panel.querySelector("[data-usage-readout]")!.getBoundingClientRect(),
      svg = panel.querySelector("svg")!.getBoundingClientRect();
    expect(read.bottom).toBeLessThanOrEqual(svg.top);
    expect(screen.container).toBeDefined();
  }
});
it("uses the new card and chart layout without a legacy loading skeleton", async () => {
  using _theme = theme();
  await using screen = await render(<UsageSkeleton />);
  expect(screen.container.querySelector("[data-usage-initial-loading]")).not.toBeNull();
  expect(screen.container.textContent).not.toMatch(/Processed tokens|总计/);
  expect(screen.container.querySelectorAll(".usage-kpi")).toHaveLength(4);
  expect(
    screen.container.querySelector("[data-usage-main-row] [data-usage-chart-card]"),
  ).not.toBeNull();
  expect(
    screen.container.querySelectorAll("[data-usage-bottom-row] [data-usage-card]"),
  ).toHaveLength(2);
});

it("fills only the final quota row, flips by keyboard with focus isolation and persists the slot toggle", async () => {
  using _theme = theme();
  const view = (n: number, width: number) => (
    <div data-usage-limit-page style={{ width }}>
      <LimitSlotsToggle />
      <div data-usage-limit-grid>
        {Array.from({ length: n }, (_, i) => (
          <div key={i} className="usage-limit-ring-card" />
        ))}
        <UsageLimitSlots realCount={n} connected={new Set(["codex"])} hidden={false} />
      </div>
    </div>
  );
  await using screen = await render(view(1, 1280));
  for (const n of [1, 2, 3, 4, 5, 6])
    for (const width of [1280, 860]) {
      await screen.rerender(view(n, width));
      await vi.waitFor(() =>
        expect(screen.container.querySelectorAll("[data-limit-slot]")).toHaveLength(
          Math.ceil(n / (width < 1100 ? 2 : 4)) * (width < 1100 ? 2 : 4) - n,
        ),
      );
    }
  await screen.rerender(view(1, 1280));
  const back = screen.getByRole("button", { name: /Empty slot 02, flip/ });
  await userEvent.click(back); // opens and moves focus to the front's close button
  await expect
    .element(screen.getByRole("button", { name: "Collapse recommendation" }).first())
    .toHaveFocus();
  await userEvent.keyboard("{Enter}"); // native button closes
  await expect.element(back).toHaveFocus();
  await userEvent.keyboard(" ");
  await expect
    .element(screen.getByRole("button", { name: "Collapse recommendation" }).first())
    .toHaveFocus();
  await userEvent.click(screen.getByRole("button", { name: "Empty slots: shown" }));
  expect(localStorage.getItem(LIMIT_SLOTS_KEY)).toBe("true");
  await userEvent.click(screen.getByRole("button", { name: "Empty slots: off" }));
  expect(localStorage.getItem(LIMIT_SLOTS_KEY)).toBe("false");
  localStorage.removeItem(LIMIT_SLOTS_KEY);
});

it("shows unknown Gemini allowance and keeps unused shared details static", async () => {
  using _locale = testUiLocale("zh-CN");
  const pool = pools()[1]!;
  const shared = {
    ...pool,
    accounts: pool.accounts.map((account) => ({
      ...account,
      limits: {
        ...account.limits,
        windows: [
          {
            id: "3p-weekly",
            kind: "weekly" as const,
            label: "Claude & GPT (shared)",
            usedPercent: 100,
            windowDurationMins: 10080,
            resetsAt: new Date(now + 86400000).toISOString(),
          },
        ],
      },
    })),
  };
  const fixture = collectLimitPools(shared.accounts, now)[0]!;
  await using screen = await render(
    <UsageLimitRings pool={fixture} now={now} label="Antigravity">
      {null}
    </UsageLimitRings>,
  );
  expect(screen.container.textContent).toContain("Gemini 未上报额度");
  expect(screen.container.textContent).not.toContain("充足");
  expect(screen.container.querySelector("[data-usage-figure]")?.textContent).toBe("?");
  await userEvent.click(screen.getByRole("button", { name: "Antigravity 燃尽详情" }));
  const detail = document.querySelector("[data-usage-sheet]");
  expect(detail?.textContent).toContain("星尘未使用");
  expect(detail?.querySelector(".usage-analysis-panel svg")).toBeNull();
  expect(detail?.textContent).not.toContain("预测");
});

it("fills every n5 and n6 final-row position from the runtime registry then custom then leaves space", async () => {
  const supported = providerClients.definitions.map((d) => d.driverKind);
  const view = (n: number, connected: ReadonlySet<string>) => (
    <div style={{ width: 1280 }}>
      <UsageLimitSlots realCount={n} connected={connected} hidden={false} />
    </div>
  );
  await using screen = await render(view(5, new Set(supported.slice(0, 5))));
  for (const n of [5, 6]) {
    const connected = new Set(supported.slice(0, n));
    const expected = [
      ...supported.filter((id) => id !== "openaiCompatible" && !connected.has(id)),
      "custom",
    ].slice(0, 8 - n);
    expect(limitSlotCandidates(connected).slice(0, 8 - n)).toEqual(expected);
    await screen.rerender(view(n, connected));
    await vi.waitFor(() =>
      expect(screen.container.querySelectorAll("[data-limit-slot]")).toHaveLength(8 - n),
    );
    const cards = Array.from(screen.container.querySelectorAll("[data-limit-slot]"));
    expected.forEach((id, i) =>
      expect(cards[i]?.textContent).toContain(
        id === "custom"
          ? "Custom model / API"
          : providerClients.get(ProviderDriverKind.make(id))!.label,
      ),
    );
    const allButOne = new Set(supported.slice(0, -1));
    await screen.rerender(view(n, allButOne));
    expect(
      Array.from(screen.container.querySelectorAll(".usage-slot-front h4")).map(
        (el) => el.textContent,
      ),
    ).toEqual([providerClients.definitions.at(-1)!.label, "Custom model / API"].slice(0, 8 - n));
    await screen.rerender(view(n, new Set(supported)));
    expect(screen.container.querySelectorAll("[data-limit-slot]")).toHaveLength(1);
    expect(screen.container.textContent).toContain("Custom model / API");
  }
});

it("fills the entire first row when no provider reports quota", async () => {
  using _theme = theme();
  await using screen = await render(
    <div style={{ width: 1200 }}>
      <div data-usage-limit-grid>
        <UsageLimitSlots realCount={0} connected={new Set()} hidden={false} />
      </div>
    </div>,
  );
  await vi.waitFor(() =>
    expect(screen.container.querySelectorAll("[data-limit-slot]")).toHaveLength(4),
  );
  await userEvent.click(screen.getByRole("button", { name: /Empty slot 01, flip/ }));
  await expect
    .element(screen.getByRole("button", { name: "Collapse recommendation" }))
    .toBeVisible();
});
