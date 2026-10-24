/**
 * The language layer around the models (PRD sections 9, 11 and 14): the run JSON a sentence becomes, the packet the
 * agent reads, and the fixed templates used when the language API is off. Nothing here computes a yield.
 */
import { DEFAULT_BOUNDS, FEEDSTOCK_PARAMS, type FeedstockId, type Setpoints } from "./model";
import type { FaultReading, ModelCandidate, ProteinForecast } from "./model-a";
import type { ModelB, RunEconomics, Score } from "./protein";

export const INTENTS = [
  "set_feedstock",
  "set_run",
  "score",
  "explain",
  "compare",
  "quality",
  "price",
  "trouble",
  "apply",
  "unsupported",
] as const;
export type Intent = (typeof INTENTS)[number];

export type RunSettings = {
  sugarFeed: number;
  aeration: number;
  agitation: number;
  temperatureC: number;
  ph: number;
};

export type RunJson = {
  intent: Intent;
  feedstock: FeedstockId;
  nitrogen: "ammonia" | "yeast-extract";
  settings: RunSettings;
  compareFeedstock: FeedstockId | null;
  applyCandidateId: string | null;
  unsupportedReason: string | null;
};

export const FEEDSTOCK_IDS = Object.keys(FEEDSTOCK_PARAMS) as FeedstockId[];

export const SETTING_BOUNDS: Record<keyof RunSettings, { min: number; max: number }> = {
  sugarFeed: DEFAULT_BOUNDS.feedRate,
  aeration: DEFAULT_BOUNDS.aeration,
  agitation: DEFAULT_BOUNDS.agitation,
  temperatureC: DEFAULT_BOUNDS.temperature,
  ph: DEFAULT_BOUNDS.ph,
};

export function runFromState(feedstock: FeedstockId, setpoints: Setpoints): RunJson {
  return {
    intent: "score",
    feedstock,
    nitrogen: "ammonia",
    settings: {
      sugarFeed: setpoints.feedRate,
      aeration: setpoints.aeration,
      agitation: setpoints.agitation,
      temperatureC: setpoints.temperature,
      ph: setpoints.ph,
    },
    compareFeedstock: null,
    applyCandidateId: null,
    unsupportedReason: null,
  };
}

/** Keep only legal values; anything malformed falls back to the current run. */
export function sanitizeRun(raw: unknown, current: RunJson): RunJson {
  if (!raw || typeof raw !== "object") return { ...current, intent: "unsupported", unsupportedReason: "not JSON" };
  const r = raw as Partial<RunJson> & { settings?: Partial<RunSettings> };
  const intent = INTENTS.includes(r.intent as Intent) ? (r.intent as Intent) : "unsupported";
  const feedstock = FEEDSTOCK_IDS.includes(r.feedstock as FeedstockId)
    ? (r.feedstock as FeedstockId)
    : current.feedstock;
  const settings = { ...current.settings };
  for (const key of Object.keys(settings) as (keyof RunSettings)[]) {
    const value = r.settings?.[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      settings[key] = Math.min(SETTING_BOUNDS[key].max, Math.max(SETTING_BOUNDS[key].min, value));
    }
  }
  if (intent === "unsupported") {
    return {
      ...current,
      intent,
      unsupportedReason: typeof r.unsupportedReason === "string" ? r.unsupportedReason : null,
    };
  }
  return {
    intent,
    feedstock,
    nitrogen: r.nitrogen === "yeast-extract" ? "yeast-extract" : "ammonia",
    settings,
    compareFeedstock: FEEDSTOCK_IDS.includes(r.compareFeedstock as FeedstockId)
      ? (r.compareFeedstock as FeedstockId)
      : null,
    applyCandidateId: typeof r.applyCandidateId === "string" ? r.applyCandidateId : null,
    unsupportedReason: null,
  };
}

