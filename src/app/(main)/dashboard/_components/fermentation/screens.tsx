"use client";

import { useMemo, useState } from "react";

import { CartesianGrid, Line, LineChart, ReferenceLine, XAxis, YAxis } from "recharts";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { correlations, explainProcess } from "@/lib/fermentation/insights";
import { type ProcessState, SCENARIOS, type SetpointKey } from "@/lib/fermentation/model";
import { downloadCsv, useFermentation, usePrediction } from "@/stores/fermentation-store";

import { PageHeader } from "../page-header";
import { AminoWheel, MoneyWheel, RunKpis, RunMeters } from "./board";
import { AlarmList, BatchControls, ReadingGrid, SensorCards, useActiveAlarms, YieldCard } from "./panels";
import { ProteinDesk } from "./protein-panel";
import { ReactorView } from "./reactor-view";
import { ArcMeter, Ring } from "./rings";
import { useRunSnapshot } from "./snapshot";

const chartConfig = {
  product: { label: "Product g/L", color: "var(--chart-1)" },
  dissolvedOxygen: { label: "DO %", color: "var(--chart-2)" },
  ph: { label: "pH", color: "var(--chart-3)" },
  temperature: { label: "Temperature", color: "var(--chart-4)" },
  compare: { label: "Other batch", color: "var(--chart-5)" },
} satisfies ChartConfig;

export function OverviewView() {
  const live = useFermentation((s) => s.live);
  const alarms = useActiveAlarms();
  const scenario = SCENARIOS.find((item) => item.id === live.scenario);
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={`${live.reactor} · ${live.name}`}
        description="Food-yeast batch on BR-101. The 3D model, sensors, score, and alerts share one state."
        actions={
          <>
            <Badge variant="outline">Yeast mode · simulated</Badge>
            <a className="text-sm underline" href="/dashboard/benchmark">
              Penicillin benchmark
            </a>
          </>
        }
      />
      <p className="text-muted-foreground text-sm">{scenario?.note}</p>
      <RunKpis />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <div className="flex flex-col gap-4 xl:col-span-7">
          <ReactorView />
          <SensorCards />
        </div>
        <div className="flex flex-col gap-4 xl:col-span-5">
          <RunMeters />
          <div className="grid gap-4 sm:grid-cols-2">
            <MoneyWheel />
            <AminoWheel />
          </div>
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <BatchControls />
        <div className="flex flex-col gap-4">
          <YieldCard />
          <Card>
            <CardHeader>
              <CardTitle>Active deviations</CardTitle>
              <CardDescription>
                {alarms.length} rule{alarms.length === 1 ? "" : "s"} firing now.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <AlarmList items={alarms} />
            </CardContent>
          </Card>
        </div>
      </div>
      <ReadingGrid />
      <ProteinDesk />
    </div>
  );
}

export function RunsView() {
  const live = useFermentation((s) => s.live);
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Live batch" description="The run in progress. Finish stores it with the demo history." />
      <RunKpis />
      <div className="grid gap-4 xl:grid-cols-12">
        <div className="xl:col-span-7">
          <BatchControls />
        </div>
        <div className="xl:col-span-5">
          <RunMeters />
        </div>
      </div>
      <ReadingGrid />
      <YieldCard />
      <p className="text-muted-foreground text-sm">
        Elapsed {live.state.tMin} of 600 planned minutes. Status: {live.status}.
      </p>
    </div>
  );
}

