import { evaluateAlarms, predictYield } from "@/lib/fermentation/insights";
import {
  type Bounds,
  clampSetpoints,
  illustrativePowerKw,
  type ProcessState,
  project,
  type Scenario,
  type Setpoints,
} from "@/lib/fermentation/model";

export type FeedstockId = "glucose" | "molasses" | "pea-starch-hydrolysate";

export type AminoKey = "lys" | "leu" | "ile" | "val" | "thr" | "trp" | "his" | "pheTyr" | "metCys";

const AMINO_LABEL: Record<AminoKey, string> = {
  lys: "Lysine",
  leu: "Leucine",
  ile: "Isoleucine",
  val: "Valine",
  thr: "Threonine",
  trp: "Tryptophan",
  his: "Histidine",
  pheTyr: "Phe + Tyr",
  metCys: "Met + Cys",
};

/** Adult pattern used only to name the limiting amino acid. Grams per 100 g protein. */
const REQUIREMENT: Record<AminoKey, number> = {
  lys: 4.5,
  leu: 5.9,
  ile: 3.0,
  val: 3.9,
  thr: 2.3,
  trp: 0.6,
  his: 1.5,
  pheTyr: 3.8,
  metCys: 2.2,
};

/**
 * Demo reference rows. Shaped like published food-yeast profiles: lysine is relatively high,
 * sulfur amino acids are the usual shortfall. Not an assay of the live batch.
 */
const ROWS: Record<
  FeedstockId,
  { label: string; priceInrPerKg: number; proteinFraction: number; amino: Record<AminoKey, number> }
> = {
  glucose: {
    label: "Glucose",
    priceInrPerKg: 48,
    proteinFraction: 0.48,
    amino: { lys: 7.2, leu: 6.4, ile: 4.1, val: 4.8, thr: 4.2, trp: 1.1, his: 2.0, pheTyr: 6.8, metCys: 1.6 },
  },
  molasses: {
    label: "Cane molasses",
    priceInrPerKg: 22,
    proteinFraction: 0.44,
    amino: { lys: 6.4, leu: 6.1, ile: 3.8, val: 4.5, thr: 3.9, trp: 0.9, his: 1.8, pheTyr: 6.2, metCys: 1.4 },
  },
  "pea-starch-hydrolysate": {
    label: "Pea-starch hydrolysate",
    priceInrPerKg: 30,
    proteinFraction: 0.5,
    amino: { lys: 7.6, leu: 6.6, ile: 4.3, val: 5.0, thr: 4.4, trp: 1.0, his: 2.1, pheTyr: 7.0, metCys: 1.7 },
  },
};

export const FEEDSTOCKS = (Object.keys(ROWS) as FeedstockId[]).map((id) => ({ id, label: ROWS[id].label }));

export const INFO = {
  feedstock: "Sets the sugar, the price, and which reference amino-acid row is shown.",
  air: "Holds dissolved oxygen up. Short air sends sugar toward ethanol and cuts protein kilograms.",
  agitation: "Mixes the vessel and adds electricity to the selling price.",
  feed: "Adds sugar. Past the oxygen supply, extra feed becomes ethanol.",
  temperature: "Sets how fast the culture grows.",
  ph: "Sets how comfortably the culture grows.",
  score: "Protein per kg sugar, amino-acid coverage, and price, pressed into one number from 0 to 1.",
  msp: "Rupees per kg of protein required to cover feedstock and power. Power is calculated, not metered.",
  fault: "A process-fault warning. It is not a laboratory confirmation of contamination.",
  amino: "Grams per 100 g protein from the reference row for this feedstock, not from the probes.",
} as const;

export type AskIntent =
  | "set_feedstock"
  | "set_run"
  | "score"
  | "compare"
  | "trouble"
  | "apply"
  | "explain"
  | "unsupported";

export type AskJson = {
  intent: AskIntent;
  feedstock: FeedstockId;
  compareFeedstock: FeedstockId | null;
  aerationDelta: number;
  note: string;
};