/** Keyword fallback for when the language API is off. Changes only what the sentence names. */
export function parseOffline(text: string, current: RunJson, topCandidateId: string | null): RunJson {
  const q = text.toLowerCase();
  const next: RunJson = {
    ...current,
    settings: { ...current.settings },
    compareFeedstock: null,
    applyCandidateId: null,
  };
  let named: FeedstockId | null = null;
  if (q.includes("molasses")) named = "molasses";
  else if (q.includes("pea")) named = "pea-starch-hydrolysate";
  else if (q.includes("glucose")) named = "glucose";
  if (/compar|versus|\bvs\b|better/.test(q)) {
    next.intent = "compare";
    next.compareFeedstock = named && named !== current.feedstock ? named : null;
    return next;
  }
  if (named) next.feedstock = named;
  if (/less air|cut air|lower air|reduce air/.test(q))
    next.settings.aeration = clampSetting("aeration", current.settings.aeration * 0.4);
  if (/more air|raise air|increase air/.test(q))
    next.settings.aeration = clampSetting("aeration", current.settings.aeration * 1.5);
  if (/feed harder|more feed|faster feed/.test(q))
    next.settings.sugarFeed = clampSetting("sugarFeed", current.settings.sugarFeed + 0.1);
  if (/less feed|slower feed|cut feed/.test(q))
    next.settings.sugarFeed = clampSetting("sugarFeed", current.settings.sugarFeed - 0.1);
  const temp = q.match(/(\d{2}(?:\.\d)?)\s*(?:°|deg|c\b)/);
  if (temp?.[1]) next.settings.temperatureC = clampSetting("temperatureC", Number(temp[1]));
  const ph = q.match(/ph\s*(\d(?:\.\d+)?)/);
  if (ph?.[1]) next.settings.ph = clampSetting("ph", Number(ph[1]));
  const changed = JSON.stringify(next.settings) !== JSON.stringify(current.settings);
  if (/apply|rescore/.test(q)) {
    next.intent = "apply";
    next.applyCandidateId = topCandidateId;
  } else if (/contamin|infect|falling|drift|wrong|trouble/.test(q)) next.intent = "trouble";
  else if (/amino|limiting|quality|grams/.test(q)) next.intent = "quality";
  else if (/msp|price|cost|support price/.test(q)) next.intent = "price";
  else if (changed) next.intent = "set_run";
  else if (named && named !== current.feedstock) next.intent = "set_feedstock";
  else if (/score/.test(q)) next.intent = "score";
  else if (/why|what does|explain|how/.test(q)) next.intent = "explain";
  else return { ...current, intent: "unsupported", unsupportedReason: "No supported intent in the sentence." };
  return next;
}

function clampSetting(key: keyof RunSettings, value: number) {
  return Math.round(Math.min(SETTING_BOUNDS[key].max, Math.max(SETTING_BOUNDS[key].min, value)) * 100) / 100;
}

export type AgentPacket = {
  run: RunJson;
  modelA: {
    predictedProteinKg: number;
    interval: [number, number];
    faultScore: number;
    fault: boolean;
    faultThreshold: number;
    faultEvidence: string[];
    drivers: { label: string; importance: number }[];
    candidates: { id: string; label: string; proteinKg: number; powerKw: number; inBounds: boolean }[];
    current: { proteinKg: number; powerKw: number };
  };
  modelB: {
    available: boolean;
    gramsPer100g: Record<string, number>;
    limitingAminoAcid: string;
    quality: number;
    source: string;
    comparison: ModelB["comparison"];
  };
  score: Score;
  mspInrPerKg: number;
  economics: RunEconomics;
};

export function buildPacket(args: {
  run: RunJson;
  forecast: ProteinForecast;
  fault: FaultReading;
  evidence: string[];
  drivers: { label: string; importance: number }[];
  candidates: ModelCandidate[];
  powerKw: number;
  b: ModelB;
  score: Score;
  economics: RunEconomics;
}): AgentPacket {
  return {
    run: args.run,
    modelA: {
      predictedProteinKg: args.forecast.kg,
      interval: [args.forecast.low, args.forecast.high],
      faultScore: args.fault.score,
      fault: args.fault.fault,
      faultThreshold: args.fault.threshold,
      faultEvidence: args.evidence,
      drivers: args.drivers.slice(0, 4),
      candidates: args.candidates.map((c) => ({
        id: c.id,
        label: c.label,
        proteinKg: c.proteinKg,
        powerKw: c.powerKw,
        inBounds: c.inBounds,
      })),
      current: { proteinKg: args.forecast.kg, powerKw: args.powerKw },
    },
    modelB: {
      available: args.b.available,
      gramsPer100g: Object.fromEntries(args.b.gramsPer100g.map((g) => [g.label, g.grams])),
      limitingAminoAcid: args.b.limitingAminoAcid,
      quality: args.b.quality,
      source: args.b.source,
      comparison: args.b.comparison,
    },
    score: args.score,
    mspInrPerKg: args.economics.msp,
    economics: args.economics,
  };
}

