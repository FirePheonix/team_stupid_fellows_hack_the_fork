import { describe, expect, it } from "vitest";

import { impactOf, PLANT_FACTOR, PROTEIN_FOOTPRINTS } from "./impact";
import { DEFAULT_SETPOINTS, initialState } from "./model";
import { forecastProtein } from "./model-a";
import { economics, modelB } from "./protein";

describe("impact", () => {
  const feedstock = "pea-starch-hydrolysate" as const;
  const state = initialState(DEFAULT_SETPOINTS, feedstock);
  const run = economics(
    forecastProtein([state], DEFAULT_SETPOINTS, feedstock),
    state,
    DEFAULT_SETPOINTS,
    "stable",
    feedstock,
  );
  const impact = impactOf(run, modelB(feedstock), feedstock, DEFAULT_SETPOINTS);

  it("puts yeast protein below every animal protein for climate and land", () => {
    for (const row of PROTEIN_FOOTPRINTS.filter((r) => !["Tofu", "Peas"].includes(r.food))) {
      expect(impact.co2Per100g).toBeLessThan(row.co2);
      expect(impact.landPer100g).toBeLessThan(row.land);
    }
  });

  it("reports a complete protein and a real oxygen-fault loss", () => {
    expect(impact.completeProtein).toBe(true);
    expect(impact.lowestAmino.label).toBe("Met + Cys");
    expect(impact.oxygenFault.lostPct).toBeGreaterThan(10);
  });

  it("scales absolute numbers, not per-100 g footprints, to the plant", () => {
    const plant = impactOf(run, modelB(feedstock), feedstock, DEFAULT_SETPOINTS, PLANT_FACTOR);
    expect(plant.personDays).toBeCloseTo(impact.personDays * PLANT_FACTOR, 3);
    expect(plant.co2Per100g).toBeCloseTo(impact.co2Per100g, 9);
  });
});
