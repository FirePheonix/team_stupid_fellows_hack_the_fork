"use client";

import { useState } from "react";

import { Area, CartesianGrid, ComposedChart, Line, LineChart, ReferenceLine, XAxis, YAxis } from "recharts";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { Slider } from "@/components/ui/slider";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import replayJson from "@/lib/fermentation/benchmark-replay.json";
import reportJson from "@/lib/fermentation/benchmark-report.json";

import { ReactorView } from "../../_components/fermentation/reactor-view";
import { Ring } from "../../_components/fermentation/rings";
import { PageHeader } from "../../_components/page-header";

type ReplayBatch = {
  batch: number;
  fault: boolean;
  totalT: number;
  alarmH: number | null;
  onsetH: number | null;
  hours: number[];
  predT: number[];
  halfT: number[];
  faultScore: number[];
  doMgL: number[];
  tempC: number[];
  pH: number[];
  volumeL: number[];
  penicillinGL: number[];
};
type YieldRow = {
  frac: number;
  t_h: number;
  n: number;
  model_mape: number;
  baseline_mean_mape: number;
  baseline_so_far_mape: number;
  coverage_80: number;
};

const REPLAY = replayJson as unknown as { threshold: number; batches: ReplayBatch[] };
const REPORT = reportJson as unknown as {
  yield: YieldRow[];
  fault: {
    false_alarm_batches_pct: number;
    detection_pct: number;
    median_delay_h: number | null;
    normal_test_batches: number;
  };
  units_note: string;
  yield_without_harvest_time: YieldRow[];
  model_comparison_at_80pct: { extra_trees: number; fnn_64_32: number; fnn_128_64_32: number };
};

const LABEL: Record<number, string> = {
  80: "Batch 80 · held-out normal",
  93: "Batch 93 · fault, largest harvest",
  99: "Batch 99 · fault, one of the smallest",
};

const predConfig = {
  band: { label: "80% band", color: "var(--chart-2)" },
  pred: { label: "Predicted total, t", color: "var(--chart-1)" },
} satisfies ChartConfig;
const scoreConfig = { score: { label: "Fault score", color: "var(--chart-4)" } } satisfies ChartConfig;