/** Fixed-template paragraph (PRD 14). Used when the language API is off; restates packet numbers only. */
export function templateParagraph(p: AgentPacket): string {
  const name = FEEDSTOCK_PARAMS[p.run.feedstock].label;
  const parts = [
    `Predicted from the run model: ${p.modelA.predictedProteinKg.toFixed(1)} kg protein on ${name} (80% range ${p.modelA.interval[0].toFixed(1)}–${p.modelA.interval[1].toFixed(1)} kg). Score ${p.score.value.toFixed(2)}: run half ${p.score.runHalf.toFixed(2)}, protein half ${p.score.proteinHalf.toFixed(2)}. MSP about ₹${p.mspInrPerKg} per kg protein.`,
  ];
  if (p.modelA.fault) {
    parts.push(
      `Process fault suspected (score ${p.modelA.faultScore.toFixed(2)} over ${p.modelA.faultThreshold.toFixed(2)}): ${p.modelA.faultEvidence.join(", ")}. Contamination is not confirmed.`,
    );
  }
  const top = p.modelA.candidates.find((c) => c.inBounds);
  if (top) {
    const dKg = top.proteinKg - p.modelA.current.proteinKg;
    const dKw = top.powerKw - p.modelA.current.powerKw;
    parts.push(
      `Top in-bound candidate "${top.label}": ${dKg >= 0 ? "+" : ""}${dKg.toFixed(1)} kg protein, ${dKw >= 0 ? "+" : ""}${dKw.toFixed(2)} kW calculated power.`,
    );
  }
  if (p.modelB.available) {
    parts.push(
      `Amino acids are the research row for this feedstock, not the probes; limiting amino acid ${p.modelB.limitingAminoAcid}.`,
    );
  } else parts.push("The amino-acid pattern for this feedstock is not on file.");
  if (p.modelB.comparison) {
    const other = FEEDSTOCK_PARAMS[p.modelB.comparison.other].label;
    parts.push(
      p.modelB.comparison.higher === "equal"
        ? `${other} uses the same published amino-acid row, so the comparison rests on protein kilograms and MSP.`
        : `Coverage ${p.modelB.comparison.coverage.toFixed(2)} here against ${p.modelB.comparison.otherCoverage.toFixed(2)} for ${other}.`,
    );
  }
  return parts.join(" ");
}

export const PARSE_SYSTEM = `You turn one operator sentence about a food-yeast fermentation (Saccharomyces cerevisiae, vessel BR-101) into the next run JSON. Reply with JSON only.

Allowed intents: ${INTENTS.join(", ")}.
Allowed feedstocks: ${FEEDSTOCK_IDS.join(", ")}. Nitrogen: ammonia or yeast-extract.
Setting bounds: ${Object.entries(SETTING_BOUNDS)
  .map(([k, b]) => `${k} ${b.min}-${b.max}`)
  .join(
    "; ",
  )}. sugarFeed is the feed setpoint (0.35 feeds 7 g sugar per litre per hour). aeration is vvm. agitation is rpm.

Rules:
- Change only the fields the sentence names. Copy every other field from the current run unchanged.
- "Less air" sets aeration to about 40% of the current value; "more air" to about 150%. Stay inside the bounds.
- If the sentence mixes intents, keep the one that changes the run.
- compare: set compareFeedstock to the other feedstock named; leave feedstock as is.
- apply: set applyCandidateId to the top candidate id given in the input.
- Never invent protein kilograms, MSP, scores, or amino-acid grams. Never claim contamination.
- If the sentence fits no intent, set intent to "unsupported", keep settings unchanged, and give unsupportedReason.

Schema: {"intent":..., "feedstock":..., "nitrogen":..., "settings":{"sugarFeed":n,"aeration":n,"agitation":n,"temperatureC":n,"ph":n}, "compareFeedstock": id|null, "applyCandidateId": id|null, "unsupportedReason": string|null}`;

export const AGENT_SYSTEM = `You write the dashboard paragraph for a food-yeast fermentation twin. You receive one JSON packet with Model A (run model) and Model B (amino-acid research row) outputs.

Duties, in this order, in at most 5 plain sentences:
1. State predicted protein kg, its interval, and the score with both halves.
2. If modelA.fault is true, name the evidence signals and say "Contamination is not confirmed."
3. Describe the top in-bound candidate's protein change and calculated-power change versus the current run. Only call it energy-saving if its power is lower.
4. If modelB.available, state the limiting amino acid and that the grams per 100 g come from the research row, not the probes. If comparison is present, say which feedstock covers better (or that both use the same row) and remind that protein kg and MSP still decide the factory result.
5. Use only numbers in the packet. If a field is missing, say it is missing. Never compute a new yield. Never claim contamination.

Plain text, no markdown.`;
