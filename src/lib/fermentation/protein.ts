import {
  type Bounds,
  FEEDSTOCK_PARAMS,
  type FeedstockId,
  INR_PER_KWH,
  type ProcessState,
  project,
  type Scenario,
  type Setpoints,
} from "@/lib/fermentation/model";
import {
  type FaultReading,
  type ModelCandidate,
  modelCandidates,
  type ProteinForecast,
} from "@/lib/fermentation/model-a";

export type { FeedstockId };

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

/** Adult requirement pattern, g per 100 g protein. WHO/FAO/UNU (2007), Technical Report Series 935, Table 23. */
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

export const REQUIREMENT_SOURCE =
  "WHO/FAO/UNU (2007). Protein and amino acid requirements in human nutrition. WHO Technical Report Series 935.";

/**
 * Published Saccharomyces cerevisiae protein, g per 100 g protein: Jach et al. (2022), Metabolites 12(1):63, Table 3
 * (mg per g protein, divided by 10). The review does not split the profile by growth sugar, and we found no published
 * table that does for glucose, molasses and pea-starch hydrolysate, so every feedstock points at this one row. The
 * feedstock still changes protein kilograms and price through Model A and the run; it does not change this pattern.
 */
const SACCHAROMYCES_ROW: Record<AminoKey, number> = {
  his: 2.35,
  ile: 3.7,
  leu: 6.3,
  lys: 6.5,
  metCys: 2.3,
  pheTyr: 5.9,
  thr: 4.8,
  trp: 0.9,
  val: 5.3,
};

export const AMINO_SOURCE =
  "Jach ME, Serefko A, Ziaja M, Kieliszek M (2022). Yeast protein as an easily accessible food source. Metabolites 12(1):63, Table 3 (S. cerevisiae).";

const ROWS: Record<FeedstockId, { amino: Record<AminoKey, number>; source: string; note: string }> = {
  glucose: { amino: SACCHAROMYCES_ROW, source: AMINO_SOURCE, note: "Published S. cerevisiae row; sugar not stated." },
  molasses: { amino: SACCHAROMYCES_ROW, source: AMINO_SOURCE, note: "Published S. cerevisiae row; sugar not stated." },
  "pea-starch-hydrolysate": {
    amino: SACCHAROMYCES_ROW,
    source: AMINO_SOURCE,
    note: "Published S. cerevisiae row; sugar not stated.",
  },
};

export const FEEDSTOCKS = (Object.keys(FEEDSTOCK_PARAMS) as FeedstockId[]).map((id) => ({
  id,
  label: FEEDSTOCK_PARAMS[id].label,
}));

export const INFO = {
  feedstock: "Sets the sugar, the price, and which published amino-acid row Model B may use.",
  air: "Holds dissolved oxygen up. Short air sends sugar into ethanol and cuts protein kilograms.",
  agitation: "Mixes the vessel and adds electricity to the selling price.",
  feed: "Adds sugar. Past the oxygen supply, extra feed becomes ethanol.",
  temperature: "Sets how fast the yeast grows.",
  ph: "Sets how comfortably the yeast grows.",
  score: "Protein per kg sugar, amino-acid coverage, and price, pressed into one number from 0 to 1.",
  msp: "Rupees per kg of protein required to cover feedstock and power. Power is calculated, not metered.",
  fault: "A process-fault warning. It is not a laboratory confirmation of contamination.",
  amino: "Grams per 100 g protein from the research row for this feedstock.",
} as const;

export type ModelB = {
  available: boolean;
  gramsPer100g: { key: AminoKey; label: string; grams: number; requirement: number }[];
  limitingAminoAcid: string;
  coverage: number;
  quality: number;
  source: string;
  note: string;
  comparison: null | { other: FeedstockId; coverage: number; otherCoverage: number; higher: FeedstockId | "equal" };
};

