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
        description="Penicillin, IndPenSim. This is not the yeast protein run. Model A's recipe with separate weights, trained on batches 1–70 and replayed on held-out batches."
      />
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
            <CardTitle>Yield on held-out batches 71–90</CardTitle>
            <CardDescription>
              Label: total penicillin from the statistics file, as the PRD specifies. The model does not beat the
              training-mean baseline on this label; it is shown, not hidden.
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
          <CardContent className="grid grid-cols-3 gap-2 text-sm">
            <Metric label="Faults caught" value={`${REPORT.fault.detection_pct.toFixed(0)}%`} />
            <Metric label="Median delay" value={`${REPORT.fault.median_delay_h ?? "–"} h`} />
            <Metric
              label="False alarms"
              value={`${REPORT.fault.false_alarm_batches_pct.toFixed(0)}% of ${REPORT.fault.normal_test_batches}`}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border px-3 py-2">
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className="font-medium text-lg">{value}</div>
    </div>
  );
}
