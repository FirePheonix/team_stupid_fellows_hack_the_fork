/**
 * Fed-batch food-yeast (Saccharomyces cerevisiae) simulation for vessel BR-101.
 *
 * Kinetics follow the respiratory bottleneck model (Sonnleitner and Käppeli, 1986): sugar is respired only up to the
 * cell's oxidative capacity, and anything above it, or any shortfall in dissolved oxygen, is fermented to ethanol at a
 * far lower biomass yield. That is how a process setting (air, agitation, feed) turns into a protein loss.
 *
 * The step is deterministic. Training data adds kinetic jitter and sensor noise through `Kinetics` and the generator.
 */

export const BATCH_MINUTES = 600;
export const STEP_MINUTES = 2;
export const REACTOR_ID = "BR-101";
/** Protein concentration a good default run reaches, used only as a reference line. */
export const TARGET_YIELD_G_L = 16;

export type Scenario = "stable" | "oxygen-limitation" | "ph-drift" | "contamination";

export const SCENARIOS: { id: Scenario; label: string; note: string }[] = [
  {
    id: "stable",
    label: "Stable fermentation",
    note: "Controllers hold pH, temperature, and oxygen near their setpoints.",
  },
  {
    id: "oxygen-limitation",
    label: "Oxygen limitation",
    note: "Gas transfer is reduced, so dissolved oxygen falls, sugar turns to ethanol, and protein formation slows.",
  },
  { id: "ph-drift", label: "pH drift", note: "Acid from growth outruns the pH controller." },
  {
    id: "contamination",
    label: "Possible contamination",
    note: "A second simulated consumer appears. Sensor patterns can suggest it. They cannot confirm it.",
  },
];

export type FeedstockId = "glucose" | "molasses" | "pea-starch-hydrolysate";

/**
 * Feedstock effects on the culture. Growth factors and protein fractions are modelling assumptions in the published
 * range for food yeast (roughly 40-55% crude protein); prices are illustrative rupees per kg of fermentable sugar.
 */
export const FEEDSTOCK_PARAMS: Record<
  FeedstockId,
  { label: string; growthFactor: number; proteinFraction: number; priceInrPerKgSugar: number }
> = {
  glucose: { label: "Glucose", growthFactor: 1, proteinFraction: 0.48, priceInrPerKgSugar: 48 },
  molasses: { label: "Cane molasses", growthFactor: 1.04, proteinFraction: 0.45, priceInrPerKgSugar: 26 },
  "pea-starch-hydrolysate": {
    label: "Pea-starch hydrolysate",
    growthFactor: 0.96,
    proteinFraction: 0.5,
    priceInrPerKgSugar: 34,
  },
};

export type SetpointKey = "ph" | "temperature" | "agitation" | "aeration" | "feedRate" | "dissolvedOxygen";

export type Setpoints = Record<SetpointKey, number>;

export type Bounds = Record<SetpointKey, { min: number; max: number }>;

/**
 * feedRate is the target sugar feed in grams per litre of broth per hour, divided by 20 (0.35 feeds 7 g/L/h). As in
 * commercial yeast plants the pump ramps with the culture: it never feeds faster than FEED_PER_BIOMASS grams of sugar per
 * gram of yeast per hour, which keeps a healthy run respiratory until the target rate is reached.
 */
export const FEED_SCALE = 20;
const FEED_PER_BIOMASS = 0.6;

export const DEFAULT_SETPOINTS: Setpoints = {
  ph: 5,
  temperature: 30,
  agitation: 350,
  aeration: 1.2,
  feedRate: 0.35,
  dissolvedOxygen: 30,
};

export const DEFAULT_BOUNDS: Bounds = {
  ph: { min: 4, max: 6.5 },
  temperature: { min: 25, max: 36 },
  agitation: { min: 150, max: 600 },
  aeration: { min: 0.3, max: 2.2 },
  feedRate: { min: 0.05, max: 0.8 },
  dissolvedOxygen: { min: 10, max: 60 },
};

