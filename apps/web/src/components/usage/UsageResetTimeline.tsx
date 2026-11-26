import { useEffect, useId, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { useGT } from "gt-react";
import { limitPoolId, type LimitPool } from "@t3tools/shared/usageLimits";
import { readUiLocale } from "~/i18n";
import { useUiText } from "~/i18n/useUiText";
import { limitPoolTitles } from "./limitPoolTitle";
import {
  quotaForecast,
  quotaReadingStale,
  quotaWindowLabel,
  t3LimitWindows,
} from "./usageQuotaPresentation";

export function resetTimelineGeometry(now: number, v9 = false) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const dates = Array.from({ length: 8 }, (_, i) => {
    const day = new Date(start);
    day.setDate(day.getDate() + i);
    return day.getTime();
  });
  const left = v9 ? 165 : 112;
  const width = v9 ? 850 : 952;
  const x = (at: number) => {
    let day = dates.findIndex((end, i) => i > 0 && at < end) - 1;
    if (day < 0) day = at < dates[0]! ? 0 : 6;
    const from = dates[day]!;
    const until = dates[day + 1]!;
    return left + ((day + (at - from) / (until - from)) / 7) * width;
  };
  return { dates, x, left, width };
}

export function UsageResetTimeline({
  pools,
  now,
  v9 = false,
  resetPreview = null,
  onOpenResetPool,
}: {
  readonly pools: readonly LimitPool[];
  readonly now: number;
  readonly v9?: boolean;
  readonly resetPreview?: {
    readonly poolId: string;
    readonly fillsGap: boolean;
    readonly label: string;
  } | null;
  readonly onOpenResetPool?: ((poolId: string) => void) | undefined;
}) {
  const text = useUiText();
  const gt = useGT();
  const id = useId();
  const gapLabel = (milliseconds: number) => {
    if (milliseconds >= 86_400_000) {
      const count = Math.round(milliseconds / 86_400_000);
      return text(
        count === 1 ? "About {count} day without quota" : "About {count} days without quota",
        { count },
      );
    }
    const count = Math.max(1, Math.round(milliseconds / 3_600_000));
    return text(
      count === 1 ? "About {count} hour without quota" : "About {count} hours without quota",
      { count },
    );
  };
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedRow = useRef<SVGGElement | null>(null);
  const detail = useRef<HTMLDivElement | null>(null);
  const showCard = useRef<HTMLButtonElement | null>(null);
  const detailId = `${id}-reset-detail`;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Listen for document dismissal only while a reset detail is open.
  useEffect(() => {
    if (selectedId === null) return;
    const dismissOutside = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Node &&
        !selectedRow.current?.contains(target) &&
        !detail.current?.contains(target)
      ) {
        setSelectedId(null);
      }
    };
    const dismissOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) return;
      const row = selectedRow.current;
      if (!row?.isConnected) return;
      event.preventDefault();
      event.stopPropagation();
      setSelectedId(null);
      row.focus({ preventScroll: true });
    };
    document.addEventListener("pointerdown", dismissOutside, true);
    document.addEventListener("keydown", dismissOnEscape, true);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside, true);
      document.removeEventListener("keydown", dismissOnEscape, true);
    };
  }, [selectedId]);
  const { dates, x, left, width } = resetTimelineGeometry(now, v9);
  const stamp = (at: number) =>
    new Date(at).toLocaleString(readUiLocale(), {
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
  const titles = limitPoolTitles(pools);
  const lanes = pools
    .map((pool) => ({
      pool,
      name: titles.get(limitPoolId(pool)) ?? String(pool.driver),
      events: t3LimitWindows(pool)
        .flatMap((group) =>
          group.members.flatMap((member) => {
            const at = Date.parse(member.window.resetsAt ?? "");
            if (!(at > now && at < dates[7]!)) return [];
            return [
              {
                key: `${group.id}:${member.account.key}`,
                at,
                kind: member.window.kind,
                label: quotaWindowLabel(group.label, readUiLocale() === "zh-CN"),
                remaining: group.remainingPercent,
                runOut: quotaReadingStale(member.account.limits, now)
                  ? null
                  : quotaForecast(member.window, now).runOutAt,
              },
            ];
          }),
        )
        .toSorted((a, b) => a.at - b.at),
    }))
    .filter((lane) => lane.events.length > 0);
  if (!lanes.length) return null;

  const viewWidth = v9 ? 1040 : 1080;
  const rowHeight = v9 ? 56 : 64;
  const firstRow = v9 ? 60 : 70;
  const height = v9 ? Math.max(140, 72 + lanes.length * rowHeight) : 42 + lanes.length * rowHeight;
  const rows = lanes.map((lane, index) => {
    const gaps = lane.events.filter((event) => event.runOut !== null && event.runOut < event.at);
    const gap = v9
      ? gaps.toSorted((a, b) => b.at - b.runOut! - (a.at - a.runOut!))[0]
      : gaps.toSorted((a, b) => a.runOut! - b.runOut!)[0];
    const primary = lane.events.find((event) => event.kind === "weekly") ?? lane.events.at(-1)!;
    const anchor = gap ?? primary;
    const hasGap = Boolean(gap && (!v9 || gap.at > Math.max(now, gap.runOut!) + 1_800_000));
    return {
      ...lane,
      laneId: limitPoolId(lane.pool),
      y: firstRow + index * rowHeight,
      anchor,
      gap,
      hasGap,
      title:
        v9 && lane.pool.driver !== "antigravity" ? `${lane.name} · ${anchor.label}` : lane.name,
    };
  });
  const selected = rows.find((row) => row.laneId === selectedId);

  const rowProps = (lane: (typeof rows)[number]) => {
    const expanded = selectedId === lane.laneId;
    const toggle = (row: SVGGElement) => {
      selectedRow.current = row;
      setSelectedId((current) => (current === lane.laneId ? null : lane.laneId));
    };
    return {
      "data-timeline-lane": lane.laneId,
      role: "button",
      tabIndex: 0,
      "aria-label": `${lane.name} · ${lane.events.map((event) => stamp(event.at)).join(" · ")}`,
      "aria-expanded": expanded,
      "aria-controls": expanded ? detailId : undefined,
      onClick: (event: MouseEvent<SVGGElement>) => toggle(event.currentTarget),
      onKeyDown: (event: KeyboardEvent<SVGGElement>) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          if (!event.repeat) toggle(event.currentTarget);
        }
        if (event.key === "Tab" && !event.shiftKey && expanded) {
          event.preventDefault();
          showCard.current?.focus();
        }
      },
    };
  };
  const detailPopover = selected ? (
    <div
      key={selected.laneId}
      id={detailId}
      ref={detail}
      data-timeline-detail
      role="group"
      aria-label={selected.title}
      style={{
        left: `clamp(var(--timeline-detail-inset), calc(${(x(selected.anchor.at) / viewWidth) * 100}% - 30px), calc(100% - var(--timeline-detail-width) - var(--timeline-detail-inset)))`,
        top: `${((selected.y + rowHeight / 2 + 1) / height) * 100}%`,
      }}
    >
      <h4>{selected.title}</h4>
      {selected.events.map((event) => (
        <div key={event.key} className="usage-timeline-detail-event">
          <i
            aria-hidden="true"
            data-gap={(selected.hasGap && event === selected.gap) || undefined}
          />
          <span>
            {text("{percent}% remaining · {window} · resets {time}", {
              window: event.label,
              percent: Math.round(event.remaining),
              time: stamp(event.at),
            })}
          </span>
        </div>
      ))}
      {selected.hasGap && selected.gap?.runOut != null ? (
        <div className="usage-timeline-detail-gap">
          {gapLabel(selected.gap.at - selected.gap.runOut)}
        </div>
      ) : null}
      <button
        type="button"
        ref={showCard}
        onKeyDown={(event) => {
          if (event.key === "Tab" && event.shiftKey) {
            event.preventDefault();
            selectedRow.current?.focus({ preventScroll: true });
          }
        }}
        onClick={() =>
          document
            .getElementById(`usage-limit-${selected.laneId}`)
            ?.scrollIntoView({ behavior: "smooth", block: "nearest" })
        }
      >
        {gt("Show card above ↑")}
      </button>
    </div>
  ) : null;
  const hint = gt("Click a row for details. Click again or press Esc to close.");

  if (v9) {
    const L = left;
    const R = left + width;
    const W = width;
    const nowX = x(now);

    return (
      <div data-reset-calendar data-lv9="gantt-wrap">
        <div data-lv9="card-title">
          <span>{text("Resets this week")}</span>
          <span data-lv9="sub">{text("Dots show resets. Stripes show time without quota.")}</span>
        </div>
        <div data-lv9="gantt-readout" role="status" data-usage-readout>
          {hint}
        </div>
        <div className="usage-timeline-chart">
          <svg
            data-lv9="gantt-svg"
            viewBox={`0 0 ${viewWidth} ${height}`}
            role="group"
            aria-label={text("Quota resets over the next seven days")}
          >
            <defs>
              <pattern
                id={id}
                width="7"
                height="7"
                patternTransform="rotate(45)"
                patternUnits="userSpaceOnUse"
              >
                <line
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="7"
                  stroke="var(--v9-red)"
                  strokeWidth="2"
                  opacity="0.45"
                />
              </pattern>
            </defs>
            <rect
              x={L}
              y={24}
              width={W / 7}
              height={rows.length * rowHeight + 14}
              rx={8}
              fill="var(--fg)"
              opacity="0.035"
            />
            {dates.slice(0, 7).map((at, i) => {
              const colX = L + (i / 7) * W;
              const wd = new Date(at).toLocaleDateString(readUiLocale(), { weekday: "short" });
              return (
                <g key={at}>
                  <line
                    x1={colX}
                    y1={24}
                    x2={colX}
                    y2={rows.length * rowHeight + 36}
                    stroke="var(--hair)"
                  />
                  <text
                    x={colX + W / 14}
                    y={16}
                    textAnchor="middle"
                    fontSize="11"
                    fontWeight={i === 0 ? 700 : 500}
                    fill={i === 0 ? "var(--fg)" : "var(--fg-3)"}
                  >
                    {i === 0 ? `${wd}(${text("Today")})` : wd}
                  </text>
                </g>
              );
            })}
            <line
              data-timeline-now
              x1={nowX}
              y1={24}
              x2={nowX}
              y2={rows.length * rowHeight + 36}
              stroke="var(--ac)"
              strokeWidth="1.5"
              strokeDasharray="3 3"
            />
            <rect x={nowX - 16} y={22} width={32} height={15} rx={7} fill="var(--ac)" />
            <text
              x={nowX}
              y={33}
              textAnchor="middle"
              fontSize="9.5"
              fontWeight="700"
              fill="var(--v9-on-ac)"
            >
              {text("Now")}
            </text>
            {rows.map((lane) => {
              const { laneId, title, y, gap: gapEvent, hasGap, anchor: main } = lane;
              const runAt =
                hasGap && gapEvent?.runOut != null ? Math.max(now, gapEvent.runOut) : main.at;
              const runX = x(runAt);
              const resX = x(main.at);
              const laneCol = hasGap ? "var(--v9-red)" : "var(--v9-green)";
              const hasResetCredits = lane.pool.accounts.some(
                (account) =>
                  account.redeem && (account.limits.resetCredits?.availableCount ?? 0) > 0,
              );
              const showPreview = Boolean(
                resetPreview && resetPreview.poolId === laneId && resetPreview.fillsGap && hasGap,
              );
              return (
                <g key={laneId} {...rowProps(lane)}>
                  <rect
                    data-timeline-row-hit
                    x={-6}
                    y={y - rowHeight / 2}
                    width={viewWidth + 12}
                    height={rowHeight}
                    rx={10}
                  />
                  <text
                    x={L - 14}
                    y={y + 4}
                    textAnchor="end"
                    fontSize="12"
                    fontWeight={550}
                    fill="var(--fg)"
                  >
                    {title}
                  </text>
                  <rect x={L} y={y - 7} width={W} height={14} rx={7} fill="var(--fill)" />
                  <rect
                    x={nowX}
                    y={y - 7}
                    width={Math.max(8, runX - nowX)}
                    height={14}
                    rx={7}
                    fill={laneCol}
                    opacity={0.86}
                  />
                  {hasGap && gapEvent && gapEvent.runOut !== null ? (
                    <>
                      <rect
                        data-timeline-gap
                        x={runX}
                        y={y - 7}
                        width={Math.max(0, resX - runX)}
                        height={14}
                        rx={4}
                        fill={`url(#${id})`}
                        stroke="var(--v9-red)"
                        strokeWidth="0.8"
                        strokeDasharray="3 2"
                        opacity={showPreview ? 0.28 : 1}
                      />
                      {showPreview && resetPreview ? (
                        <>
                          <rect
                            data-timeline-gap-preview
                            x={runX}
                            y={y - 7}
                            width={Math.max(8, resX - runX)}
                            height={14}
                            rx={5}
                            fill="var(--v9-green)"
                            fillOpacity="0.28"
                            stroke="var(--v9-green)"
                            strokeWidth="1.6"
                            strokeDasharray="4 3"
                          />
                          <text
                            x={(runX + resX) / 2}
                            y={y - 12}
                            textAnchor="middle"
                            fontSize="10.5"
                            fontWeight="680"
                            fill="var(--ok)"
                          >
                            {text("Preview: fill gap with {label}", { label: resetPreview.label })}
                          </text>
                        </>
                      ) : (
                        <text
                          x={(runX + resX) / 2}
                          y={y - 12}
                          textAnchor="middle"
                          fontSize="10.5"
                          fontWeight="650"
                          fill="var(--bad)"
                        >
                          {gapLabel(gapEvent.at - gapEvent.runOut)}
                        </text>
                      )}
                      {hasResetCredits && onOpenResetPool ? (
                        <g
                          data-timeline-rc-trigger={laneId}
                          style={{ cursor: "pointer" }}
                          onClick={(event) => {
                            event.stopPropagation();
                            onOpenResetPool(laneId);
                          }}
                        >
                          <circle
                            cx={runX}
                            cy={y}
                            r={7.5}
                            fill="var(--surface)"
                            stroke="var(--warn)"
                            strokeWidth="2"
                          />
                          <circle cx={runX} cy={y} r={3} fill="var(--warn)" />
                          <title>
                            {text("Click to choose a reset credit for {provider}", {
                              provider: lane.name,
                            })}
                          </title>
                        </g>
                      ) : null}
                    </>
                  ) : null}
                  <rect
                    x={resX}
                    y={y - 5}
                    width={Math.max(8, R - resX)}
                    height={10}
                    rx={5}
                    fill={laneCol}
                    opacity="0.22"
                  />
                  <circle
                    data-reset-point
                    data-reset-at={main.at}
                    cx={resX}
                    cy={y}
                    r={6}
                    fill="var(--surface)"
                    stroke={laneCol}
                    strokeWidth="2.5"
                  />
                </g>
              );
            })}
          </svg>
          {detailPopover}
        </div>
      </div>
    );
  }

  return (
    <div data-reset-calendar className="usage-reset-timeline-wrap">
      <h2 className="usage-section-title">
        {text("Resets this week")}
        <span>{text("Dots show resets. Stripes show time without quota.")}</span>
      </h2>
      <section data-usage-card className="usage-reset-timeline">
        <div className="usage-timeline-readout" role="status" data-usage-readout>
          {hint}
        </div>
        <div className="usage-timeline-chart">
          <svg
            viewBox={`0 0 ${viewWidth} ${height}`}
            role="group"
            aria-label={text("Quota resets over the next seven days")}
          >
            <defs>
              <pattern
                id={id}
                width="6"
                height="6"
                patternUnits="userSpaceOnUse"
                patternTransform="rotate(45)"
              >
                <rect width="6" height="6" fill="var(--muted)" />
                <line
                  x1="0"
                  x2="0"
                  y1="0"
                  y2="6"
                  stroke="var(--primary)"
                  strokeWidth="1.6"
                  opacity=".45"
                />
              </pattern>
            </defs>
            {dates.slice(0, 7).map((at, i) => (
              <g key={at}>
                {i === 0 ? (
                  <rect
                    x={112}
                    y={0}
                    width={136}
                    height={height}
                    rx={8}
                    fill="var(--usage-today)"
                  />
                ) : (
                  <line x1={x(at)} x2={x(at)} y1={4} y2={height} stroke="var(--border)" />
                )}
                <text
                  x={x(at) + 8}
                  y={18}
                  fill={i === 0 ? "var(--primary)" : "var(--muted-foreground)"}
                >
                  {i === 0
                    ? text("Today")
                    : new Date(at).toLocaleDateString(readUiLocale(), { weekday: "short" })}
                  <tspan dx={8}>
                    {new Date(at).toLocaleDateString(readUiLocale(), {
                      month: "numeric",
                      day: "numeric",
                    })}
                  </tspan>
                </text>
              </g>
            ))}
            <line
              data-timeline-now
              x1={x(now)}
              x2={x(now)}
              y1={28}
              y2={height}
              stroke="var(--primary)"
              strokeWidth={1.5}
            />
            <text x={x(now) + 6} y={32} fill="var(--primary)">
              {text("Now")}{" "}
              {new Date(now).toLocaleTimeString(readUiLocale(), {
                hour: "2-digit",
                minute: "2-digit",
                hourCycle: "h23",
              })}
            </text>
            {rows.map((lane) => {
              const { laneId, y: cy, gap: early } = lane;
              let lastEnd = -Infinity;
              const hasResetCredits = lane.pool.accounts.some(
                (account) =>
                  account.redeem && (account.limits.resetCredits?.availableCount ?? 0) > 0,
              );
              const showPreview = Boolean(
                resetPreview && resetPreview.poolId === laneId && resetPreview.fillsGap && early,
              );
              return (
                <g key={laneId} {...rowProps(lane)}>
                  <rect
                    data-timeline-row-hit
                    x={0}
                    y={cy - rowHeight / 2}
                    width={viewWidth}
                    height={rowHeight}
                    rx={8}
                  />
                  <text x={0} y={cy - 2} className="usage-timeline-provider">
                    {lane.name}
                  </text>
                  <text x={0} y={cy + 14}>
                    {text("Lowest remaining {percent}%", {
                      percent: Math.round(Math.min(...lane.events.map((e) => e.remaining))),
                    })}
                  </text>
                  <line
                    x1={x(now)}
                    x2={1064}
                    y1={cy}
                    y2={cy}
                    stroke="var(--border)"
                    strokeWidth={6}
                    strokeLinecap="round"
                  />
                  <line
                    x1={x(now)}
                    x2={x(Math.max(now, early?.runOut ?? lane.events.at(-1)!.at))}
                    y1={cy}
                    y2={cy}
                    stroke="var(--usage-lane)"
                    strokeWidth={6}
                    strokeLinecap="round"
                  />
                  {early && early.runOut !== null ? (
                    <>
                      <rect
                        data-timeline-gap
                        x={x(Math.max(now, early.runOut))}
                        y={cy - 6}
                        width={Math.max(0, x(early.at) - x(Math.max(now, early.runOut)))}
                        height={12}
                        rx={3}
                        fill={`url(#${id})`}
                        opacity={showPreview ? 0.28 : 1}
                      />
                      {showPreview && resetPreview ? (
                        <>
                          <rect
                            data-timeline-gap-preview
                            className="usage-timeline-gap-preview"
                            x={x(Math.max(now, early.runOut))}
                            y={cy - 6}
                            width={Math.max(8, x(early.at) - x(Math.max(now, early.runOut)))}
                            height={12}
                            rx={4}
                          />
                          <text
                            className="usage-timeline-gap-preview-label"
                            x={(x(Math.max(now, early.runOut)) + x(early.at)) / 2}
                            y={cy + 30}
                            textAnchor="middle"
                          >
                            {text("Preview: fill gap with {label}", { label: resetPreview.label })}
                          </text>
                        </>
                      ) : (
                        <text
                          x={(x(Math.max(now, early.runOut)) + x(early.at)) / 2}
                          y={cy + 30}
                          textAnchor="middle"
                        >
                          {gapLabel(early.at - early.runOut)}
                        </text>
                      )}
                      {hasResetCredits && onOpenResetPool ? (
                        <g
                          data-timeline-rc-trigger={laneId}
                          className="usage-timeline-rc-dot"
                          onClick={(event) => {
                            event.stopPropagation();
                            onOpenResetPool(laneId);
                          }}
                        >
                          <title>
                            {text("Click to choose a reset credit for {provider}", {
                              provider: lane.name,
                            })}
                          </title>
                          <circle cx={x(Math.max(now, early.runOut))} cy={cy} r={7.5} />
                          <circle
                            className="usage-timeline-rc-core"
                            cx={x(Math.max(now, early.runOut))}
                            cy={cy}
                            r={3}
                          />
                        </g>
                      ) : null}
                    </>
                  ) : null}
                  {lane.events.map((e) => {
                    const right = x(e.at) > 930;
                    const below = x(e.at) < lastEnd + 12;
                    lastEnd = x(e.at) + 170;
                    return (
                      <g key={e.key}>
                        <circle
                          data-reset-point
                          data-reset-at={e.at}
                          cx={x(e.at)}
                          cy={cy}
                          r={6}
                          fill="var(--card)"
                          stroke="var(--primary)"
                          strokeWidth={2.5}
                        />
                        <text
                          x={x(e.at) + (right ? -10 : 10)}
                          y={below ? cy + 20 : cy - 12}
                          textAnchor={right ? "end" : "start"}
                          className="usage-timeline-event"
                        >
                          {stamp(e.at)} · {e.label}
                        </text>
                      </g>
                    );
                  })}
                </g>
              );
            })}
          </svg>
          {detailPopover}
        </div>
      </section>
    </div>
  );
}