export function parseAsk(text: string, feedstock: FeedstockId): AskJson {
  const q = text.toLowerCase();
  let next = feedstock;
  if (q.includes("molasses")) next = "molasses";
  else if (q.includes("pea")) next = "pea-starch-hydrolysate";
  else if (q.includes("glucose")) next = "glucose";
  let compareFeedstock: FeedstockId | null = null;
  if (q.includes("compare")) compareFeedstock = next === feedstock ? otherFeedstock(feedstock) : next;
  let intent: AskIntent = "explain";
  if (q.includes("compar")) intent = "compare";
  else if (q.includes("contamin") || q.includes("infect") || q.includes("drift") || q.includes("wrong"))
    intent = "trouble";
  else if (q.includes("apply") || q.includes("rescore")) intent = "apply";
  else if (q.includes("score")) intent = "score";
  else if (next !== feedstock) intent = "set_feedstock";
  else if (q.includes("air") || q.includes("aerat") || q.includes("feed") || q.includes("agit")) intent = "set_run";
  else if (q.trim().length < 2) intent = "unsupported";
  let aerationDelta = 0;
  if (q.includes("less air") || q.includes("low air") || q.includes("cut air")) aerationDelta = -0.35;
  else if (q.includes("more air") || q.includes("raise air")) aerationDelta = 0.35;
  return {
    intent,
    feedstock: intent === "compare" ? feedstock : next,
    compareFeedstock,
    aerationDelta,
    note: intent === "unsupported" ? "Ask about a feedstock, air, the score, a comparison, or a fault." : "",
  };
}

export type ProteinReading = {
  proteinKg: number;
  ethanol: number;
  msp: number;
  sugarKg: number;
  runHalf: number;
  proteinHalf: number;
  score: number;
  limiting: string;
  coverage: number;
  grams: { key: AminoKey; label: string; grams: number; requirement: number }[];
  powerKw: number;
};

export function readProtein(
  state: ProcessState,
  setpoints: Setpoints,
  scenario: Scenario,
  feedstock: FeedstockId,
  sensitivity: number,
): ProteinReading {
  const row = ROWS[feedstock];
  const ethanol = ethanolOf(state, setpoints, scenario);
  const proteinKg = (state.product / 1000) * state.volume * row.proteinFraction * (1 - ethanol / 40);
  const fedKg = setpoints.feedRate * (state.tMin / 60) * 2.5;
  const apparentSugar = (46 / 1000) * 1250 + fedKg - (state.substrate / 1000) * state.volume;
  const sugarKg = Math.max(0.2, apparentSugar, proteinKg / 0.42);
  const powerKw = illustrativePowerKw(setpoints);
  const hours = Math.max(state.tMin, 1) / 60;
  const electricityInr = powerKw * hours * 8;
  const msp = (sugarKg * row.priceInrPerKg + electricityInr) / Math.max(proteinKg, 0.05);
  const { limiting, coverage, grams } = coverageOf(row.amino);
  const alarms = evaluateAlarms(state, null, setpoints, scenario, sensitivity);
  const alarmFactor = alarms.length > 0 ? 0.92 : 1;
  const yieldFactor = clamp01(proteinKg / 36);
  const ethanolFactor = clamp01(1 - ethanol / 12);
  const runHalf = yieldFactor * (0.65 + 0.35 * ethanolFactor) * (0.85 + 0.15 * clamp01(180 / msp)) * alarmFactor;
  const proteinHalf = coverage;
  const score = Math.round(((runHalf + proteinHalf) / 2) * 100) / 100;
  return {
    proteinKg: round(proteinKg),
    ethanol: round(ethanol),
    msp: Math.round(msp),
    sugarKg: round(sugarKg),
    runHalf: round(runHalf),
    proteinHalf: round(proteinHalf),
    score,
    limiting,
    coverage: round(coverage),
    grams,
    powerKw,
  };
}

export type Candidate = {
  id: string;
  label: string;
  proteinKg: number;
  powerKw: number;
  setpoints: Setpoints;
  inBounds: boolean;
};

