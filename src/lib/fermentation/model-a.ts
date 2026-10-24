/**
 * Model A in the browser: the trained yield trees and the fault detector exported by ml/train_model_a.py.
 * Nothing here is fitted at runtime; it only evaluates the exported weights on the live samples.
 */

import {
  BATCH_MINUTES,
  type Bounds,
  clampSetpoints,
  type FeedstockId,
  illustrativePowerKw,
  type ProcessState,
  type Setpoints,
} from "./model";
import modelJson from "./model-a.json";

type Tree = { f: number[]; t: number[]; l: number[]; r: number[]; v: number[] };
type ModelJson = {
  yield: {
    features: string[];
    init: number;
    lr: number;
    trees: Tree[];
    halfwidthByFrac: Record<string, number>;
    lagRows: number;
    logEveryMin: number;
  };
  fault: {
    signals: string[];
    tGrid: number[];
    mean: number[][];
    std: number[][];
    components: number[][];
    pcaMean: number[];
    variance: number[];
    t2Limit: number;
    speLimit: number;
    threshold: number;
    curve: { false_alarm_pct: number; threshold: number }[];
    startMin: number;
  };
  drivers: Record<string, Record<string, number>>;
};

const MODEL = modelJson as unknown as ModelJson;
const LAG_MIN = MODEL.yield.lagRows * MODEL.yield.logEveryMin;

const SIGNAL_OF: Record<string, (s: ProcessState) => number> = {
  dissolved_oxygen: (s) => s.dissolvedOxygen,
  ph: (s) => s.ph,
  temperature: (s) => s.temperature,
  agitation: (s) => s.agitation,
  aeration: (s) => s.aeration,
  feed_rate: (s) => s.feedRate,
  biomass: (s) => s.biomass,
  co2: (s) => s.co2,
  substrate: (s) => s.substrate,
  ethanol: (s) => s.ethanol,
};

export const DRIVER_LABEL: Record<string, string> = {
  dissolved_oxygen: "Dissolved oxygen",
  ph: "pH",
  temperature: "Temperature",
  agitation: "Agitation",
  aeration: "Air",
  feed_rate: "Sugar feed",
  biomass: "Biomass",
  co2: "Off-gas CO2",
  substrate: "Residual sugar",
  ethanol: "Ethanol",
  sp_ph: "pH setpoint",
  sp_temperature: "Temperature setpoint",
  sp_agitation: "Agitation setpoint",
  sp_aeration: "Air setpoint",
  sp_feed: "Feed setpoint",
  feedstock: "Feedstock",
};

function features(
  samples: ProcessState[],
  setpoints: Setpoints,
  feedstock: FeedstockId,
  override?: Partial<ProcessState>,
): number[] {
  const last = samples.at(-1);
  if (!last) return [];
  const now = { ...last, ...override };
  const target = now.tMin - LAG_MIN;
  const before = [...samples].reverse().find((s) => s.tMin <= target) ?? samples[0] ?? now;
  const values: Record<string, number> = {
    frac: Math.min(1, now.tMin / BATCH_MINUTES),
    sp_ph: setpoints.ph,
    sp_temperature: setpoints.temperature,
    sp_agitation: setpoints.agitation,
    sp_aeration: setpoints.aeration,
    sp_feed: setpoints.feedRate,
    fs_glucose: feedstock === "glucose" ? 1 : 0,
    fs_molasses: feedstock === "molasses" ? 1 : 0,
    "fs_pea-starch-hydrolysate": feedstock === "pea-starch-hydrolysate" ? 1 : 0,
  };
  for (const [name, read] of Object.entries(SIGNAL_OF)) {
    values[name] = read(now);
    values[`d_${name}`] = read(now) - read(before);
  }
  return MODEL.yield.features.map((name) => values[name] ?? 0);
}

function predictTrees(x: number[]): number {
  let out = MODEL.yield.init;
  for (const tree of MODEL.yield.trees) {
    let node = 0;
    while ((tree.l[node] ?? -1) !== -1) {
      node = (x[tree.f[node] ?? 0] ?? 0) <= (tree.t[node] ?? 0) ? (tree.l[node] ?? 0) : (tree.r[node] ?? 0);
    }
    out += MODEL.yield.lr * (tree.v[node] ?? 0);
  }
  return out;
}

