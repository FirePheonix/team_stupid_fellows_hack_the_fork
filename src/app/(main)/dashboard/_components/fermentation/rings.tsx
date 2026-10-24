"use client";

import { type ReactNode, useLayoutEffect, useRef, useState } from "react";

import type { LucideIcon } from "lucide-react";
import { createPortal } from "react-dom";
import { Label, Pie, PieChart } from "recharts";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

/** Closed ring. `value` is a fraction from 0 to 1. */
export function Ring({
  value,
  label,
  caption,
  tone = "var(--chart-1)",
  compact = false,
  info,
}: {
  value: number;
  label: string;
  caption: string;
  tone?: string;
  compact?: boolean;
  info?: ReactNode;
}) {
  const pct = clamp01(value);
  const radius = 36;
  const length = 2 * Math.PI * radius;
  return (
    <div className="flex flex-col items-center gap-1">
      <svg viewBox="0 0 96 96" className={compact ? "size-12 text-foreground" : "size-24 text-foreground"} aria-hidden>
        <circle cx="48" cy="48" r={radius} fill="none" stroke="var(--muted)" strokeWidth={compact ? 10 : 8} />
        <circle
          cx="48"
          cy="48"
          r={radius}
          fill="none"
          stroke={tone}
          strokeWidth={compact ? 10 : 8}
          strokeLinecap="round"
          strokeDasharray={`${length * pct} ${length}`}
          transform="rotate(-90 48 48)"
        />
        <text
          x="48"
          y="52"
          textAnchor="middle"
          fill="currentColor"
          className={compact ? "font-medium text-[18px]" : "font-medium text-[13px]"}
        >
          {label}
        </text>
      </svg>
      {caption || info ? (
        <div className="text-center text-muted-foreground text-xs">
          {caption}
          {info ? <span className="ms-1 inline-flex align-middle">{info}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

/** Top semicircle split into ticks, the same shape as an inventory gauge. */
export function ArcMeter({
  value,
  label,
  caption,
  tone = "var(--chart-2)",
  info,
}: {
  value: number;
  label: string;
  caption: string;
  tone?: string;
  info?: ReactNode;
}) {
  const segments = 28;
  const filled = Math.round(clamp01(value) * segments);
  const radius = 52;
  const cx = 70;
  const cy = 64;
  const ticks = Array.from({ length: segments }, (_, index) => {
    const start = 180 + index * (180 / segments) + 1.2;
    const end = 180 + (index + 1) * (180 / segments) - 1.2;
    return { d: arcPath(cx, cy, radius, start, end), on: index < filled };
  });
  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 140 78" className="h-20 w-full text-foreground" aria-hidden>
        {ticks.map((tick) => (
          <path
            key={tick.d}
            d={tick.d}
            fill="none"
            stroke={tick.on ? tone : "var(--muted)"}
            strokeWidth="8"
            strokeLinecap="round"
          />
        ))}
        <text x={cx} y={cy - 4} textAnchor="middle" fill="currentColor" className="font-medium text-sm">
          {label}
        </text>
      </svg>
      <div className="text-center text-muted-foreground text-xs">
        {caption}
        {info ? <span className="ms-1 inline-flex align-middle">{info}</span> : null}
      </div>
    </div>
  );
}

type BubbleBox = { top: number; left: number; width: number; maxHeight: number };

/** Hover bubble beside an (i). It stays inside the card that holds the meter. */
export function MeterInfo({ label, children }: { label: string; children: ReactNode }) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [box, setBox] = useState<BubbleBox | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const button = buttonRef.current;
      const bubble = bubbleRef.current;
      const card = button?.closest("[data-slot='card']");
      if (!button || !bubble || !(card instanceof HTMLElement)) return;
      const buttonBox = button.getBoundingClientRect();
      const cardBox = card.getBoundingClientRect();
      const pad = 8;
      const width = Math.min(240, cardBox.width - pad * 2);
      let left = buttonBox.left + buttonBox.width / 2 - width / 2;
      left = Math.max(cardBox.left + pad, Math.min(left, cardBox.right - width - pad));
      const maxHeight = Math.max(48, cardBox.height - pad * 2);
      const height = Math.min(bubble.getBoundingClientRect().height, maxHeight);
      if (height < 8) return;
      const gap = 6;
      let top = buttonBox.top - height - gap;
      if (top < cardBox.top + pad) top = buttonBox.bottom + gap;
      if (top + height > cardBox.bottom - pad) top = cardBox.bottom - pad - height;
      if (top < cardBox.top + pad) top = cardBox.top + pad;
      setBox((prev) => {
        if (
          prev &&
          Math.abs(prev.top - top) < 1 &&
          Math.abs(prev.left - left) < 1 &&
          prev.width === width &&
          prev.maxHeight === maxHeight
        ) {
          return prev;
        }
        return { top, left, width, maxHeight };
      });
    };
    place();
    const frame = requestAnimationFrame(place);
    const bubble = bubbleRef.current;
    const observer = new ResizeObserver(place);
    if (bubble) observer.observe(bubble);
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-expanded={open}
        className="inline-flex size-4 items-center justify-center rounded-full border text-[10px] text-muted-foreground leading-none hover:text-foreground"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
      >
        i
      </button>
      {open
        ? createPortal(
            <div
              ref={bubbleRef}
              role="tooltip"
              style={{
                position: "fixed",
                top: box?.top ?? -9999,
                left: box?.left ?? 0,
                width: box?.width ?? 240,
                maxHeight: box?.maxHeight,
                visibility: box ? "visible" : "hidden",
              }}
              className="pointer-events-none z-50 overflow-auto rounded-xl border bg-popover p-2 text-left text-muted-foreground text-xs shadow-lg"
            >
              {children}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

function arcPath(cx: number, cy: number, radius: number, startDeg: number, endDeg: number) {
  const start = (Math.PI / 180) * startDeg;
  const end = (Math.PI / 180) * endDeg;
  const x1 = cx + radius * Math.cos(start);
  const y1 = cy + radius * Math.sin(start);
  const x2 = cx + radius * Math.cos(end);
  const y2 = cy + radius * Math.sin(end);
  return `M ${x1} ${y1} A ${radius} ${radius} 0 0 1 ${x2} ${y2}`;
}

export function KpiTile({
  icon: Icon,
  label,
  value,
  note,
  badge,
  hint,
  hintLabel,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  note: string;
  badge?: string;
  hint?: ReactNode;
  hintLabel?: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <div className="flex size-7 items-center justify-center rounded-lg border bg-muted text-muted-foreground">
            <Icon className="size-4" />
          </div>
        </CardTitle>
        <CardDescription className="flex items-center gap-1">
          {label}
          {hint ? <MeterInfo label={hintLabel ?? label}>{hint}</MeterInfo> : null}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <div className="font-medium text-3xl tabular-nums leading-none tracking-tight">{value}</div>
          {badge ? <Badge variant="secondary">{badge}</Badge> : null}
        </div>
        <p className="text-muted-foreground text-sm">{note}</p>
      </CardContent>
    </Card>
  );
}

export function SplitWheel({
  title,
  center,
  caption,
  slices,
}: {
  title: string;
  center: string;
  caption: string;
  slices: { key: string; label: string; value: number }[];
}) {
  const config: ChartConfig = { value: { label: title } };
  slices.forEach((slice, index) => {
    config[slice.key] = { label: slice.label, color: `var(--chart-${(index % 5) + 1})` };
  });
  const data = slices.map((slice) => ({
    ...slice,
    fill: `var(--color-${slice.key})`,
  }));
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle className="font-normal">{title}</CardTitle>
        <CardDescription>{caption}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ChartContainer config={config} className="mx-auto aspect-square h-44 w-full">
          <PieChart>
            <ChartTooltip content={<ChartTooltipContent hideLabel />} />
            <Pie data={data} dataKey="value" nameKey="label" innerRadius={52} outerRadius={72} strokeWidth={2}>
              <Label
                content={({ viewBox }) => {
                  if (viewBox && "cx" in viewBox && "cy" in viewBox) {
                    return (
                      <text textAnchor="middle" x={viewBox.cx} y={viewBox.cy}>
                        <tspan className="fill-foreground font-medium text-lg" x={viewBox.cx} y={(viewBox.cy ?? 0) - 4}>
                          {center}
                        </tspan>
                        <tspan className="fill-muted-foreground text-[10px]" x={viewBox.cx} y={(viewBox.cy ?? 0) + 12}>
                          {total > 0 ? "of the packet" : "empty"}
                        </tspan>
                      </text>
                    );
                  }
                  return null;
                }}
              />
            </Pie>
          </PieChart>
        </ChartContainer>
        <ul className="flex flex-col gap-1 text-xs">
          {slices.map((slice) => (
            <li key={slice.key} className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">{slice.label}</span>
              <span className="tabular-nums">{slice.value.toLocaleString()}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