/** Model B: the research-row lookup. It never predicts yield. */
export function modelB(feedstock: FeedstockId, compare: FeedstockId | null = null): ModelB {
  const row = ROWS[feedstock];
  if (!row) {
    return {
      available: false,
      gramsPer100g: [],
      limitingAminoAcid: "",
      coverage: 0,
      quality: 0,
      source: "",
      note: "No amino-acid row on file for this feedstock.",
      comparison: null,
    };
  }
  const own = coverageOf(row.amino);
  let comparison: ModelB["comparison"] = null;
  if (compare && compare !== feedstock && ROWS[compare]) {
    const other = coverageOf(ROWS[compare].amino);
    const diff = own.coverage - other.coverage;
    comparison = {
      other: compare,
      coverage: own.coverage,
      otherCoverage: other.coverage,
      higher: Math.abs(diff) < 1e-6 ? "equal" : higherOf(diff, feedstock, compare),
    };
  }
  return {
    available: true,
    gramsPer100g: own.grams,
    limitingAminoAcid: own.limiting,
    coverage: own.coverage,
    quality: own.coverage,
    source: row.source,
    note: row.note,
    comparison,
  };
}

export type RunEconomics = {
  proteinKg: number;
  sugarKg: number;
  energyKwh: number;
  feedstockInr: number;
  electricityInr: number;
  msp: number;
  proteinPerKgSugar: number;
};

/**
 * MSP = (feedstock cost + electricity cost) / protein kilograms. Protein is Model A's forecast; sugar and electricity are
 * the operator's planned feed and the calculated power walked to the end of the batch, not meter readings.
 */
export function economics(
  forecast: ProteinForecast,
  state: ProcessState,
  setpoints: Setpoints,
  scenario: Scenario,
  feedstock: FeedstockId,
): RunEconomics {
  const end = project(state, setpoints, scenario, undefined, feedstock);
  const feedstockInr = end.sugarFedKg * FEEDSTOCK_PARAMS[feedstock].priceInrPerKgSugar;
  const electricityInr = end.energyKwh * INR_PER_KWH;
  const proteinKg = Math.max(forecast.kg, 0.05);
  return {
    proteinKg: forecast.kg,
    sugarKg: round(end.sugarFedKg),
    energyKwh: round(end.energyKwh),
    feedstockInr: Math.round(feedstockInr),
    electricityInr: Math.round(electricityInr),
    msp: Math.round((feedstockInr + electricityInr) / proteinKg),
    proteinPerKgSugar: round(forecast.kg / Math.max(end.sugarFedKg, 0.1)),
  };
}

export type Score = { value: number; runHalf: number; proteinHalf: number };

/**
 * Run half: protein per kg sugar against the 0.25 kg/kg a well-run food-yeast batch reaches in this vessel, scaled down
 * when MSP is above ₹300/kg and when the oxygen-risk (fault) flag is on. Protein half: Model B coverage.
 */
export function scoreOf(run: RunEconomics, b: ModelB, fault: FaultReading): Score {
  const efficiency = Math.min(1, run.proteinPerKgSugar / 0.25);
  const pricePenalty = Math.min(1, 300 / Math.max(run.msp, 1));
  const faultPenalty = fault.fault ? 0.85 : 1;
  const runHalf = round(efficiency * (0.7 + 0.3 * pricePenalty) * faultPenalty);
  const proteinHalf = round(b.available ? b.quality : 0);
  return { value: round((runHalf + proteinHalf) / 2), runHalf, proteinHalf };
}

export function candidatesFor(
  samples: ProcessState[],
  setpoints: Setpoints,
  bounds: Bounds,
  feedstock: FeedstockId,
): ModelCandidate[] {
  return modelCandidates(samples, setpoints, bounds, feedstock).slice(0, 4);
}

function higherOf(diff: number, own: FeedstockId, other: FeedstockId) {
  return diff > 0 ? own : other;
}

function coverageOf(amino: Record<AminoKey, number>) {
  const grams = (Object.keys(amino) as AminoKey[]).map((key) => ({
    key,
    label: AMINO_LABEL[key],
    grams: amino[key],
    requirement: REQUIREMENT[key],
  }));
  let limiting: AminoKey = "metCys";
  let ratio = Number.POSITIVE_INFINITY;
  for (const key of Object.keys(amino) as AminoKey[]) {
    const r = amino[key] / REQUIREMENT[key];
    if (r < ratio) {
      ratio = r;
      limiting = key;
    }
  }
  return { limiting: AMINO_LABEL[limiting], coverage: round(Math.min(1, ratio)), grams };
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}