export function HistoryView() {
  const history = useFermentation((s) => s.history);
  const ends = history.flatMap((batch) => {
    const end = batch.samples.at(-1);
    return end ? [end] : [];
  });
  const meanProduct = ends.length ? ends.reduce((sum, row) => sum + row.product, 0) / ends.length : 0;
  const alarmCount = history.reduce((sum, batch) => sum + batch.alarms.length, 0);
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Batch history"
        description="Demo batches stay in this browser. A finished run is added here and, when Postgres is configured, written to fermentation_batches."
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader>
            <CardDescription>Stored batches</CardDescription>
            <CardTitle className="text-3xl tabular-nums">{history.length}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Mean end protein</CardDescription>
            <CardTitle className="text-3xl tabular-nums">{meanProduct.toFixed(2)} g/L</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Alarm crossings</CardDescription>
            <CardTitle className="text-3xl tabular-nums">{alarmCount}</CardTitle>
          </CardHeader>
        </Card>
      </div>
      <Card>
        <CardContent className="pt-4">
          {history.length === 0 ? (
            <p className="text-muted-foreground text-sm">No finished batches in this browser yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Batch</TableHead>
                  <TableHead>Scenario</TableHead>
                  <TableHead>Clock</TableHead>
                  <TableHead>Protein</TableHead>
                  <TableHead>Ethanol</TableHead>
                  <TableHead>DO</TableHead>
                  <TableHead>Alarms</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.map((batch) => {
                  const end = batch.samples.at(-1);
                  const span = end ? Math.min(1, end.tMin / 600) : 0;
                  return (
                    <TableRow key={batch.id}>
                      <TableCell>{batch.name}</TableCell>
                      <TableCell>{batch.scenario}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Ring compact value={span} label={`${Math.round(span * 100)}`} caption="" />
                          <span className="text-muted-foreground text-xs">{end ? `${end.tMin} min` : "—"}</span>
                        </div>
                      </TableCell>
                      <TableCell>{end ? `${end.product.toFixed(2)} g/L` : "—"}</TableCell>
                      <TableCell>{end ? `${end.ethanol.toFixed(2)} g/L` : "—"}</TableCell>
                      <TableCell>{end ? `${end.dissolvedOxygen.toFixed(1)}%` : "—"}</TableCell>
                      <TableCell>{batch.alarms.length}</TableCell>
                      <TableCell>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => downloadCsv(batch.samples, batch.id)}
                        >
                          CSV
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export function CompareView() {
  const history = useFermentation((s) => s.history);
  const [leftId, setLeftId] = useState(history[0]?.id ?? "");
  const [rightId, setRightId] = useState(history[1]?.id ?? history[0]?.id ?? "");
  const left = history.find((batch) => batch.id === leftId) ?? history[0];
  const right = history.find((batch) => batch.id === rightId) ?? history[1] ?? history[0];
  const data = useMemo(() => mergeSeries(left?.samples ?? [], right?.samples ?? []), [left, right]);
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Compare batches" description="Product concentration from two stored runs." />
      <div className="grid gap-3 md:grid-cols-2">
        <BatchPicker label="Batch A" value={left?.id ?? ""} onChange={setLeftId} />
        <BatchPicker label="Batch B" value={right?.id ?? ""} onChange={setRightId} />
      </div>
      <Card>
        <CardContent className="pt-4">
          <ChartContainer config={chartConfig} className="aspect-auto h-72">
            <LineChart data={data}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="t" unit=" min" />
              <YAxis />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Line dataKey="a" name="Batch A" stroke="var(--color-product)" dot={false} />
              <Line dataKey="b" name="Batch B" stroke="var(--color-compare)" dot={false} />
            </LineChart>
          </ChartContainer>
        </CardContent>
      </Card>
      <div className="grid gap-4 md:grid-cols-2">
        <BatchOutcome batch={left} />
        <BatchOutcome batch={right} />
      </div>
    </div>
  );
}

export function AlarmsView() {
  const live = useFermentation((s) => s.live);
  const sensitivity = useFermentation((s) => s.sensitivity);
  const setSensitivity = useFermentation((s) => s.setSensitivity);
  const active = useActiveAlarms();
  const { fault } = useRunSnapshot();
  const high = active.filter((item) => item.severity === "high").length;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Alarms"
        description="Rules on the live simulation. A tighter sensitivity fires sooner and can false-alarm. A looser one can miss a drift."
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <Card>
          <CardHeader>
            <CardTitle className="font-normal">Sensitivity {sensitivity}</CardTitle>
            <CardDescription>
              The ring is the false-alarm rate on the calibration curve. 0 is quieter. 100 alarms more often. Default is
              50.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="grid grid-cols-2">
              <Ring
                value={fault.falseAlarmPct / 100}
                label={`${fault.falseAlarmPct}%`}
                caption="False-alarm rate"
                tone="var(--chart-4)"
              />
              <ArcMeter
                value={fault.threshold > 0 ? Math.min(1, fault.score / (fault.threshold * 2)) : 0}
                label={fault.score.toFixed(2)}
                caption={`Score against threshold ${fault.threshold.toFixed(2)}`}
                tone={fault.fault ? "var(--destructive)" : "var(--chart-2)"}
              />
            </div>
            <Slider
              min={0}
              max={100}
              step={1}
              value={[sensitivity]}
              onValueChange={(value) => setSensitivity(value[0] ?? 50)}
            />
            <p className="text-muted-foreground text-sm">
              {active.length} firing now, {high} high. This batch has logged {live.alarms.length} crossings.
              Contamination is not confirmed.
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Firing now</CardTitle>
          </CardHeader>
          <CardContent>
            <AlarmList items={active} />
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>This batch</CardTitle>
          <CardDescription>Each row is a new crossing, not a repeat every step.</CardDescription>
        </CardHeader>
        <CardContent>
          <AlarmList items={[...live.alarms].reverse()} />
        </CardContent>
      </Card>
    </div>
  );
}

export function TrendsView() {
  const live = useFermentation((s) => s.live);
  const history = useFermentation((s) => s.history);
  const [otherId, setOtherId] = useState(history[0]?.id ?? "");
  const other = history.find((batch) => batch.id === otherId);
  const [keys, setKeys] = useState<Array<"product" | "dissolvedOxygen" | "ph" | "temperature">>([
    "product",
    "dissolvedOxygen",
  ]);
  const data = live.samples
    .filter((_, index) => index % 2 === 0)
    .map((row) => ({
      t: row.tMin,
      product: row.product,
      dissolvedOxygen: row.dissolvedOxygen,
      ph: row.ph,
      temperature: row.temperature,
      other: other?.samples.find((sample) => sample.tMin === row.tMin)?.product,
    }));
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Parameter trends"
        description="Live batch. The dashed line is the dissolved-oxygen setpoint. Highlighted minutes had an alarm."
      />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Ring
          value={Math.min(1, live.state.product / 20)}
          label={live.state.product.toFixed(1)}
          caption="Protein g/L now"
        />
        <Ring
          value={live.state.dissolvedOxygen / 100}
          label={`${live.state.dissolvedOxygen.toFixed(0)}%`}
          caption={`DO · setpoint ${live.setpoints.dissolvedOxygen.toFixed(0)}%`}
          tone="var(--chart-2)"
        />
        <Ring
          value={Math.min(1, live.state.ph / 7)}
          label={live.state.ph.toFixed(2)}
          caption={`pH · setpoint ${live.setpoints.ph.toFixed(2)}`}
          tone="var(--chart-3)"
        />
        <Ring
          value={Math.min(1, live.state.temperature / 40)}
          label={`${live.state.temperature.toFixed(1)}°`}
          caption={`Temp · setpoint ${live.setpoints.temperature.toFixed(1)}°C`}
          tone="var(--chart-4)"
        />
      </div>
      <div className="flex flex-wrap gap-2">
        {(["product", "dissolvedOxygen", "ph", "temperature"] as const).map((key) => (
          <Button
            key={key}
            type="button"
            size="sm"
            variant={keys.includes(key) ? "default" : "outline"}
            onClick={() =>
              setKeys((current) => (current.includes(key) ? current.filter((item) => item !== key) : [...current, key]))
            }
          >
            {chartConfig[key].label}
          </Button>
        ))}
      </div>
      <BatchPicker label="Overlay product from" value={otherId} onChange={setOtherId} />
      <Card>
        <CardContent className="pt-4">
          <ChartContainer config={chartConfig} className="aspect-auto h-80">
            <LineChart data={data}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="t" />
              <YAxis />
              <ChartTooltip content={<ChartTooltipContent />} />
              <ReferenceLine
                y={live.setpoints.dissolvedOxygen}
                stroke="var(--color-dissolvedOxygen)"
                strokeDasharray="4 4"
              />
              {keys.map((key) => (
                <Line key={key} dataKey={key} stroke={`var(--color-${key})`} dot={false} />
              ))}
              <Line dataKey="other" stroke="var(--color-compare)" dot={false} strokeDasharray="5 4" />
            </LineChart>
          </ChartContainer>
        </CardContent>
      </Card>
      <p className="text-muted-foreground text-sm">
        Alarm minutes: {live.alarms.map((item) => item.tMin).join(", ") || "none yet"}.
      </p>
    </div>
  );
}

export function InsightsView() {
  const live = useFermentation((s) => s.live);
  const prediction = usePrediction();
  const active = useActiveAlarms();
  const text = explainProcess(live.state, active, prediction);
  const links = correlations(live.samples);
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Insights"
        description="Numbers come from Model A (run) and Model B (amino-acid research row). The paragraph only restates them."
      />
      <RunKpis />
      <div className="grid gap-4 xl:grid-cols-12">
        <div className="xl:col-span-5">
          <RunMeters />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:col-span-7">
          <Card>
            <CardHeader>
              <CardTitle>What is happening?</CardTitle>
            </CardHeader>
            <CardContent className="text-sm">{text.happening}</CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Why might that be?</CardTitle>
            </CardHeader>
            <CardContent className="text-sm">{text.why}</CardContent>
          </Card>
          <Card className="sm:col-span-2">
            <CardHeader>
              <CardTitle>What next?</CardTitle>
            </CardHeader>
            <CardContent className="text-sm">{text.next}</CardContent>
          </Card>
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <YieldCard />
        <Card>
          <CardHeader>
            <CardTitle>Correlations in this batch</CardTitle>
            <CardDescription>
              Pearson r on the samples collected so far. The bar is the strength, not a cause.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            {links.ready ? (
              links.rows.map((row) => (
                <div key={`${row.left}-${row.right}`} className="flex flex-col gap-1">
                  <div className="flex justify-between">
                    <span>
                      {row.left} and {row.right}
                    </span>
                    <span className="tabular-nums">{row.r.toFixed(2)}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div className="h-full bg-primary" style={{ width: `${Math.min(100, Math.abs(row.r) * 100)}%` }} />
                  </div>
                </div>
              ))
            ) : (
              <p>{links.note}</p>
            )}
          </CardContent>
        </Card>
      </div>
      <ProteinDesk />
    </div>
  );
}

export function SettingsView() {
  const bounds = useFermentation((s) => s.bounds);
  const setBound = useFermentation((s) => s.setBound);
  const setpoints = useFermentation((s) => s.live.setpoints);
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Operating bounds"
        description="Sliders and recommendations stay inside these limits. The ring shows where the live setpoint sits between min and max. Power figures elsewhere are calculated, not metered."
      />
      <div className="grid gap-3 md:grid-cols-2">
        {(Object.keys(bounds) as SetpointKey[]).map((key) => {
          const span = bounds[key].max - bounds[key].min || 1;
          const placed = (setpoints[key] - bounds[key].min) / span;
          return (
            <Card key={key}>
              <CardHeader>
                <CardTitle className="text-base">{key}</CardTitle>
                <CardDescription>
                  Live {setpoints[key]} · allowed {bounds[key].min} to {bounds[key].max}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex items-center gap-4 text-sm">
                <Ring value={placed} label={String(setpoints[key])} caption="in bounds" />
                <label className="flex flex-col gap-1">
                  Min
                  <input
                    className="rounded-md border bg-background px-2 py-1"
                    type="number"
                    value={bounds[key].min}
                    onChange={(event) => setBound(key, "min", Number(event.target.value))}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  Max
                  <input
                    className="rounded-md border bg-background px-2 py-1"
                    type="number"
                    value={bounds[key].max}
                    onChange={(event) => setBound(key, "max", Number(event.target.value))}
                  />
                </label>
              </CardContent>
            </Card>
          );
        })}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Scenarios</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          {SCENARIOS.map((item) => (
            <p key={item.id}>
              <span className="font-medium">{item.label}.</span> {item.note}
            </p>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function BatchPicker({ label, value, onChange }: { label: string; value: string; onChange: (id: string) => void }) {
  const history = useFermentation((s) => s.history);
  return (
    <div className="flex flex-col gap-1 text-sm">
      {label}
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {history.map((batch) => (
            <SelectItem key={batch.id} value={batch.id}>
              {batch.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function BatchOutcome({
  batch,
}: {
  batch: { name: string; scenario: string; samples: ProcessState[]; alarms: { length: number } } | undefined;
}) {
  const end = batch?.samples.at(-1);
  if (!batch || !end) return null;
  const clock = Math.min(1, end.tMin / 600);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{batch.name}</CardTitle>
        <CardDescription>{batch.scenario}</CardDescription>
      </CardHeader>
      <CardContent className="flex items-center gap-4">
        <Ring value={clock} label={`${Math.round(clock * 100)}%`} caption="of 600 min" />
        <div className="grid flex-1 grid-cols-2 gap-2 text-sm">
          <Stat label="Protein" value={`${end.product.toFixed(2)} g/L`} />
          <Stat label="Ethanol" value={`${end.ethanol.toFixed(2)} g/L`} />
          <Stat label="Dissolved oxygen" value={`${end.dissolvedOxygen.toFixed(1)}%`} />
          <Stat label="Alarms" value={String(batch.alarms.length)} />
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className="font-medium tabular-nums">{value}</div>
    </div>
  );
}

function mergeSeries(left: ProcessState[], right: ProcessState[]) {
  const times = new Set<number>();
  for (const row of left) times.add(row.tMin);
  for (const row of right) times.add(row.tMin);
  return [...times]
    .sort((a, b) => a - b)
    .map((t) => ({
      t,
      a: left.find((row) => row.tMin === t)?.product,
      b: right.find((row) => row.tMin === t)?.product,
    }));
}
