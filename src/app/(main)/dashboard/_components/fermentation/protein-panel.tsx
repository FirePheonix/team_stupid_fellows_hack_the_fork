"use client";

import { useMemo, useState } from "react";

import { useActiveAlarms } from "@/app/(main)/dashboard/_components/fermentation/panels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { project } from "@/lib/fermentation/model";
import {
  buildCandidates,
  driversOf,
  FEEDSTOCKS,
  type FeedstockId,
  INFO,
  narrate,
  parseAsk,
  readProtein,
} from "@/lib/fermentation/protein";
import { useFermentation } from "@/stores/fermentation-store";

export function ProteinDesk() {
  const live = useFermentation((s) => s.live);
  const bounds = useFermentation((s) => s.bounds);
  const sensitivity = useFermentation((s) => s.sensitivity);
  const setSetpoint = useFermentation((s) => s.setSetpoint);
  const alarms = useActiveAlarms();
  const [feedstock, setFeedstock] = useState<FeedstockId>("pea-starch-hydrolysate");
  const [compare, setCompare] = useState<FeedstockId | null>(null);
  const [question, setQuestion] = useState("");
  const [parsed, setParsed] = useState("Ask about a feedstock, the air, the score, or a fault.");

  const end = useMemo(
    () => project(live.state, live.setpoints, live.scenario),
    [live.state, live.setpoints, live.scenario],
  );
  const reading = readProtein(end, live.setpoints, live.scenario, feedstock, sensitivity);
  const candidates = buildCandidates(live.state, live.setpoints, live.scenario, bounds, feedstock);
  const top = candidates.find((item) => item.inBounds);
  const drivers = driversOf(live.state, live.setpoints, live.scenario, bounds);
  const fault = alarms.length > 0;
  const paragraph = narrate({ feedstock, reading, fault, top, compare });

  function onAsk() {
    const json = parseAsk(question, feedstock);
    setParsed(`${json.intent}${json.note ? `: ${json.note}` : ""}`);
    if (json.intent === "unsupported") return;
    if (json.feedstock !== feedstock) setFeedstock(json.feedstock);
    setCompare(json.compareFeedstock);
    if (json.aerationDelta !== 0) setSetpoint("aeration", live.setpoints.aeration + json.aerationDelta);
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center">
            Ask the run
            <Info text={INFO.score} />
          </CardTitle>
          <CardDescription>
            A sentence becomes run JSON, then the same simulation the charts already use. Predicted from the run model.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <form
            className="flex flex-col gap-2 sm:flex-row"
            onSubmit={(event) => {
              event.preventDefault();
              onAsk();
            }}
          >
            <input
              className="min-w-0 flex-1 rounded-md border bg-background px-3 py-2 text-sm"
              value={question}
              placeholder="Pea-starch hydrolysate, less air. Score it."
              onChange={(event) => setQuestion(event.target.value)}
            />
            <Button type="submit">Ask</Button>
          </form>
          <p className="text-muted-foreground text-xs">Intent: {parsed}</p>
        </CardContent>
      </Card>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardDescription className="flex items-center">
              Score
              <Info text={INFO.score} />
            </CardDescription>
            <CardTitle>{reading.score.toFixed(2)}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            Projected to the end of this batch. Run half {reading.runHalf.toFixed(2)}. Protein-pattern half{" "}
            {reading.proteinHalf.toFixed(2)}.
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Predicted protein</CardDescription>
            <CardTitle>{reading.proteinKg.toFixed(1)} kg</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            Ethanol about {reading.ethanol.toFixed(1)} g/L when oxygen is short.
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription className="flex items-center">
              Minimum selling price
              <Info text={INFO.msp} />
            </CardDescription>
            <CardTitle>₹{reading.msp}/kg</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">Calculated power {reading.powerKw.toFixed(2)} kW. Not a meter.</CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center">
            Feedstock
            <Info text={INFO.feedstock} />
          </CardTitle>
          <CardDescription>Amino acids from the reference row for this feedstock, not from the probes.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Select value={feedstock} onValueChange={(value) => setFeedstock(value as FeedstockId)}>
            <SelectTrigger className="w-full max-w-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FEEDSTOCKS.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <ul className="flex flex-col gap-2">
            {reading.grams.map((item) => (
              <li key={item.key} className="grid grid-cols-[7rem_1fr_auto] items-center gap-2 text-xs">
                <span>{item.label}</span>
                <span className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <span
                    className="block h-full bg-foreground"
                    style={{ width: `${Math.min(100, (item.grams / 10) * 100)}%` }}
                  />
                </span>
                <span>
                  {item.grams.toFixed(1)} / {item.requirement.toFixed(1)} g
                </span>
              </li>
            ))}
          </ul>
          <p className="text-muted-foreground text-xs">
            <Info text={INFO.amino} /> Limiting amino acid: {reading.limiting}. Food yeast is usually short on sulfur
            amino acids.
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Penicillin benchmark, kept separate</CardTitle>
          <CardDescription>
            IndPenSim is a penicillin plant, not this yeast-protein score. Fault batches are 91–100. Batch 93 is a fault
            and one of the largest harvests. Batch 99 is a fault and one of the smallest. Dissolved oxygen there is mg/L
            and temperature is kelvin. Those rows do not set the amino-acid bars.
          </CardDescription>
        </CardHeader>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Candidates</CardTitle>
          <CardDescription>Each row is the run model projected to the end, with calculated power.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {candidates.map((item) => (
            <div
              key={item.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm"
            >
              <span className="font-medium">{item.label}</span>
              <span>{item.proteinKg.toFixed(1)} kg protein</span>
              <span>{item.powerKw.toFixed(2)} kW</span>
              <Badge variant={item.inBounds ? "secondary" : "outline"}>
                {item.inBounds ? "in bounds" : "out of bounds"}
              </Badge>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!item.inBounds}
                onClick={() => {
                  setSetpoint("aeration", item.setpoints.aeration);
                  setSetpoint("agitation", item.setpoints.agitation);
                  setSetpoint("feedRate", item.setpoints.feedRate);
                }}
              >
                Apply
              </Button>
            </div>
          ))}
          {fault ? (
            <p className="text-sm">
              Process fault suspected. Contamination is not confirmed.
              <Info text={INFO.fault} />
            </p>
          ) : null}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>What moves the prediction</CardTitle>
          <CardDescription>
            Associations from the run model. Not a cause proven on a plant. Air and feed interact through oxygen.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          {drivers.map((item) => (
            <div key={item.parameter} className="flex justify-between">
              <span>{item.parameter}</span>
              <span>
                {item.deltaYield >= 0 ? "+" : ""}
                {item.deltaYield.toFixed(2)} g/L if nudged
              </span>
            </div>
          ))}
          <p>{paragraph}</p>
        </CardContent>
      </Card>
    </div>
  );
}

function Info({ text }: { text: string }) {
  return (
    <button
      type="button"
      className="ml-1 inline-flex size-4 items-center justify-center rounded-full border text-[10px] leading-none"
      title={text}
      aria-label={text}
    >
      i
    </button>
  );
}
