"use client";

import { Activity, IndianRupee, Timer, Wheat } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

import { ArcMeter, KpiTile, Ring, SplitWheel } from "./rings";
import { useRunSnapshot } from "./snapshot";

export function RunKpis() {
  const { forecast, score, run, fault, elapsed, live, sugar } = useRunSnapshot();
  const quiet = fault.fault ? "Fault flag" : "Detector quiet";
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <KpiTile
        icon={Activity}
        label="Batch score"
        value={score.value.toFixed(2)}
        badge={quiet}
        note={`Run half ${score.runHalf.toFixed(2)} · protein half ${score.proteinHalf.toFixed(2)}`}
      />
      <KpiTile
        icon={Wheat}
        label="Predicted protein"
        value={`${forecast.kg.toFixed(1)} kg`}
        badge={`${Math.round(forecast.frac * 100)}% seen`}
        note={`80% range ${forecast.low.toFixed(1)}–${forecast.high.toFixed(1)} kg on ${sugar.label}`}
      />
      <KpiTile
        icon={IndianRupee}
        label="Selling price"
        value={`₹${run.msp}`}
        badge={`${run.proteinPerKgSugar.toFixed(2)} kg/kg sugar`}
        note={`Feedstock ₹${run.feedstockInr} + power ₹${run.electricityInr}. Power is calculated.`}
      />
      <KpiTile
        icon={Timer}
        label="Batch clock"
        value={`${live.state.tMin} min`}
        badge={live.status}
        note={`${Math.round(elapsed * 100)}% of 600 planned minutes · ${live.state.volume.toFixed(0)} L`}
      />
    </div>
  );
}

export function RunMeters() {
  const { score, fault, elapsed, live, pattern, forecast } = useRunSnapshot();
  const oxygen = live.state.dissolvedOxygen / 100;
  const faultFill = fault.threshold > 0 ? Math.min(1, fault.score / (fault.threshold * 2)) : 0;
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle className="font-normal">Where the run sits</CardTitle>
        <CardDescription>
          Circles read the live packet. Score and coverage are 0–1. Oxygen is the probe, not the setpoint.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Ring value={score.value} label={score.value.toFixed(2)} caption="Score" />
          <Ring value={score.runHalf} label={score.runHalf.toFixed(2)} caption="Run half" tone="var(--chart-2)" />
          <Ring
            value={score.proteinHalf}
            label={score.proteinHalf.toFixed(2)}
            caption="Protein half"
            tone="var(--chart-3)"
          />
          <Ring value={elapsed} label={`${Math.round(elapsed * 100)}%`} caption="Elapsed" tone="var(--chart-4)" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <ArcMeter value={oxygen} label={`${live.state.dissolvedOxygen.toFixed(0)}%`} caption="Dissolved oxygen" />
          <ArcMeter
            value={faultFill}
            label={fault.fault ? "Flag" : "Quiet"}
            caption={`Fault ${fault.score.toFixed(2)} / ${fault.threshold.toFixed(2)} · ${fault.falseAlarmPct}% false alarms`}
            tone={fault.fault ? "var(--destructive)" : "var(--chart-2)"}
          />
        </div>
        <p className="text-muted-foreground text-xs">
          Limiting amino acid {pattern.limitingAminoAcid || "not on file"} · coverage {pattern.coverage.toFixed(2)}.
          Model A has seen {Math.round(forecast.frac * 100)}% of the batch.
        </p>
      </CardContent>
    </Card>
  );
}

export function MoneyWheel() {
  const { run, powerKw } = useRunSnapshot();
  return (
    <SplitWheel
      title="What the price is made of"
      center={`₹${run.msp}`}
      caption={`Per kg protein. Calculated power ${powerKw.toFixed(2)} kW, not a meter.`}
      slices={[
        { key: "sugar", label: "Feedstock ₹", value: run.feedstockInr },
        { key: "power", label: "Electricity ₹", value: run.electricityInr },
      ]}
    />
  );
}

export function AminoWheel() {
  const { pattern } = useRunSnapshot();
  const slices = pattern.gramsPer100g.map((row) => ({
    key: row.key,
    label: `${row.label} ${row.grams}/${row.requirement} g`,
    value: row.grams,
  }));
  return (
    <SplitWheel
      title="Amino acids, g / 100 g"
      center={pattern.coverage.toFixed(2)}
      caption={
        pattern.available
          ? `Coverage of the adult pattern. Limiting: ${pattern.limitingAminoAcid}. Research row, not the probes.`
          : pattern.note
      }
      slices={slices.length > 0 ? slices : [{ key: "none", label: "No row", value: 1 }]}
    />
  );
}
