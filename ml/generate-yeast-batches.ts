/**
 * Generate labelled yeast batches for Model A from the same simulation the dashboard runs.
 *
 * Run: node ml/generate-yeast-batches.ts [outDir]
 *
 * Three sets, each batch with its own feedstock, kinetic jitter, and sensor noise:
 *   wide    setpoints anywhere inside the slider bounds, so yield and candidates cover every allowed setting
 *   normal  setpoints inside the normal operating window, the reference the fault detector learns
 *   fault   normal-window setpoints with a scripted disturbance that starts at a random time
 * Signals are logged every 10 minutes; the label is the true (noise-free) final protein in kg.
 */

import {
  BATCH_MINUTES,
  DEFAULT_BOUNDS,
  type FeedstockId,
  initialState,
  type Kinetics,
  proteinKgOf,
  type Scenario,
  type Setpoints,
  step,
} from "../src/lib/fermentation/model.ts";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const LOG_EVERY = 10;
const FEEDSTOCKS: FeedstockId[] = ["glucose", "molasses", "pea-starch-hydrolysate"];
const FAULTS: Scenario[] = ["oxygen-limitation", "ph-drift", "contamination"];
const COUNTS = { wide: 1500, normal: 700, fault: 450 };

/** Normal operating window. Detector training only ever sees runs inside it. */
const NORMAL_WINDOW = {
  ph: [4.7, 5.3],
  temperature: [29, 31],
  agitation: [300, 420],
  aeration: [1.0, 1.5],
  feedRate: [0.28, 0.42],
} as const;

let seed = 20261024;
function rand() {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const uniform = (lo: number, hi: number) => lo + (hi - lo) * rand();
const gauss = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
const pick = <T>(items: readonly T[]) => items[Math.floor(rand() * items.length)] as T;

function setpointsIn(ranges: Record<keyof typeof NORMAL_WINDOW, readonly [number, number]>): Setpoints {
  return {
    ph: uniform(...ranges.ph),
    temperature: uniform(...ranges.temperature),
    agitation: uniform(...ranges.agitation),
    aeration: uniform(...ranges.aeration),
    feedRate: uniform(...ranges.feedRate),
    dissolvedOxygen: 30,
  };
}

const WIDE = {
  ph: [DEFAULT_BOUNDS.ph.min, DEFAULT_BOUNDS.ph.max],
  temperature: [DEFAULT_BOUNDS.temperature.min, DEFAULT_BOUNDS.temperature.max],
  agitation: [DEFAULT_BOUNDS.agitation.min, DEFAULT_BOUNDS.agitation.max],
  aeration: [DEFAULT_BOUNDS.aeration.min, DEFAULT_BOUNDS.aeration.max],
  feedRate: [DEFAULT_BOUNDS.feedRate.min, DEFAULT_BOUNDS.feedRate.max],
} as const;

const COLUMNS = [
  "batch",
  "set",
  "feedstock",
  "scenario",
  "fault",
  "onset_min",
  "t_min",
  "frac",
  "sp_ph",
  "sp_temperature",
  "sp_agitation",
  "sp_aeration",
  "sp_feed",
  "dissolved_oxygen",
  "ph",
  "temperature",
  "agitation",
  "aeration",
  "feed_rate",
  "biomass",
  "co2",
  "substrate",
  "ethanol",
  "protein_kg",
  "energy_kwh",
  "sugar_fed_kg",
  "final_protein_kg",
  "final_energy_kwh",
  "final_sugar_fed_kg",
];

function simulate(id: number, set: string, setpoints: Setpoints, fault: Scenario | null) {
  const feedstock = pick(FEEDSTOCKS);
  const kin: Kinetics = {
    qsMax: 1 + 0.06 * gauss(),
    respCapacity: 1 + 0.06 * gauss(),
    kla: 1 + 0.06 * gauss(),
    yieldOx: 1 + 0.03 * gauss(),
  };
  const onset = fault ? Math.round(uniform(60, 360) / 2) * 2 : -1;
  let state = initialState(setpoints, feedstock);
  const truth = [state];
  while (state.tMin < BATCH_MINUTES) {
    const scenario: Scenario = fault && state.tMin >= onset ? fault : "stable";
    state = step(state, setpoints, scenario, feedstock, kin);
    truth.push(state);
  }
  const end = state;
  const rows: string[] = [];
  for (const s of truth) {
    if (s.tMin % LOG_EVERY !== 0) continue;
    // Online sensor noise: DO and pH probes, capacitance biomass, off-gas analyser, at-line sugar and ethanol.
    const noisy = [
      s.dissolvedOxygen + 1.5 * gauss(),
      s.ph + 0.02 * gauss(),
      s.temperature + 0.08 * gauss(),
      s.agitation + 2 * gauss(),
      s.aeration * (1 + 0.01 * gauss()),
      s.feedRate * (1 + 0.01 * gauss()),
      s.biomass * (1 + 0.04 * gauss()),
      s.co2 * (1 + 0.03 * gauss()),
      Math.max(0, s.substrate + 0.15 * gauss()),
      Math.max(0, s.ethanol + 0.15 * gauss()),
    ];
    rows.push(
      [
        id,
        set,
        feedstock,
        fault ?? "stable",
        fault ? 1 : 0,
        onset,
        s.tMin,
        s.tMin / BATCH_MINUTES,
        setpoints.ph,
        setpoints.temperature,
        setpoints.agitation,
        setpoints.aeration,
        setpoints.feedRate,
        ...noisy,
        proteinKgOf(s),
        s.energyKwh,
        s.sugarFedKg,
        proteinKgOf(end),
        end.energyKwh,
        end.sugarFedKg,
      ]
        .map((v) => (typeof v === "number" ? Number(v.toFixed(4)) : v))
        .join(","),
    );
  }
  return rows;
}

const outDir = process.argv[2] ?? join(import.meta.dirname, "data");
mkdirSync(outDir, { recursive: true });
const lines = [COLUMNS.join(",")];
let id = 0;
for (let i = 0; i < COUNTS.wide; i++) lines.push(...simulate(id++, "wide", setpointsIn(WIDE), null));
for (let i = 0; i < COUNTS.normal; i++) lines.push(...simulate(id++, "normal", setpointsIn(NORMAL_WINDOW), null));
for (let i = 0; i < COUNTS.fault; i++)
  lines.push(...simulate(id++, "fault", setpointsIn(NORMAL_WINDOW), FAULTS[i % 3] ?? null));
writeFileSync(join(outDir, "yeast_batches.csv"), `${lines.join("\n")}\n`);
writeFileSync(join(outDir, "normal_window.json"), `${JSON.stringify(NORMAL_WINDOW, null, 2)}\n`);
console.log(`${id} batches, ${lines.length - 1} rows -> ${join(outDir, "yeast_batches.csv")}`);
