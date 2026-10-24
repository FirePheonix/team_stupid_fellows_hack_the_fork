"use client";

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

export function BatchControls() {
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

  return (
    <Card>
      <CardHeader>
        <CardTitle>Batch controls</CardTitle>
        <CardDescription>Simulated measurements. Changing a scenario takes effect on the next step.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
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
        <div className="grid gap-3 md:grid-cols-2">
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
      </CardContent>
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
    <div className="grid gap-2 sm:grid-cols-3">
      {rows.map(([label, value]) => (
        <div key={label} className="rounded-lg border px-3 py-2">
          <div className="text-muted-foreground text-xs">{label}</div>
          <div className="font-medium">{value}</div>
        </div>
      ))}
    </div>
  );
}

export function YieldCard() {
  const prediction = usePrediction();
  const drivers = driversAt(prediction.frac).slice(0, 4);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Predicted final protein</CardTitle>
        <CardDescription>
          Predicted from the run model (Model A, gradient-boosted trees trained on held-out-tested yeast batches).
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        <div className="flex items-end justify-between">
          <span className="font-medium text-3xl">{prediction.kg.toFixed(1)}</span>
          <span className="text-muted-foreground">
            kg · 80% range {prediction.low.toFixed(1)}–{prediction.high.toFixed(1)}
          </span>
        </div>
        <p>Using samples up to {Math.round(prediction.frac * 100)}% of the batch.</p>
        <ul className="space-y-1">
          {drivers.map((item) => (
            <li key={item.name} className="flex justify-between">
              <span>{item.label}</span>
              <span className="text-muted-foreground">importance {item.importance.toFixed(2)} kg</span>
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