function halfwidthAt(frac: number): number {
  const points = Object.entries(MODEL.yield.halfwidthByFrac)
    .map(([f, h]) => [Number(f), h] as const)
    .sort((a, b) => a[0] - b[0]);
  const first = points[0];
  const lastPoint = points.at(-1);
  if (!first || !lastPoint) return 0;
  if (frac <= first[0]) return first[1];
  if (frac >= lastPoint[0]) return lastPoint[1];
  for (let i = 1; i < points.length; i++) {
    const [f1, h1] = points[i] as readonly [number, number];
    const [f0, h0] = points[i - 1] as readonly [number, number];
    if (frac <= f1) return h0 + ((h1 - h0) * (frac - f0)) / (f1 - f0);
  }
  return lastPoint[1];
}

export type ProteinForecast = { kg: number; low: number; high: number; frac: number };

/** Final protein kilograms predicted from the samples so far. */
export function forecastProtein(
  samples: ProcessState[],
  setpoints: Setpoints,
  feedstock: FeedstockId,
): ProteinForecast {
  const x = features(samples, setpoints, feedstock);
  const frac = x[0] ?? 0;
  const kg = Math.max(0, predictTrees(x));
  const hw = halfwidthAt(frac);
  return { kg: round(kg), low: round(Math.max(0, kg - hw)), high: round(kg + hw), frac: round(frac) };
}

/** Fault score for one sample: max of Hotelling T2 and SPE, each over its 99th percentile on normal batches. */
export function faultScore(state: ProcessState): number {
  const f = MODEL.fault;
  let idx = f.tGrid.findIndex((t) => t >= state.tMin);
  if (idx < 0) idx = f.tGrid.length - 1;
  const mean = f.mean[idx] ?? [];
  const std = f.std[idx] ?? [];
  const z = f.signals.map((name, i) => ((SIGNAL_OF[name]?.(state) ?? 0) - (mean[i] ?? 0)) / (std[i] || 1));
  const centred = z.map((v, i) => v - (f.pcaMean[i] ?? 0));
  const scores = f.components.map((row) => row.reduce((sum, w, i) => sum + w * (centred[i] ?? 0), 0));
  const t2 = scores.reduce((sum, s, k) => sum + (s * s) / (f.variance[k] || 1), 0);
  const recon = centred.map((_, i) => f.components.reduce((sum, row, k) => sum + (row[i] ?? 0) * (scores[k] ?? 0), 0));
  const spe = centred.reduce((sum, v, i) => sum + (v - (recon[i] ?? 0)) ** 2, 0);
  return Math.max(t2 / f.t2Limit, spe / f.speLimit);
}

/**
 * Sensitivity 0-100 picks a point on the false-alarm curve measured on calibration normal batches:
 * 0 allows about 1% of normal batches to alarm, 50 about 5% (the trained default), 100 about 50%.
 */
export function thresholdFor(sensitivity: number): { threshold: number; falseAlarmPct: number } {
  const curve = [...MODEL.fault.curve].sort((a, b) => a.false_alarm_pct - b.false_alarm_pct);
  const pos = (Math.min(100, Math.max(0, sensitivity)) / 100) * (curve.length - 1);
  const i = Math.min(curve.length - 2, Math.floor(pos));
  const a = curve[i];
  const b = curve[i + 1];
  if (!a || !b) return { threshold: MODEL.fault.threshold, falseAlarmPct: 5 };
  const w = pos - i;
  return {
    threshold: a.threshold + (b.threshold - a.threshold) * w,
    falseAlarmPct: Math.round(a.false_alarm_pct + (b.false_alarm_pct - a.false_alarm_pct) * w),
  };
}

export type FaultReading = { score: number; threshold: number; fault: boolean; falseAlarmPct: number };

/** An alarm needs two consecutive logged samples over the threshold, after the first hour. */
export function readFault(samples: ProcessState[], sensitivity: number): FaultReading {
  const { threshold, falseAlarmPct } = thresholdFor(sensitivity);
  const last = samples.at(-1);
  if (!last) return { score: 0, threshold, fault: false, falseAlarmPct };
  const previous = [...samples].reverse().find((s) => s.tMin <= last.tMin - MODEL.yield.logEveryMin);
  const score = faultScore(last);
  const prevScore = previous ? faultScore(previous) : 0;
  const fault = last.tMin >= MODEL.fault.startMin && score > threshold && prevScore > threshold;
  return { score: round(score), threshold: round(threshold), fault, falseAlarmPct };
}

/** Signals whose deviation from the normal batch at this minute is largest, for the fault evidence line. */
export function faultEvidence(state: ProcessState): { signal: string; label: string; sigma: number }[] {
  const f = MODEL.fault;
  let idx = f.tGrid.findIndex((t) => t >= state.tMin);
  if (idx < 0) idx = f.tGrid.length - 1;
  return f.signals
    .map((name, i) => ({
      signal: name,
      label: DRIVER_LABEL[name] ?? name,
      sigma: round(((SIGNAL_OF[name]?.(state) ?? 0) - (f.mean[idx]?.[i] ?? 0)) / (f.std[idx]?.[i] || 1)),
    }))
    .sort((a, b) => Math.abs(b.sigma) - Math.abs(a.sigma))
    .slice(0, 3);
}