export function BenchmarkView() {
  const [batchId, setBatchId] = useState(REPLAY.batches[0]?.batch ?? 80);
  const batch = REPLAY.batches.find((b) => b.batch === batchId) ?? REPLAY.batches[0];
  const [cursor, setCursor] = useState(0);
  if (!batch) return null;
  const i = Math.min(cursor, batch.hours.length - 1);
  const shown = batch.hours.slice(0, i + 1).map((h, k) => ({
    h,
    pred: batch.predT[k],
    band: [(batch.predT[k] ?? 0) - (batch.halfT[k] ?? 0), (batch.predT[k] ?? 0) + (batch.halfT[k] ?? 0)],
    score: batch.faultScore[k],
  }));
  const hour = batch.hours[i] ?? 0;
  const alarmed = batch.alarmH !== null && hour >= batch.alarmH;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Benchmark"
        description="Penicillin, IndPenSim. This is not the yeast protein run. Trained only on this published dataset. Each replay is predicted by a model that never saw that batch."
        actions={
          <a className="text-sm underline" href="/dashboard/runs">
            Yeast mode
          </a>
        }
      />
      <ReactorView
        readings={{
          dissolvedOxygen: `${(batch.doMgL[i] ?? 0).toFixed(1)} mg/L`,
          temperature: `${(batch.tempC[i] ?? 0).toFixed(1)} °C`,
          ph: (batch.pH[i] ?? 0).toFixed(2),
          broth: `${Math.round(batch.volumeL[i] ?? 0).toLocaleString()} L`,
          sparger: `${(batch.penicillinGL[i] ?? 0).toFixed(1)} g/L penicillin`,
          impeller: batch.fault ? "fault batch" : "normal batch",
          motor: `hour ${hour}`,
        }}
      />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Ring value={(i + 1) / batch.hours.length} label={`${hour} h`} caption="Replay clock" />
        <Ring
          value={batch.totalT > 0 ? Math.min(1, (batch.predT[i] ?? 0) / batch.totalT) : 0}
          label={(batch.predT[i] ?? 0).toFixed(1)}
          caption={`Predicted t · recorded ${batch.totalT.toFixed(2)} t`}
          tone="var(--chart-2)"
        />
        <Ring
          value={Math.min(1, (batch.penicillinGL[i] ?? 0) / 10)}
          label={(batch.penicillinGL[i] ?? 0).toFixed(1)}
          caption="Penicillin g/L"
          tone="var(--chart-3)"
        />
        <Ring
          value={Math.min(1, (batch.faultScore[i] ?? 0) / Math.max(REPLAY.threshold * 2, 0.01))}
          label={(batch.faultScore[i] ?? 0).toFixed(1)}
          caption={`Fault score · threshold ${REPLAY.threshold.toFixed(2)}`}
          tone={alarmed ? "var(--destructive)" : "var(--chart-4)"}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        {REPLAY.batches.map((b) => (
          <Button
            key={b.batch}
            type="button"
            size="sm"
            variant={b.batch === batchId ? "default" : "outline"}
            onClick={() => {
              setBatchId(b.batch);
              setCursor(0);
            }}
          >
            {LABEL[b.batch] ?? `Batch ${b.batch}`}
          </Button>
        ))}
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            Hour {hour}
            <Badge variant={batch.fault ? "destructive" : "secondary"}>
              {batch.fault ? "fault batch" : "normal batch"}
            </Badge>
            <Badge variant={alarmed ? "destructive" : "outline"}>{alarmed ? "fault suspected" : "quiet"}</Badge>
          </CardTitle>
          <CardDescription>
            Drag to replay. Recorded harvest {batch.totalT.toFixed(2)} t.{" "}
            {batch.onsetH !== null ? `Fault starts at hour ${batch.onsetH}. ` : ""}
            {batch.alarmH !== null ? `Detector fires at hour ${batch.alarmH}.` : "Detector never fires on this batch."}{" "}
            A fault flag and a bad harvest are different facts.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Slider
            min={0}
            max={batch.hours.length - 1}
            step={1}
            value={[i]}
            onValueChange={(v) => setCursor(v[0] ?? 0)}
          />
          <div className="grid gap-2 sm:grid-cols-5">
            {[
              ["Predicted total", `${(batch.predT[i] ?? 0).toFixed(2)} ± ${(batch.halfT[i] ?? 0).toFixed(2)} t`],
              ["Penicillin", `${(batch.penicillinGL[i] ?? 0).toFixed(1)} g/L`],
              ["Dissolved oxygen", `${(batch.doMgL[i] ?? 0).toFixed(1)} mg/L`],
              ["Temperature", `${(batch.tempC[i] ?? 0).toFixed(1)} °C`],
              ["Volume", `${Math.round(batch.volumeL[i] ?? 0).toLocaleString()} L`],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border px-3 py-2">
                <div className="text-muted-foreground text-xs">{label}</div>
                <div className="font-medium">{value}</div>
              </div>
            ))}
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <ChartContainer config={predConfig} className="aspect-auto h-64">
              <ComposedChart data={shown}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="h" unit=" h" type="number" domain={[0, batch.hours.at(-1) ?? 230]} />
                <YAxis domain={[0, "auto"]} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Area dataKey="band" fill="var(--color-band)" stroke="none" fillOpacity={0.25} />
                <Line dataKey="pred" stroke="var(--color-pred)" dot={false} />
                <ReferenceLine y={batch.totalT} stroke="var(--foreground)" strokeDasharray="4 4" />
              </ComposedChart>
            </ChartContainer>
            <ChartContainer config={scoreConfig} className="aspect-auto h-64">
              <LineChart data={shown}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="h" unit=" h" type="number" domain={[0, batch.hours.at(-1) ?? 230]} />
                <YAxis scale="log" domain={[0.1, "auto"]} allowDataOverflow />
                <ChartTooltip content={<ChartTooltipContent />} />
                <ReferenceLine y={REPLAY.threshold} stroke="var(--destructive)" strokeDasharray="4 4" />
                <Line dataKey="score" stroke="var(--color-score)" dot={false} />
              </LineChart>
            </ChartContainer>
          </div>
          <p className="text-muted-foreground text-xs">
            Left: predicted harvest (line, 80% band) against the recorded total (dashed). Right: fault score against the
            threshold (dashed red), log scale. Dissolved oxygen is mg/L, temperature converted from kelvin, volume as
            recorded. {REPORT.units_note}
          </p>
        </CardContent>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Yield, every normal batch held out once</CardTitle>
            <CardDescription>
              Trained only on IndPenSim. 5-fold cross-validation over batches 1–90: each row scores 90 batches, each
              predicted by a model that never saw it. Label: penicillin harvested, from the recorded titre and volumes.
              Inputs include the scheduled harvest time; without it, the error at 80% is{" "}
              {REPORT.yield_without_harvest_time.at(-1)?.model_mape.toFixed(1)}%. A neural network with the same inputs
              and folds scored {REPORT.model_comparison_at_80pct.fnn_128_64_32.toFixed(1)}%.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Stage</TableHead>
                  <TableHead>Model</TableHead>
                  <TableHead>Mean baseline</TableHead>
                  <TableHead>So-far baseline</TableHead>
                  <TableHead>80% band hit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {REPORT.yield.map((r) => (
                  <TableRow key={r.frac}>
                    <TableCell>
                      {Math.round(r.frac * 100)}% ({r.t_h} h)
                    </TableCell>
                    <TableCell>{r.model_mape.toFixed(1)}%</TableCell>
                    <TableCell>{r.baseline_mean_mape.toFixed(1)}%</TableCell>
                    <TableCell>{r.baseline_so_far_mape.toFixed(1)}%</TableCell>
                    <TableCell>{r.coverage_80.toFixed(0)}%</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Fault detector on batches 91–100</CardTitle>
            <CardDescription>
              Calibrated on normal batches only. A process-fault warning, not a contamination test.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center justify-around gap-4">
            <Ring
              value={REPORT.fault.detection_pct / 100}
              label={`${REPORT.fault.detection_pct.toFixed(0)}%`}
              caption="Faults caught"
              tone="var(--chart-2)"
            />
            <Ring
              value={Math.min(1, (REPORT.fault.median_delay_h ?? 0) / 24)}
              label={`${REPORT.fault.median_delay_h ?? "–"} h`}
              caption="Median delay"
              tone="var(--chart-4)"
            />
            <Ring
              value={REPORT.fault.false_alarm_batches_pct / 100}
              label={`${REPORT.fault.false_alarm_batches_pct.toFixed(0)}%`}
              caption={`False alarms of ${REPORT.fault.normal_test_batches}`}
              tone="var(--chart-5)"
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
