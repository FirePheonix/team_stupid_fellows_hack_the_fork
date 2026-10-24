"use client";

import { useEffect, useRef, useState } from "react";

import {
  Droplets,
  Fan,
  FlaskConical,
  Gauge,
  type LucideIcon,
  Pause,
  Play,
  RotateCcw,
  Square,
  Thermometer,
  Timer,
  Wheat,
  Wind,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { type Alarm, modelAlarms } from "@/lib/fermentation/insights";
import { SCENARIOS, type SetpointKey } from "@/lib/fermentation/model";
import { driversAt } from "@/lib/fermentation/model-a";
import { INFO } from "@/lib/fermentation/protein";
import { useFermentation, usePrediction } from "@/stores/fermentation-store";

const SETPOINT_FIELDS: { key: SetpointKey; label: string; step: number; digits: number; hint: string }[] = [
  { key: "ph", label: "pH setpoint", step: 0.05, digits: 2, hint: INFO.ph },
  { key: "temperature", label: "Temperature °C", step: 0.1, digits: 1, hint: INFO.temperature },
  { key: "dissolvedOxygen", label: "DO setpoint %", step: 1, digits: 0, hint: INFO.air },
  { key: "agitation", label: "Agitation rpm", step: 10, digits: 0, hint: INFO.agitation },
  { key: "aeration", label: "Aeration vvm", step: 0.05, digits: 2, hint: INFO.air },
  { key: "feedRate", label: "Feed rate", step: 0.05, digits: 2, hint: INFO.feed },
];

type DockKey = "scenario" | "speed" | SetpointKey;

type DockItem = {
  key: string;
  icon: LucideIcon;
  label: string;
  value: string;
  detail?: string;
  disabled?: boolean;
  pressed?: boolean;
  gapBefore?: boolean;
  pin?: DockKey;
  onClick: () => void;
};

export function BatchDock() {
  const live = useFermentation((s) => s.live);
  const bounds = useFermentation((s) => s.bounds);
  const speed = useFermentation((s) => s.speed);
  const start = useFermentation((s) => s.start);
  const pause = useFermentation((s) => s.pause);
  const reset = useFermentation((s) => s.reset);
  const finish = useFermentation((s) => s.finish);
  const setScenario = useFermentation((s) => s.setScenario);
  const setSetpoint = useFermentation((s) => s.setSetpoint);
  const setSpeed = useFermentation((s) => s.setSpeed);
  const [open, setOpen] = useState<DockKey | null>(null);
  const dockRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (dockRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest("[data-radix-popper-content-wrapper]")) return;
      setOpen(null);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function toggle(key: DockKey) {
    setOpen((value) => (value === key ? null : key));
  }

  const scenario = SCENARIOS.find((item) => item.id === live.scenario);
  const items: DockItem[] = [
    {
      key: "start",
      icon: Play,
      label: live.status === "paused" ? "Resume" : "Start",
      value: live.status === "paused" ? "Resume" : "Start",
      disabled: live.status === "running",
      onClick: start,
    },
    {
      key: "pause",
      icon: Pause,
      label: "Pause",
      value: "Pause",
      disabled: live.status !== "running",
      onClick: pause,
    },
    {
      key: "finish",
      icon: Square,
      label: "Finish",
      value: "Finish",
      disabled: live.status === "idle",
      onClick: finish,
    },
    {
      key: "reset",
      icon: RotateCcw,
      label: "Reset",
      value: "Reset",
      onClick: reset,
    },
    {
      key: "scenario",
      icon: FlaskConical,
      label: "Scenario",
      value: scenario?.label ?? "Scenario",
      detail: scenario?.note ?? "What this batch is asked to do.",
      pressed: open === "scenario",
      gapBefore: true,
      pin: "scenario",
      onClick: () => toggle("scenario"),
    },
    {
      key: "speed",
      icon: Timer,
      label: "Clock",
      value: `${speed}×`,
      detail: "How many simulated minutes pass on each tick.",
      pressed: open === "speed",
      pin: "speed",
      onClick: () => toggle("speed"),
    },
    {
      key: "ph",
      icon: Droplets,
      label: "pH",
      value: live.setpoints.ph.toFixed(2),
      detail: "Most comfortable at 5. Higher or lower slows growth. The broth tint follows this.",
      pressed: open === "ph",
      gapBefore: true,
      pin: "ph",
      onClick: () => toggle("ph"),
    },
    {
      key: "temperature",
      icon: Thermometer,
      label: "Temperature",
      value: `${live.setpoints.temperature.toFixed(1)}°C`,
      detail: "Most comfortable at 30°C. The jacket glow follows this.",
      pressed: open === "temperature",
      pin: "temperature",
      onClick: () => toggle("temperature"),
    },
    {
      key: "dissolvedOxygen",
      icon: Gauge,
      label: "Dissolved oxygen",
      value: `${live.setpoints.dissolvedOxygen.toFixed(0)}%`,
      detail: "Target for the oxygen controller. The green cap follows this. The tip follows the broth.",
      pressed: open === "dissolvedOxygen",
      pin: "dissolvedOxygen",
      onClick: () => toggle("dissolvedOxygen"),
    },
    {
      key: "agitation",
      icon: Fan,
      label: "Agitation",
      value: `${live.setpoints.agitation.toFixed(0)} rpm`,
      detail: "The impellers and the top fan turn at this speed.",
      pressed: open === "agitation",
      pin: "agitation",
      onClick: () => toggle("agitation"),
    },
    {
      key: "aeration",
      icon: Wind,
      label: "Aeration",
      value: `${live.setpoints.aeration.toFixed(2)} vvm`,
      detail: "Bubble count and the foam ring follow this.",
      pressed: open === "aeration",
      pin: "aeration",
      onClick: () => toggle("aeration"),
    },
    {
      key: "feedRate",
      icon: Wheat,
      label: "Feed",
      value: live.setpoints.feedRate.toFixed(2),
      detail: "Drops from the feed bottle follow this.",
      pressed: open === "feedRate",
      pin: "feedRate",
      onClick: () => toggle("feedRate"),
    },
  ];

  const openItem = items.find((item) => item.pin === open) ?? null;
  const field = SETPOINT_FIELDS.find((item) => item.key === open);

  return (
    <div
      ref={dockRef}
      className="fixed bottom-4 left-1/2 z-40 flex -translate-x-1/2 items-end gap-1 rounded-2xl border bg-background/80 px-3 py-2 shadow-2xl backdrop-blur-xl md:left-[calc(50%+var(--sidebar-width)/2)]"
    >
      {items.map((item) => {
        const Icon = item.icon;
        const tip = item.value === item.label ? item.label : `${item.label} · ${item.value}`;
        return (
          <div key={item.key} className="contents">
            {item.gapBefore ? <span className="mx-1 h-8 w-px self-center bg-border" /> : null}
            <div className="group relative">
              {item.pressed && openItem ? (
                <div className="absolute bottom-full left-1/2 z-10 mb-3 w-56 -translate-x-1/2 rounded-2xl border bg-background/90 p-3 shadow-2xl backdrop-blur-xl">
                  <p className="flex items-baseline justify-between gap-3 text-xs">
                    <span>{openItem.label}</span>
                    <span className="font-medium tabular-nums">{openItem.value}</span>
                  </p>
                  {openItem.detail ? <p className="mt-1 text-muted-foreground text-xs">{openItem.detail}</p> : null}
                  {openItem.pin === "scenario" ? (
                    <Select value={live.scenario} onValueChange={(value) => setScenario(value as typeof live.scenario)}>
                      <SelectTrigger className="mt-3 w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {SCENARIOS.map((option) => (
                          <SelectItem key={option.id} value={option.id}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : null}
                  {openItem.pin === "speed" ? (
                    <div className="mt-3 flex gap-2">
                      {([1, 4, 12] as const).map((value) => (
                        <Button
                          key={value}
                          type="button"
                          size="sm"
                          variant={speed === value ? "default" : "outline"}
                          onClick={() => setSpeed(value)}
                        >
                          {value}×
                        </Button>
                      ))}
                    </div>
                  ) : null}
                  {field ? (
                    <Slider
                      className="mt-3"
                      min={bounds[field.key].min}
                      max={bounds[field.key].max}
                      step={field.step}
                      value={[live.setpoints[field.key]]}
                      onValueChange={(value) => {
                        const next = value[0];
                        if (next !== undefined) setSetpoint(field.key, next);
                      }}
                    />
                  ) : null}
                </div>
              ) : (
                <span className="pointer-events-none absolute bottom-full left-1/2 mb-2 -translate-x-1/2 whitespace-nowrap rounded-md border bg-background/90 px-2 py-1 text-xs opacity-0 shadow-md backdrop-blur-xl group-hover:opacity-100">
                  {tip}
                </span>
              )}
              <button
                type="button"
                aria-label={tip}
                aria-pressed={item.pressed ?? false}
                disabled={item.disabled}
                onClick={item.onClick}
                className="flex size-11 items-center justify-center rounded-xl transition-transform hover:-translate-y-0.5 disabled:opacity-35 disabled:hover:translate-y-0"
              >
                <Icon
                  className={
                    item.pressed ? "size-5 text-foreground" : "size-5 text-muted-foreground group-hover:text-foreground"
                  }
                />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function BatchControls({ dock = false }: { dock?: boolean }) {
  const live = useFermentation((s) => s.live);
  const bounds = useFermentation((s) => s.bounds);
  const speed = useFermentation((s) => s.speed);
  const start = useFermentation((s) => s.start);
  const pause = useFermentation((s) => s.pause);
  const reset = useFermentation((s) => s.reset);
  const finish = useFermentation((s) => s.finish);
  const setScenario = useFermentation((s) => s.setScenario);
  const setSetpoint = useFermentation((s) => s.setSetpoint);
  const setSpeed = useFermentation((s) => s.setSpeed);

  const body = (
    <div className="flex flex-col gap-3">
      <p className="text-muted-foreground text-xs">
        Simulated measurements for this run. A scenario change takes effect on the next step.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={start} disabled={live.status === "running"}>
          {live.status === "paused" ? "Resume" : "Start"}
        </Button>
        <Button type="button" variant="outline" onClick={pause} disabled={live.status !== "running"}>
          Pause
        </Button>
        <Button type="button" variant="outline" onClick={finish} disabled={live.status === "idle"}>
          Finish
        </Button>
        <Button type="button" variant="outline" onClick={reset}>
          Reset
        </Button>
        <Badge variant="secondary">{live.status}</Badge>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="flex flex-col gap-1 text-sm">
          Scenario
          <Select value={live.scenario} onValueChange={(value) => setScenario(value as typeof live.scenario)}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SCENARIOS.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1 text-sm">
          Speed
          <Select value={String(speed)} onValueChange={(value) => setSpeed(Number(value) as 1 | 4 | 12)}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">1×</SelectItem>
              <SelectItem value="4">4×</SelectItem>
              <SelectItem value="12">12×</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className={dock ? "grid gap-3 sm:grid-cols-2 xl:grid-cols-3" : "grid gap-3 md:grid-cols-2"}>
        {SETPOINT_FIELDS.map((field) => (
          <div key={field.key} className="flex flex-col gap-1 text-sm">
            <span className="flex justify-between">
              <span title={field.hint}>
                {field.label}
                <button
                  type="button"
                  className="ml-1 inline-flex size-4 items-center justify-center rounded-full border text-[10px] leading-none"
                  title={field.hint}
                  aria-label={field.hint}
                >
                  i
                </button>
              </span>
              <span className="text-muted-foreground">{live.setpoints[field.key].toFixed(field.digits)}</span>
            </span>
            <Slider
              min={bounds[field.key].min}
              max={bounds[field.key].max}
              step={field.step}
              value={[live.setpoints[field.key]]}
              onValueChange={(value) => {
                const next = value[0];
                if (next !== undefined) setSetpoint(field.key, next);
              }}
            />
          </div>
        ))}
      </div>
    </div>
  );
  if (dock) return body;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Batch controls</CardTitle>
        <CardDescription>Simulated measurements. Changing a scenario takes effect on the next step.</CardDescription>
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  );
}

export function SensorCards() {
  const samples = useFermentation((s) => s.live.samples);
  const state = useFermentation((s) => s.live.state);
  const tail = samples.slice(-30);
  const cards: { label: string; value: string; series: number[] }[] = [
    { label: "pH", value: state.ph.toFixed(2), series: tail.map((row) => row.ph) },
    { label: "Temperature", value: `${state.temperature.toFixed(1)}°C`, series: tail.map((row) => row.temperature) },
    {
      label: "Dissolved oxygen",
      value: `${state.dissolvedOxygen.toFixed(1)}%`,
      series: tail.map((row) => row.dissolvedOxygen),
    },
  ];
  return (
    <div className="grid gap-3 md:grid-cols-3">
      {cards.map((card) => (
        <Card key={card.label}>
          <CardHeader>
            <CardDescription>{card.label}</CardDescription>
            <CardTitle>{card.value}</CardTitle>
          </CardHeader>
          <CardContent>
            <Spark values={card.series} />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export function ReadingGrid() {
  const state = useFermentation((s) => s.live.state);
  const rows = [
    ["Agitation", `${state.agitation.toFixed(0)} rpm`],
    ["Aeration", `${state.aeration.toFixed(2)} vvm`],
    ["Feed", state.feedRate.toFixed(2)],
    ["Biomass", `${state.biomass.toFixed(2)} g/L`],
    ["Substrate", `${state.substrate.toFixed(2)} g/L`],
    ["Off-gas CO2", state.co2.toFixed(2)],
    ["Protein", `${state.product.toFixed(2)} g/L`],
    ["Ethanol", `${state.ethanol.toFixed(2)} g/L`],
    ["Volume", `${state.volume.toFixed(0)} L`],
    ["Elapsed", `${state.tMin} min`],
  ];
  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {rows.map(([label, value]) => (
        <div key={label} className="min-w-28 shrink-0 rounded-lg border px-3 py-2">
          <div className="text-muted-foreground text-xs">{label}</div>
          <div className="font-medium tabular-nums">{value}</div>
        </div>
      ))}
    </div>
  );
}

export function YieldCard() {
  const prediction = usePrediction();
  const drivers = driversAt(prediction.frac).slice(0, 4);
  const topDriver = Math.max(...drivers.map((item) => item.importance), 0.01);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Predicted final protein</CardTitle>
        <CardDescription>
          Predicted from the run model (Model A, gradient-boosted trees trained on simulated yeast batches). Verified
          accuracy, on published data, is on Benchmark.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <div className="flex items-end justify-between">
          <span className="font-medium text-3xl tabular-nums">{prediction.kg.toFixed(1)}</span>
          <span className="text-muted-foreground">
            kg · 80% range {prediction.low.toFixed(1)}–{prediction.high.toFixed(1)}
          </span>
        </div>
        <div className="relative h-2 rounded-full bg-muted">
          <div
            className="absolute top-1/2 size-3 -translate-y-1/2 rounded-full bg-primary"
            style={{ left: `calc(${rangePos(prediction.low, prediction.kg, prediction.high)}% - 6px)` }}
          />
        </div>
        <p>Using samples up to {Math.round(prediction.frac * 100)}% of the batch. The dot sits inside the 80% range.</p>
        <ul className="space-y-2">
          {drivers.map((item) => (
            <li key={item.name} className="flex flex-col gap-1">
              <span className="flex justify-between">
                <span>{item.label}</span>
                <span className="text-muted-foreground tabular-nums">{item.importance.toFixed(2)} kg</span>
              </span>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full"
                  style={{
                    width: `${Math.min(100, (item.importance / topDriver) * 100)}%`,
                    background: "var(--chart-2)",
                  }}
                />
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

export function AlarmList({ items }: { items: Alarm[] }) {
  if (items.length === 0) return <p className="text-muted-foreground text-sm">No deviations at this sensitivity.</p>;
  return (
    <ul className="flex flex-col gap-2">
      {items.map((item) => (
        <li key={item.id} className="rounded-lg border px-3 py-2 text-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium">{item.parameter}</span>
            <Badge variant={item.severity === "high" ? "destructive" : "secondary"}>{item.severity}</Badge>
          </div>
          <p className="mt-1">{item.evidence}</p>
          <p className="text-muted-foreground">{item.reason}</p>
          {item.parameter === "off-gas CO2" ? (
            <p className="text-muted-foreground">Contamination is not confirmed.</p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/** Model A's fault detector on the live samples. */
export function useActiveAlarms() {
  const samples = useFermentation((s) => s.live.samples);
  const sensitivity = useFermentation((s) => s.sensitivity);
  return modelAlarms(samples, sensitivity);
}

function rangePos(low: number, value: number, high: number) {
  const span = high - low || 1;
  return Math.min(100, Math.max(0, ((value - low) / span) * 100));
}

function Spark({ values }: { values: number[] }) {
  if (values.length < 2) return <div className="h-8" />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * 100;
      const y = 28 - ((value - min) / span) * 24;
      return `${x},${y}`;
    })
    .join(" ");
  return (
    <svg viewBox="0 0 100 32" className="h-8 w-full text-foreground" aria-hidden>
      <polyline fill="none" stroke="currentColor" strokeWidth="1.5" points={points} />
    </svg>
  );
}