export type ProcessState = {
  tMin: number;
  ph: number;
  temperature: number;
  /** Percent of air saturation. */
  dissolvedOxygen: number;
  agitation: number;
  aeration: number;
  feedRate: number;
  /** Dry yeast, g/L. */
  biomass: number;
  /** Residual sugar, g/L. */
  substrate: number;
  /** Off-gas CO2, percent. */
  co2: number;
  /** Yeast protein, g/L (biomass times the feedstock's protein fraction). */
  product: number;
  /** Ethanol, g/L. */
  ethanol: number;
  volume: number;
  contaminant: number;
  /** Sugar fed so far, kg. */
  sugarFedKg: number;
  /** Agitation plus compressor electricity so far, kWh. */
  energyKwh: number;
};

/** Multipliers on the kinetic constants. All 1 for the dashboard; jittered when generating training batches. */
export type Kinetics = { qsMax: number; respCapacity: number; kla: number; yieldOx: number };

export const NOMINAL_KINETICS: Kinetics = { qsMax: 1, respCapacity: 1, kla: 1, yieldOx: 1 };

const Q_S_MAX = 2.2; // g sugar per g yeast per h
const K_S = 0.15; // g/L
const Q_O2_MAX = 0.32; // g O2 per g yeast per h, respiratory capacity
const K_O2 = 4; // % saturation
const Y_OS = 0.42; // g O2 per g sugar respired with growth
const Y_XS_OX = 0.49; // g yeast per g sugar, respiratory
const Y_XS_RED = 0.05; // g yeast per g sugar, fermentative
const Y_ES = 0.48; // g ethanol per g sugar fermented
const Q_E_MAX = 0.18; // g ethanol per g yeast per h, re-uptake when oxygen is spare
const K_E = 0.5; // g/L
const Y_OE = 1.4; // g O2 per g ethanol
const Y_XE = 0.6; // g yeast per g ethanol
const DECAY = 0.01; // per h
const C_STAR = 0.0075; // g O2 per L at saturation, about 30 °C
const FEED_SUGAR = 500; // g/L in the feed tank
const MAX_VOLUME = 1500;
const INR_PER_KWH = 8;

export { INR_PER_KWH };

export function clampSetpoints(setpoints: Setpoints, bounds: Bounds): Setpoints {
  const next = { ...setpoints };
  for (const key of Object.keys(next) as SetpointKey[]) {
    next[key] = clamp(next[key], bounds[key].min, bounds[key].max);
  }
  return next;
}

export function initialState(setpoints: Setpoints, feedstock: FeedstockId = "glucose"): ProcessState {
  const biomass = 1.2;
  return {
    tMin: 0,
    ph: setpoints.ph,
    temperature: setpoints.temperature,
    dissolvedOxygen: 95,
    agitation: setpoints.agitation,
    aeration: setpoints.aeration,
    feedRate: setpoints.feedRate,
    biomass,
    substrate: 2,
    co2: 0.1,
    product: biomass * FEEDSTOCK_PARAMS[feedstock].proteinFraction,
    ethanol: 0,
    volume: 1000,
    contaminant: 0,
    sugarFedKg: 2,
    energyKwh: 0,
  };
}

/** Oxygen transfer coefficient, per hour (Van't Riet form: kLa ~ (P/V)^0.4 vs^0.5, with P ~ N^3). */
export function klaOf(agitation: number, aeration: number, scenario: Scenario, kin: Kinetics = NOMINAL_KINETICS) {
  const base = 520 * (agitation / 350) ** 1.2 * (Math.max(aeration, 0.05) / 1.2) ** 0.5 * kin.kla;
  return scenario === "oxygen-limitation" ? base * 0.35 : base;
}