/** Held-out permutation importance at the nearest reported stage of the batch. */
export function driversAt(frac: number): { name: string; label: string; importance: number }[] {
  const stages = Object.keys(MODEL.drivers).map(Number);
  const nearest = stages.reduce((best, s) => (Math.abs(s - frac) < Math.abs(best - frac) ? s : best), stages[0] ?? 0.2);
  const row = MODEL.drivers[String(nearest)] ?? {};
  return Object.entries(row)
    .map(([name, importance]) => ({ name, label: DRIVER_LABEL[name] ?? name, importance }))
    .sort((a, b) => b.importance - a.importance);
}

export type ModelCandidate = {
  id: string;
  label: string;
  setpoints: Setpoints;
  proteinKg: number;
  low: number;
  high: number;
  powerKw: number;
  energyKwh: number;
  inBounds: boolean;
};

/** Score a full setting vector with the yield model: the current history, with the new air, agitation and feed. */
export function scoreSetting(
  samples: ProcessState[],
  setpoints: Setpoints,
  feedstock: FeedstockId,
): { kg: number; low: number; high: number } {
  const x = features(samples, setpoints, feedstock, {
    aeration: setpoints.aeration,
    agitation: setpoints.agitation,
    feedRate: setpoints.feedRate,
  });
  const kg = Math.max(0, predictTrees(x));
  const hw = halfwidthAt(x[0] ?? 0);
  return { kg: round(kg), low: round(Math.max(0, kg - hw)), high: round(kg + hw) };
}

/**
 * Candidate table (PRD 12.6): a small grid on air and agitation around the current settings, each cell re-scored by
 * the yield model and the electricity function. Ranked by protein, then electricity; out-of-bounds cells stay visible
 * but cannot be applied.
 */
export function modelCandidates(
  samples: ProcessState[],
  setpoints: Setpoints,
  bounds: Bounds,
  feedstock: FeedstockId,
): ModelCandidate[] {
  const remainingH = Math.max(0, BATCH_MINUTES - (samples.at(-1)?.tMin ?? 0)) / 60;
  const out: ModelCandidate[] = [];
  for (const da of [-0.3, 0, 0.3]) {
    for (const dr of [-60, 0, 60]) {
      if (da === 0 && dr === 0) continue;
      const raw = { ...setpoints, aeration: setpoints.aeration + da, agitation: setpoints.agitation + dr };
      const inBounds =
        raw.aeration >= bounds.aeration.min &&
        raw.aeration <= bounds.aeration.max &&
        raw.agitation >= bounds.agitation.min &&
        raw.agitation <= bounds.agitation.max;
      const next = clampSetpoints(raw, bounds);
      const score = scoreSetting(samples, next, feedstock);
      const powerKw = illustrativePowerKw(next);
      out.push({
        id: `air${da >= 0 ? "+" : ""}${da}-rpm${dr >= 0 ? "+" : ""}${dr}`,
        label: describe(da, dr),
        setpoints: next,
        proteinKg: score.kg,
        low: score.low,
        high: score.high,
        powerKw,
        energyKwh: round(powerKw * remainingH),
        inBounds,
      });
    }
  }
  return out.sort(
    (a, b) => Number(b.inBounds) - Number(a.inBounds) || b.proteinKg - a.proteinKg || a.powerKw - b.powerKw,
  );
}

/** Predicted final protein over a grid of air and sugar feed, for the interaction panel. */
export function airFeedGrid(
  samples: ProcessState[],
  setpoints: Setpoints,
  bounds: Bounds,
  feedstock: FeedstockId,
  steps = 5,
): { air: number[]; feed: number[]; kg: number[][] } {
  const lin = (lo: number, hi: number) => Array.from({ length: steps }, (_, i) => lo + ((hi - lo) * i) / (steps - 1));
  const air = lin(bounds.aeration.min, bounds.aeration.max).map(round);
  const feed = lin(bounds.feedRate.min, bounds.feedRate.max).map(round);
  const kg = feed.map((f) =>
    air.map((a) => scoreSetting(samples, { ...setpoints, aeration: a, feedRate: f }, feedstock).kg),
  );
  return { air, feed, kg };
}

function describe(da: number, dr: number) {
  const parts = [];
  if (da > 0) parts.push("more air");
  if (da < 0) parts.push("less air");
  if (dr > 0) parts.push("more agitation");
  if (dr < 0) parts.push("less agitation");
  const text = parts.join(", ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}
