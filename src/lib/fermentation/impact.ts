/**
 * Impact: what one yeast run means for food, climate, land, and waste, mapped to the UN Sustainable Development Goals.
 *
 * Every factor is a published average, not a measurement from this vessel. Protein, sugar, and electricity come from
 * the run (Model A's forecast and the calculated feed and power walked to the end of the batch).
 */
import { type FeedstockId, initialState, project, proteinKgOf, type Setpoints } from "@/lib/fermentation/model";
import reportJson from "@/lib/fermentation/model-a-report.json";
import type { ModelB, RunEconomics } from "@/lib/fermentation/protein";

/** Poore & Nemecek (2018), Science 360:987, global means for 2010, via Our World in Data. */
export const FOOTPRINT_SOURCE =
  "Poore J, Nemecek T (2018). Reducing food's environmental impacts through producers and consumers. Science 360(6392):987-992. Global means, via Our World in Data.";

/** kg CO2e and m² of land per 100 g protein. */
export const PROTEIN_FOOTPRINTS: { food: string; co2: number; land: number }[] = [
  { food: "Beef (beef herd)", co2: 49.89, land: 163.6 },
  { food: "Lamb & mutton", co2: 19.85, land: 184.81 },
  { food: "Cheese", co2: 10.82, land: 39.76 },
  { food: "Milk", co2: 9.5, land: 27.12 },
  { food: "Pig meat", co2: 7.61, land: 10.73 },
  { food: "Poultry meat", co2: 5.7, land: 7.06 },
  { food: "Eggs", co2: 4.21, land: 5.65 },
  { food: "Tofu", co2: 1.98, land: 2.2 },
  { food: "Peas", co2: 0.44, land: 3.36 },
];

/** Cane sugar, per kg: 3.2 kg CO2e and 2.04 m² (same source). Charged to every feedstock, so side streams are overstated. */
const SUGAR_CO2_PER_KG = 3.2;
const SUGAR_LAND_M2_PER_KG = 2.04;

/** Indian grid weighted average, FY 2022-23: CEA CO2 Baseline Database, version 19. */
export const GRID_CO2_PER_KWH = 0.716;
export const GRID_SOURCE =
  "Central Electricity Authority, CO2 Baseline Database for the Indian Power Sector, v19 (FY 2022-23).";

/** ICMR-NIN (2020) RDA: 0.83 g protein per kg body weight per day, reference adult man 65 kg. */
export const PROTEIN_G_PER_PERSON_DAY = 54;
export const RDA_SOURCE =
  "ICMR-NIN (2020). Nutrient Requirements for Indians: protein RDA 0.83 g/kg/day, 65 kg reference man.";

/** Illustrative scale-up: one 100 m³ vessel, one batch a day, 330 operating days, yield scaled linearly with volume. */
export const PLANT = { vesselM3: 100, batchesPerYear: 330 } as const;
export const PLANT_FACTOR = PLANT.vesselM3 * PLANT.batchesPerYear;

export const SIDE_STREAM: Record<FeedstockId, { sideStream: boolean; note: string }> = {
  glucose: { sideStream: false, note: "Refined glucose is a primary product." },
  molasses: { sideStream: true, note: "Cane molasses is left over after sugar is crystallised at the mill." },
  "pea-starch-hydrolysate": {
    sideStream: true,
    note: "Pea starch is left over after pea protein is extracted; hydrolysed, it becomes the sugar feed.",
  },
};

export type Impact = {
  proteinKg: number;
  personDays: number;
  co2PerKg: number;
  co2Per100g: number;
  co2Sugar: number;
  co2Power: number;
  landPer100g: number;
  avoidedCo2VsBeefKg: number;
  avoidedCo2VsPoultryKg: number;
  sparedLandVsBeefM2: number;
  kwhPerKgProtein: number;
  completeProtein: boolean;
  lowestAmino: { label: string; pct: number };
  oxygenFault: { lostPct: number; lostKg: number; detectionPct: number; delayMin: number };
  sideStream: (typeof SIDE_STREAM)[FeedstockId];
};

const BEEF = PROTEIN_FOOTPRINTS[0] as (typeof PROTEIN_FOOTPRINTS)[number];
const POULTRY = PROTEIN_FOOTPRINTS.find((row) => row.food === "Poultry meat") as (typeof PROTEIN_FOOTPRINTS)[number];

const lossCache = new Map<string, number>();

/** Share of the batch's protein that an undetected oxygen shortfall costs, at these settings and this feedstock. */
export function oxygenLossFraction(setpoints: Setpoints, feedstock: FeedstockId): number {
  const key = `${feedstock}|${Object.values(setpoints).join(",")}`;
  const cached = lossCache.get(key);
  if (cached !== undefined) return cached;
  const end = (scenario: "stable" | "oxygen-limitation") =>
    proteinKgOf(project(initialState(setpoints, feedstock), setpoints, scenario, undefined, feedstock));
  const stable = end("stable");
  const loss = stable > 0 ? Math.max(0, 1 - end("oxygen-limitation") / stable) : 0;
  if (lossCache.size > 64) lossCache.clear();
  lossCache.set(key, loss);
  return loss;
}

export function impactOf(
  run: RunEconomics,
  b: ModelB,
  feedstock: FeedstockId,
  setpoints: Setpoints,
  scale = 1,
): Impact {
  const proteinKg = Math.max(run.proteinKg, 0.05);
  const co2Sugar = run.sugarKg * SUGAR_CO2_PER_KG;
  const co2Power = run.energyKwh * GRID_CO2_PER_KWH;
  const co2PerKg = (co2Sugar + co2Power) / proteinKg;
  const landPerKg = (run.sugarKg * SUGAR_LAND_M2_PER_KG) / proteinKg;
  const hundreds = proteinKg * 10 * scale;
  const lowest = b.gramsPer100g.reduce(
    (low, row) =>
      row.grams / row.requirement < low.pct ? { label: row.label, pct: row.grams / row.requirement } : low,
    { label: "", pct: Number.POSITIVE_INFINITY },
  );
  const o2 = reportJson.fault.by_scenario["oxygen-limitation"];
  const lostPct = oxygenLossFraction(setpoints, feedstock);
  return {
    proteinKg: proteinKg * scale,
    personDays: (proteinKg * 1000 * scale) / PROTEIN_G_PER_PERSON_DAY,
    co2PerKg,
    co2Per100g: co2PerKg / 10,
    co2Sugar: co2Sugar * scale,
    co2Power: co2Power * scale,
    landPer100g: landPerKg / 10,
    avoidedCo2VsBeefKg: hundreds * (BEEF.co2 - co2PerKg / 10),
    avoidedCo2VsPoultryKg: hundreds * (POULTRY.co2 - co2PerKg / 10),
    sparedLandVsBeefM2: hundreds * (BEEF.land - landPerKg / 10),
    kwhPerKgProtein: run.energyKwh / proteinKg,
    completeProtein: b.available && lowest.pct >= 1,
    lowestAmino: { label: lowest.label, pct: Number.isFinite(lowest.pct) ? lowest.pct * 100 : 0 },
    oxygenFault: {
      lostPct: lostPct * 100,
      lostKg: lostPct * proteinKg * scale,
      detectionPct: o2.detection_pct,
      delayMin: o2.median_delay_min,
    },
    sideStream: SIDE_STREAM[feedstock],
  };
}