export function buildCandidates(
  state: ProcessState,
  setpoints: Setpoints,
  scenario: Scenario,
  bounds: Bounds,
  feedstock: FeedstockId,
): Candidate[] {
  const patches: { id: string; label: string; patch: Partial<Setpoints> }[] = [
    { id: "air-up", label: "More air", patch: { aeration: setpoints.aeration + 0.35 } },
    { id: "air-down", label: "Less air", patch: { aeration: setpoints.aeration - 0.3 } },
    { id: "rpm-up", label: "More agitation", patch: { agitation: setpoints.agitation + 80 } },
    { id: "feed-down", label: "Slower feed", patch: { feedRate: setpoints.feedRate - 0.12 } },
  ];
  const ranked = patches.map((item) => {
    const next = clampSetpoints({ ...setpoints, ...item.patch }, bounds);
    const inBounds = within(item.patch, setpoints, bounds);
    const end = project(state, next, scenario);
    const reading = readProtein(end, next, scenario, feedstock, 50);
    return {
      id: item.id,
      label: item.label,
      proteinKg: reading.proteinKg,
      powerKw: illustrativePowerKw(next),
      setpoints: next,
      inBounds,
    };
  });
  ranked.sort((a, b) => b.proteinKg - a.proteinKg || a.powerKw - b.powerKw);
  return ranked;
}

export function narrate(args: {
  feedstock: FeedstockId;
  reading: ProteinReading;
  fault: boolean;
  top: Candidate | undefined;
  compare: FeedstockId | null;
}): string {
  const name = ROWS[args.feedstock].label;
  const lead = `Predicted from the run model: about ${args.reading.proteinKg.toFixed(1)} kg protein on ${name}. Score ${args.reading.score.toFixed(2)} (run ${args.reading.runHalf.toFixed(2)}, protein pattern ${args.reading.proteinHalf.toFixed(2)}). Minimum selling price about ₹${args.reading.msp} per kg protein.`;
  const fault = args.fault
    ? " Process fault suspected from the current signals. Contamination is not confirmed."
    : " No fault rule is firing at this sensitivity.";
  const limit = ` Amino acids are the reference row for this feedstock, not a probe reading. Limiting amino acid: ${args.reading.limiting}.`;
  const choice = args.top
    ? ` Top in-bound candidate is ${args.top.label}: projected ${args.top.proteinKg.toFixed(1)} kg protein at ${args.top.powerKw.toFixed(2)} kW calculated power.`
    : "";
  const versus = args.compare
    ? ` Compared with ${ROWS[args.compare].label}, coverage is ${coverageOf(ROWS[args.compare].amino).coverage.toFixed(2)} against ${args.reading.coverage.toFixed(2)} here.`
    : "";
  return lead + fault + limit + choice + versus;
}

export function driversOf(state: ProcessState, setpoints: Setpoints, scenario: Scenario, bounds: Bounds) {
  return predictYield(state, setpoints, scenario, bounds, 0).influences.slice(0, 4);
}

function coverageOf(amino: Record<AminoKey, number>) {
  const grams = (Object.keys(amino) as AminoKey[]).map((key) => ({
    key,
    label: AMINO_LABEL[key],
    grams: amino[key],
    requirement: REQUIREMENT[key],
  }));
  let limiting: AminoKey = "metCys";
  let coverage = 1;
  for (const key of Object.keys(amino) as AminoKey[]) {
    const ratio = amino[key] / REQUIREMENT[key];
    if (ratio < coverage) {
      coverage = ratio;
      limiting = key;
    }
  }
  return { limiting: AMINO_LABEL[limiting], coverage: clamp01(coverage), grams };
}

function ethanolOf(state: ProcessState, setpoints: Setpoints, scenario: Scenario) {
  const gap = Math.max(0, setpoints.dissolvedOxygen - state.dissolvedOxygen);
  const stress = scenario === "oxygen-limitation" ? 1.4 : 1;
  return Math.min(18, gap * 0.12 * stress);
}

function otherFeedstock(id: FeedstockId): FeedstockId {
  if (id === "molasses") return "pea-starch-hydrolysate";
  return "molasses";
}

function within(patch: Partial<Setpoints>, current: Setpoints, bounds: Bounds) {
  for (const key of Object.keys(patch) as (keyof Setpoints)[]) {
    const value = patch[key];
    if (value === undefined) continue;
    if (value < bounds[key].min || value > bounds[key].max) return false;
    if (value === current[key]) return false;
  }
  return true;
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}