/** Calculated agitator plus air-compressor power for the 1.5 m3 vessel, kW. Not a meter reading. */
export function illustrativePowerKw(setpoints: Pick<Setpoints, "agitation" | "aeration">): number {
  const agitator = 5 * 1000 * (setpoints.agitation / 60) ** 3 * 0.35 ** 5 * 0.6;
  const airM3s = (setpoints.aeration * 1.2) / 60;
  const compressor = (3.5 * 101325 * airM3s * (2 ** (1 / 3.5) - 1)) / 0.7;
  return Math.round(((agitator + compressor) / 1000) * 100) / 100;
}

type Rates = { mu: number; qs: number; qsRed: number; qeOx: number; qo2: number };

function rates(
  sugar: number,
  ethanol: number,
  dissolvedOxygen: number,
  tempFactor: number,
  phFactor: number,
  growth: number,
  kin: Kinetics,
  qsCap: number,
): Rates {
  const qs = Math.min(qsCap, Q_S_MAX * kin.qsMax * growth * (sugar / (K_S + sugar)) * tempFactor * phFactor);
  const capacity = Q_O2_MAX * kin.respCapacity * tempFactor * (dissolvedOxygen / (K_O2 + dissolvedOxygen));
  const qsOx = Math.min(qs, capacity / Y_OS);
  const qsRed = qs - qsOx;
  const spare = Math.max(0, capacity - qsOx * Y_OS);
  // Glucose repression: ethanol is only taken back up once the cells stop fermenting sugar.
  const qeOx = qsRed > 1e-9 ? 0 : Math.min(spare / Y_OE, Q_E_MAX * (ethanol / (K_E + ethanol)));
  const mu = Y_XS_OX * kin.yieldOx * qsOx + Y_XS_RED * qsRed + Y_XE * qeOx - DECAY;
  return { mu, qs, qsRed, qeOx, qo2: qsOx * Y_OS + qeOx * Y_OE };
}

