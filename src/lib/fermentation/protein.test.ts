import { describe, expect, it } from "vitest";

import { parseOffline, runFromState } from "./agent";
import { BATCH_MINUTES, DEFAULT_SETPOINTS, runMinutes } from "./model";
import { forecastProtein, readFault } from "./model-a";
import { modelB } from "./protein";

describe("protein desk", () => {
  it("names sulfur amino acids as limiting from the published yeast row", () => {
    const b = modelB("pea-starch-hydrolysate", "molasses");
    expect(b.available).toBe(true);
    expect(b.limitingAminoAcid).toBe("Met + Cys");
    expect(b.comparison?.higher).toBe("equal");
  });

  it("predicts less protein and raises a fault when oxygen is limited", () => {
    const stable = runMinutes("stable", DEFAULT_SETPOINTS, BATCH_MINUTES * 0.6, 2, "glucose");
    const limited = runMinutes("oxygen-limitation", DEFAULT_SETPOINTS, BATCH_MINUTES * 0.6, 2, "glucose");
    expect(forecastProtein(limited, DEFAULT_SETPOINTS, "glucose").kg).toBeLessThan(
      forecastProtein(stable, DEFAULT_SETPOINTS, "glucose").kg,
    );
    expect(readFault(limited, 50).fault).toBe(true);
    expect(readFault(stable, 50).fault).toBe(false);
  });

  it("changes only the fields a sentence names", () => {
    const current = runFromState("glucose", DEFAULT_SETPOINTS);
    const next = parseOffline("Pea-starch hydrolysate, less air.", current, null);
    expect(next.feedstock).toBe("pea-starch-hydrolysate");
    expect(next.settings.aeration).toBeLessThan(current.settings.aeration);
    expect(next.settings.agitation).toBe(current.settings.agitation);
    expect(next.settings.ph).toBe(current.settings.ph);
  });
});
