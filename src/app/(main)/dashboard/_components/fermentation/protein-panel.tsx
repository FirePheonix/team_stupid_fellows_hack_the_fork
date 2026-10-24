"use client";

import { useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  type AgentPacket,
  buildPacket,
  parseOffline,
  type RunJson,
  runFromState,
  templateParagraph,
} from "@/lib/fermentation/agent";
import { FEEDSTOCK_PARAMS, type FeedstockId, illustrativePowerKw } from "@/lib/fermentation/model";
import { airFeedGrid, driversAt, faultEvidence, forecastProtein, readFault } from "@/lib/fermentation/model-a";
import { candidatesFor, economics, FEEDSTOCKS, INFO, modelB, scoreOf } from "@/lib/fermentation/protein";
import { parseTurn, writeParagraph } from "@/server/fermatwin-actions";
import { useFermentation } from "@/stores/fermentation-store";

export function ProteinDesk() {
  const live = useFermentation((s) => s.live);
  const bounds = useFermentation((s) => s.bounds);
  const sensitivity = useFermentation((s) => s.sensitivity);
  const feedstock = useFermentation((s) => s.feedstock);
  const setFeedstock = useFermentation((s) => s.setFeedstock);
  const setSetpoint = useFermentation((s) => s.setSetpoint);
  const [compare, setCompare] = useState<FeedstockId | null>(null);
  const [question, setQuestion] = useState("");
  const [lastRun, setLastRun] = useState<{ json: RunJson; source: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [paragraph, setParagraph] = useState<{ text: string; source: string } | null>(null);

  const forecast = forecastProtein(live.samples, live.setpoints, feedstock);
  const fault = readFault(live.samples, sensitivity);
  const evidence = faultEvidence(live.state).map((e) => `${e.label} ${e.sigma > 0 ? "+" : ""}${e.sigma.toFixed(1)}σ`);
  const b = modelB(feedstock, compare);
  const run = useMemo(
    () => economics(forecast, live.state, live.setpoints, live.scenario, feedstock),
    [forecast, live.state, live.setpoints, live.scenario, feedstock],
  );
  const score = scoreOf(run, b, fault);
  const candidates = useMemo(
    () => candidatesFor(live.samples, live.setpoints, bounds, feedstock),
    [live.samples, live.setpoints, bounds, feedstock],
  );
  const drivers = driversAt(forecast.frac);
  const grid = useMemo(
    () => airFeedGrid(live.samples, live.setpoints, bounds, feedstock),
    [live.samples, live.setpoints, bounds, feedstock],
  );
  const powerKw = illustrativePowerKw(live.setpoints);
  const packet: AgentPacket = buildPacket({
    run: lastRun?.json ?? runFromState(feedstock, live.setpoints),
    forecast,
    fault,
    evidence,
    drivers,
    candidates,
    powerKw,
    b,
    score,
    economics: run,
  });
  const template = templateParagraph(packet);

  // Re-ask the agent only after a turn; between turns the template tracks the live numbers.
  useEffect(() => {
    if (!lastRun) setParagraph(null);
  }, [lastRun]);

  function applyRun(next: RunJson) {
    if (next.feedstock !== feedstock) setFeedstock(next.feedstock);
    setSetpoint("feedRate", next.settings.sugarFeed);
    setSetpoint("aeration", next.settings.aeration);
    setSetpoint("agitation", next.settings.agitation);
    setSetpoint("temperature", next.settings.temperatureC);
    setSetpoint("ph", next.settings.ph);
  }

  async function onAsk() {
    if (!question.trim()) return;
    setBusy(true);
    const current = runFromState(feedstock, live.setpoints);
    const top = candidates.find((c) => c.inBounds)?.id ?? null;
    const remote = await parseTurn(question, current, top).catch(() => null);
    const json = remote?.run ?? parseOffline(question, current, top);
    setLastRun({ json, source: remote?.source ?? "offline parser" });
    if (json.intent !== "unsupported") {
      setCompare(json.intent === "compare" ? json.compareFeedstock : null);
      if (json.intent === "apply" && json.applyCandidateId) {
        const chosen = candidates.find((c) => c.id === json.applyCandidateId && c.inBounds);
        if (chosen) applyCandidate(chosen.setpoints);
      } else if (json.intent !== "compare") applyRun(json);
    }
    const reply = await writeParagraph(packet).catch(() => null);
    setParagraph(reply);
    setBusy(false);
  }

  function applyCandidate(setpoints: typeof live.setpoints) {
    setSetpoint("aeration", setpoints.aeration);
    setSetpoint("agitation", setpoints.agitation);
    setSetpoint("feedRate", setpoints.feedRate);
  }

  const maxKg = Math.max(...grid.kg.flat(), 1);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center">
            Ask the run
            <Info text={INFO.score} />
          </CardTitle>
          <CardDescription>
            GPT-4o mini turns the sentence into run JSON. The simulation moves, Model A and Model B score it, and the
            agent restates those numbers.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <form
            className="flex flex-col gap-2 sm:flex-row"
            onSubmit={(event) => {
              event.preventDefault();
              void onAsk();
            }}
          >
            <input
              className="min-w-0 flex-1 rounded-md border bg-background px-3 py-2 text-sm"
              value={question}
              placeholder="Pea-starch hydrolysate, score it."
              onChange={(event) => setQuestion(event.target.value)}
            />
            <Button type="submit" disabled={busy}>
              {busy ? "Thinking…" : "Ask"}
            </Button>
          </form>
          {lastRun ? (
            <pre className="overflow-x-auto rounded-md bg-muted p-2 text-[11px] leading-snug">
              {`intent: ${lastRun.json.intent} · parsed by ${lastRun.source}\n${JSON.stringify(lastRun.json)}`}
            </pre>
          ) : (
            <p className="text-muted-foreground text-xs">
              Ask about a feedstock, air, the score, a comparison, or a fault.
            </p>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-4">
        <Card>
          <CardHeader>
            <CardDescription className="flex items-center">
              Score
              <Info text={INFO.score} />
            </CardDescription>
            <CardTitle className="text-3xl">{score.value.toFixed(2)}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            Run half {score.runHalf.toFixed(2)} (Model A). Protein half {score.proteinHalf.toFixed(2)} (Model B).
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Predicted final protein</CardDescription>
            <CardTitle className="text-3xl">{forecast.kg.toFixed(1)} kg</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            80% range {forecast.low.toFixed(1)}–{forecast.high.toFixed(1)} kg at {Math.round(forecast.frac * 100)}% of
            the batch. Predicted from the run model. Ethanol now {live.state.ethanol.toFixed(1)} g/L.
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription className="flex items-center">
              Minimum selling price
              <Info text={INFO.msp} />
            </CardDescription>
            <CardTitle className="text-3xl">₹{run.msp}/kg</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            Sugar ₹{run.feedstockInr} + power ₹{run.electricityInr} ({run.energyKwh.toFixed(0)} kWh). Electricity is
            calculated from agitation and air, not from a meter.
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription className="flex items-center">
              Fault
              <Info text={INFO.fault} />
            </CardDescription>
            <CardTitle className="text-3xl">{fault.fault ? "Suspected" : "Quiet"}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            Score {fault.score.toFixed(2)} vs threshold {fault.threshold.toFixed(2)} (about {fault.falseAlarmPct}% of
            normal batches alarm at this sensitivity).
            {fault.fault ? ` ${evidence.join(", ")}. Process fault suspected. Contamination is not confirmed.` : ""}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Agent</CardTitle>
          <CardDescription>
            {paragraph ? `Written by ${paragraph.source} from the packet only.` : "Template restating the packet."}
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm">{paragraph?.text ?? template}</CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center">
            Feedstock and amino acids
            <Info text={INFO.feedstock} />
          </CardTitle>
          <CardDescription>Amino acids from the research row for this feedstock, not from the probes.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Select value={feedstock} onValueChange={(value) => setFeedstock(value as FeedstockId)}>
            <SelectTrigger className="w-full max-w-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FEEDSTOCKS.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.label} · ₹{FEEDSTOCK_PARAMS[item.id].priceInrPerKgSugar}/kg sugar
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <ul className="flex flex-col gap-2">
            {b.gramsPer100g.map((item) => (
              <li key={item.key} className="grid grid-cols-[7rem_1fr_auto] items-center gap-2 text-xs">
                <span>{item.label}</span>
                <span className="relative h-1.5 overflow-hidden rounded-full bg-muted">
                  <span
                    className="block h-full bg-foreground"
                    style={{ width: `${Math.min(100, (item.grams / 8) * 100)}%` }}
                  />
                  <span
                    className="absolute top-0 h-full w-px bg-destructive"
                    style={{ left: `${Math.min(100, (item.requirement / 8) * 100)}%` }}
                  />
                </span>
                <span>
                  {item.grams.toFixed(1)} / {item.requirement.toFixed(1)} g
                </span>
              </li>
            ))}
          </ul>
          <p className="text-muted-foreground text-xs">
            <Info text={INFO.amino} /> Limiting amino acid: {b.limitingAminoAcid} (coverage {b.coverage.toFixed(2)}).
            Food yeast is protein-rich and usually short on sulfur amino acids. Digestibility: not measured on this
            batch. Source: {b.source} {b.note} Requirement: WHO/FAO/UNU 2007.
          </p>
          {b.comparison ? (
            <p className="text-sm">
              Versus {FEEDSTOCK_PARAMS[b.comparison.other].label}:{" "}
              {b.comparison.higher === "equal"
                ? "same published amino-acid row, so the choice rests on protein kilograms and MSP."
                : `coverage ${b.comparison.coverage.toFixed(2)} vs ${b.comparison.otherCoverage.toFixed(2)}.`}{" "}
              Here: {forecast.kg.toFixed(1)} kg protein at ₹{run.msp}/kg.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Candidates</CardTitle>
          <CardDescription>
            Air and agitation grid around now, each re-scored by Model A, with calculated power. Ranked by protein, then
            electricity.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <div className="text-muted-foreground text-xs">
            Now: {forecast.kg.toFixed(1)} kg protein at {powerKw.toFixed(2)} kW.
          </div>
          {candidates.map((item) => (
            <div
              key={item.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm"
            >
              <span className="font-medium">{item.label}</span>
              <span>
                {item.proteinKg.toFixed(1)} kg ({item.low.toFixed(1)}–{item.high.toFixed(1)})
              </span>
              <span>
                {item.powerKw.toFixed(2)} kW ({item.powerKw <= powerKw ? "saves" : "adds"}{" "}
                {Math.abs(item.powerKw - powerKw).toFixed(2)} kW)
              </span>
              <Badge variant={item.inBounds ? "secondary" : "outline"}>
                {item.inBounds ? "in bounds" : "out of bounds"}
              </Badge>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!item.inBounds}
                onClick={() => applyCandidate(item.setpoints)}
              >
                Apply
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>What moves the prediction</CardTitle>
            <CardDescription>
              Held-out permutation importance of Model A at this stage. Associated with the prediction, not a cause
              proven on a plant.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            {drivers.slice(0, 6).map((item) => (
              <div key={item.name} className="grid grid-cols-[9rem_1fr_auto] items-center gap-2">
                <span>{item.label}</span>
                <span className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <span
                    className="block h-full bg-foreground"
                    style={{
                      width: `${Math.min(100, (item.importance / Math.max(drivers[0]?.importance ?? 1, 1e-9)) * 100)}%`,
                    }}
                  />
                </span>
                <span className="text-muted-foreground text-xs">{item.importance.toFixed(2)} kg</span>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Air × sugar feed</CardTitle>
            <CardDescription>Model A's predicted final protein (kg) across the air and feed bounds.</CardDescription>
          </CardHeader>
          <CardContent>
            <table className="w-full text-center text-xs">
              <thead>
                <tr>
                  <th className="text-left font-normal text-muted-foreground">feed \ air</th>
                  {grid.air.map((a) => (
                    <th key={a} className="font-normal text-muted-foreground">
                      {a.toFixed(2)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {grid.feed.map((f, i) => (
                  <tr key={f}>
                    <td className="text-left text-muted-foreground">{f.toFixed(2)}</td>
                    {grid.kg[i]?.map((kg, j) => (
                      <td
                        key={grid.air[j]}
                        className="p-1"
                        style={{
                          backgroundColor: `color-mix(in oklab, var(--primary) ${Math.round((kg / maxKg) * 60)}%, transparent)`,
                        }}
                      >
                        {kg.toFixed(1)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>
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