export function step(
  state: ProcessState,
  setpoints: Setpoints,
  scenario: Scenario,
  feedstock: FeedstockId = "glucose",
  kin: Kinetics = NOMINAL_KINETICS,
): ProcessState {
  const dt = STEP_MINUTES / 60;
  const fs = FEEDSTOCK_PARAMS[feedstock];
  const agitation = approach(state.agitation, setpoints.agitation, 0.12, dt);
  const aeration = approach(state.aeration, setpoints.aeration, 0.1, dt);
  const feedRate = approach(state.feedRate, setpoints.feedRate, 0.15, dt);
  const temperature = approach(state.temperature, setpoints.temperature, 0.35, dt);

  const phGain = scenario === "ph-drift" ? 0.1 : 1.2;
  const acidLoad = (scenario === "ph-drift" ? 0.05 : 0.008) * state.biomass + 0.04 * state.contaminant;
  const ph = clamp(state.ph + ((setpoints.ph - state.ph) * phGain - acidLoad) * dt, 3, 8);

  const tempFactor = Math.exp(-(((temperature - 30) / 6) ** 2));
  const phFactor = Math.exp(-(((ph - 5) / 1.5) ** 2));
  const kla = klaOf(agitation, aeration, scenario, kin);
  const feedSugar = Math.min(feedRate * FEED_SCALE, FEED_PER_BIOMASS * state.biomass); // g per L broth per h
  // Cells cannot take up more sugar in a step than the broth holds plus what the pump adds in that step.
  const contaminantDemand = 2.5 * state.contaminant; // g sugar per L per h taken by a contaminant, if present
  const qsCap = Math.max(0, state.substrate / dt + feedSugar - contaminantDemand) / Math.max(state.biomass, 1e-6);
  // Sugar the cells see during the step includes what the pump adds in it, so uptake does not flicker step to step.
  const sugarSeen = state.substrate + feedSugar * dt;

  // Oxygen equilibrates in seconds, far faster than the 2-minute step: solve OTR = OUR for dissolved oxygen.
  const uptakeAt = (doPct: number) =>
    rates(sugarSeen, state.ethanol, doPct, tempFactor, phFactor, fs.growthFactor, kin, qsCap).qo2 * state.biomass +
    0.35 * state.contaminant;
  let lo = 0;
  let hi = 100;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    const otr = kla * C_STAR * (1 - mid / 100);
    if (otr > uptakeAt(mid)) lo = mid;
    else hi = mid;
  }
  const dissolvedOxygen = (lo + hi) / 2;
  const r = rates(sugarSeen, state.ethanol, dissolvedOxygen, tempFactor, phFactor, fs.growthFactor, kin, qsCap);

  let contaminant = state.contaminant;
  if (scenario === "contamination" && state.tMin >= 120) {
    // A fast bacterial consumer competes for the incoming feed (sugar stays near zero in fed-batch), makes acid and CO2.
    contaminant = Math.max(contaminant, 0.02) * Math.exp(0.6 * (sugarSeen / (0.05 + sugarSeen)) * dt);
  }

  const sugarUse = r.qs * state.biomass + contaminantDemand;
  const substrate = Math.max(0, state.substrate + (feedSugar - sugarUse) * dt);
  const biomass = Math.max(0.05, state.biomass * (1 + r.mu * dt));
  const ethanol = Math.max(0, state.ethanol + (Y_ES * r.qsRed - r.qeOx) * state.biomass * dt);
  const volume = Math.min(MAX_VOLUME, state.volume + ((feedSugar * state.volume) / FEED_SUGAR) * dt);

  // CO2 evolution, g/L/h: respiratory quotient ~1.05 on oxygen, plus 0.47 g CO2 per g sugar fermented.
  const cer = r.qo2 * state.biomass * (44 / 32) * 1.05 + 0.47 * r.qsRed * state.biomass + 0.6 * contaminant;
  const gasMolPerH = (aeration * volume * 60) / 22.4;
  const co2 = clamp((100 * ((cer * volume) / 44)) / Math.max(gasMolPerH, 1e-6), 0, 25);

  const powerKw = illustrativePowerKw({ agitation, aeration });

  return {
    tMin: state.tMin + STEP_MINUTES,
    ph,
    temperature,
    dissolvedOxygen,
    agitation,
    aeration,
    feedRate,
    biomass,
    substrate,
    co2,
    product: biomass * fs.proteinFraction,
    ethanol,
    volume,
    contaminant,
    sugarFedKg: state.sugarFedKg + (feedSugar * state.volume * dt) / 1000,
    energyKwh: state.energyKwh + powerKw * dt,
  };
}

/** Kilograms of yeast protein in the vessel. */
export function proteinKgOf(state: ProcessState) {
  return (state.product * state.volume) / 1000;
}

/** Walk the same model forward. Used for yield projection and for stored demo batches. */
export function runMinutes(
  scenario: Scenario,
  setpoints: Setpoints,
  minutes: number,
  every = STEP_MINUTES,
  feedstock: FeedstockId = "glucose",
  kin: Kinetics = NOMINAL_KINETICS,
): ProcessState[] {
  const out: ProcessState[] = [];
  let state = initialState(setpoints, feedstock);
  out.push(state);
  while (state.tMin < minutes) {
    state = step(state, setpoints, scenario, feedstock, kin);
    if (state.tMin % every === 0 || state.tMin >= minutes) out.push(state);
  }
  return out;
}

export function project(
  state: ProcessState,
  setpoints: Setpoints,
  scenario: Scenario,
  until = BATCH_MINUTES,
  feedstock: FeedstockId = "glucose",
): ProcessState {
  let cursor = state;
  while (cursor.tMin < until) cursor = step(cursor, setpoints, scenario, feedstock);
  return cursor;
}

function approach(current: number, target: number, tau: number, dt: number) {
  return current + (target - current) * (1 - Math.exp(-dt / tau));
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
