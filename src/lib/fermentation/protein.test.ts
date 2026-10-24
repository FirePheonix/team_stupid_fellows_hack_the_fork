import { describe, expect, it } from "vitest";

import { DEFAULT_SETPOINTS, initialState, project } from "./model";
import { parseAsk, readProtein } from "./protein";

describe("protein reading", () => {
  it("scores a projected pea batch above an oxygen-limited one", () => {
    const start = initialState(DEFAULT_SETPOINTS);
    const stable = project(start, DEFAULT_SETPOINTS, "stable");
    const limited = project(start, DEFAULT_SETPOINTS, "oxygen-limitation");
    const pea = readProtein(stable, DEFAULT_SETPOINTS, "stable", "pea-starch-hydrolysate", 50);
    const starved = readProtein(limited, DEFAULT_SETPOINTS, "oxygen-limitation", "pea-starch-hydrolysate", 50);

    expect(pea.limiting).toBe("Met + Cys");
    expect(pea.score).toBeGreaterThan(0.55);
    expect(pea.score).toBeLessThanOrEqual(1);
    expect(starved.proteinKg).toBeLessThan(pea.proteinKg);
    expect(starved.score).toBeLessThan(pea.score);
  });

  it("turns a sentence into a feedstock and an air change", () => {
    const json = parseAsk("Pea-starch hydrolysate, less air. Score it.", "glucose");
    expect(json.feedstock).toBe("pea-starch-hydrolysate");
    expect(json.aerationDelta).toBe(-0.35);
    expect(json.intent).toBe("score");
  });
});
