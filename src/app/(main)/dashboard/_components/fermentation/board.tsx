"use client";

import { Activity, IndianRupee, Timer, Wheat } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

import { ArcMeter, KpiTile, MeterInfo, Ring, SplitWheel } from "./rings";
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
        hintLabel="What the batch score means for the price"
        hint="The number to compare before you repeat a batch, from 0 to 1. It averages the run half, kilograms and rupees, and the protein half, amino-acid coverage. A fault flag marks the run half down. Contamination is not confirmed."
      />
      <KpiTile
        icon={Wheat}
        label="Predicted protein"
        value={`${forecast.kg.toFixed(1)} kg`}
        badge={`${Math.round(forecast.frac * 100)}% seen`}
        note={`80% range ${forecast.low.toFixed(1)}–${forecast.high.toFixed(1)} kg on ${sugar.label}`}
        hintLabel="What the predicted kilograms mean for cost"
        hint="Kilograms of yeast protein expected from this sugar and these knobs. The percent seen is how much of the 600 minutes that forecast has watched, not a guarantee. The range is the 80% band around it. Fewer kilograms raise the rupee price. The amino-acid pattern does not move with this number."
      />
      <KpiTile
        icon={IndianRupee}
        label="Selling price"
        value={`₹${run.msp}`}
        badge={`${run.proteinPerKgSugar.toFixed(2)} kg/kg sugar`}
        note={`Feedstock ₹${run.feedstockInr} + power ₹${run.electricityInr}. Power is calculated.`}
        hintLabel="What the selling price is made of"
        hint="Rupees per kilogram of protein to cover the sugar and the calculated electricity. It is not a market quote, and the power is not from a meter. Short air turns sugar into ethanol, so you ship fewer kilograms and this price rises. The amino acids in the protein stay the same."
      />
      <KpiTile
        icon={Timer}
        label="Batch clock"
        value={`${live.state.tMin} min`}
        badge={live.status}
        note={`${Math.round(elapsed * 100)}% of 600 planned minutes · ${live.state.volume.toFixed(0)} L`}
        hintLabel="What the batch clock means for the forecast"
        hint="Minutes already on the 600-minute batch. Before it finishes, the kilograms are still a forecast. The litres are broth volume, not protein. The clock itself does not set the price."
      />
    </div>
  );
}

export function RunMeters() {
  const { score, fault, elapsed, live, pattern, forecast, evidence } = useRunSnapshot();
  const oxygen = live.state.dissolvedOxygen / 100;
  const faultFill = fault.threshold > 0 ? Math.min(1, fault.score / (fault.threshold * 2)) : 0;
  const latestFault = new Map<string, string>();
  for (const alarm of live.alarms) latestFault.set(alarm.parameter, alarm.reason);
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
          <Ring
            value={score.value}
            label={score.value.toFixed(2)}
            caption="Score"
            info={
              <MeterInfo label="What the batch score means for the price">
                The number to compare before you repeat a batch, from 0 to 1. It averages the run half, which is
                kilograms and rupees, and the protein half, which is amino-acid coverage. A lower score is a sugar and a
                set of knobs you should not run again.
              </MeterInfo>
            }
          />
          <Ring
            value={score.runHalf}
            label={score.runHalf.toFixed(2)}
            caption="Run half"
            tone="var(--chart-2)"
            info={
              <MeterInfo label="What the run half means for cost">
                Kilograms of protein per kilogram of sugar, marked down when the selling price is high and when the
                fault flag is on. Short air and a dearer sugar pull it down. It does not change which amino acid is
                limiting.
              </MeterInfo>
            }
          />
          <Ring
            value={score.proteinHalf}
            label={score.proteinHalf.toFixed(2)}
            caption="Protein half"
            tone="var(--chart-3)"
            info={
              <MeterInfo label="What the protein half means for quality">
                Coverage of the adult amino-acid pattern. Every sugar in this lab uses one published yeast row, so air,
                pH, and temperature do not move it. Methionine plus cysteine is what limits it. The result that does
                move is the kilograms and the rupee price.
              </MeterInfo>
            }
          />
          <Ring
            value={elapsed}
            label={`${Math.round(elapsed * 100)}%`}
            caption="Elapsed"
            tone="var(--chart-4)"
            info={
              <MeterInfo label="What the clock means for the forecast">
                Share of the 600 minutes already on the clock. Before the end, the kilograms are a forecast and shift as
                more of the batch is seen. The clock itself does not change the price.
              </MeterInfo>
            }
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <ArcMeter
            value={oxygen}
            label={`${live.state.dissolvedOxygen.toFixed(0)}%`}
            caption="Dissolved oxygen"
            info={
              <MeterInfo label="What dissolved oxygen does to protein and price">
                This is the probe, not the target you set. Under the target, sugar turns into ethanol. You ship fewer
                kilograms of protein and the rupee price per kilogram rises. The amino acids in that protein stay the
                same.
              </MeterInfo>
            }
          />
          <ArcMeter
            value={faultFill}
            label={fault.fault ? "Flag" : "Quiet"}
            caption={`Fault ${fault.score.toFixed(2)} / ${fault.threshold.toFixed(2)} · ${fault.falseAlarmPct}% false alarms`}
            tone={fault.fault ? "var(--destructive)" : "var(--chart-2)"}
            info={
              <MeterInfo label="Faults on this batch">
                <span className="block text-foreground">
                  Score {fault.score.toFixed(2)} against a line of {fault.threshold.toFixed(2)}. About{" "}
                  {fault.falseAlarmPct}% of normal batches would still cross this line.
                </span>
                {fault.fault ? (
                  <span className="mt-1 block">
                    Furthest from a normal batch:{" "}
                    {evidence
                      .map((item) => `${item.label} ${item.sigma > 0 ? "+" : ""}${item.sigma.toFixed(1)}σ`)
                      .join(", ")}
                    .
                  </span>
                ) : (
                  <span className="mt-1 block">Nothing is over the line right now.</span>
                )}
                {[...latestFault.entries()]
                  .filter(([, reason]) => !reason.startsWith("Process fault suspected"))
                  .slice(-3)
                  .map(([parameter, reason]) => (
                    <span key={parameter} className="mt-1 block">
                      {reason}
                    </span>
                  ))}
                <span className="mt-1 block">
                  A flag marks down the run half. It usually means fewer protein kilograms and a higher rupee price.
                  Contamination is not confirmed.
                </span>
              </MeterInfo>
            }
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
