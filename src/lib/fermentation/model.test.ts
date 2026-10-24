import { describe, expect, it } from "vitest";

import { BATCH_MINUTES, DEFAULT_SETPOINTS, project, runMinutes } from "./model";

describe("fermentation model", () => {
  it("grows product under a stable batch and keeps oxygen above a limited batch", () => {
    const stable = runMinutes("stable", DEFAULT_SETPOINTS, BATCH_MINUTES, 10);
    const limited = runMinutes("oxygen-limitation", DEFAULT_SETPOINTS, BATCH_MINUTES, 10);
    const stableEnd = stable.at(-1);
    const limitedEnd = limited.at(-1);
    if (!stableEnd || !limitedEnd) throw new Error("empty trajectory");

    expect(stableEnd.product).toBeGreaterThan(stable[0]?.product ?? 0);
    expect(stableEnd.product).toBeGreaterThan(limitedEnd.product);
    const stableDo = average(stable.slice(-8).map((row) => row.dissolvedOxygen));
    const limitedDo = average(limited.slice(-8).map((row) => row.dissolvedOxygen));
    expect(stableDo).toBeGreaterThan(limitedDo);
  });

  it("drifts pH only in the pH scenario and grows a contaminant only in that scenario", () => {
    const stable = runMinutes("stable", DEFAULT_SETPOINTS, BATCH_MINUTES, 20).at(-1);
    const drifted = runMinutes("ph-drift", DEFAULT_SETPOINTS, BATCH_MINUTES, 20).at(-1);
    const contaminated = runMinutes("contamination", DEFAULT_SETPOINTS, BATCH_MINUTES, 20).at(-1);
    if (!stable || !drifted || !contaminated) throw new Error("empty trajectory");

    expect(Math.abs(drifted.ph - 7.2)).toBeGreaterThan(Math.abs(stable.ph - 7.2));
    expect(contaminated.contaminant).toBeGreaterThan(0);
    expect(stable.contaminant).toBe(0);
  });

  it("projects the same end state as running the batch", () => {
    const full = runMinutes("stable", DEFAULT_SETPOINTS, BATCH_MINUTES, BATCH_MINUTES).at(-1);
    const projected = project(
      runMinutes("stable", DEFAULT_SETPOINTS, 0)[0] ?? initialFallback(),
      DEFAULT_SETPOINTS,
      "stable",
    );
    expect(full?.product).toBeCloseTo(projected.product, 6);
  });
});

function average(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function initialFallback() {
  return runMinutes("stable", DEFAULT_SETPOINTS, 0)[0];
}
