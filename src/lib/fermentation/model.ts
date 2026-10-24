/** Deterministic fermentation step. Sensors are coupled; nothing here is sampled at random. */

export const BATCH_MINUTES = 600;
export const STEP_MINUTES = 2;
export const REACTOR_ID = "BR-101";
export const TARGET_YIELD_G_L = 22;

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
    note: "Gas transfer is reduced, so dissolved oxygen falls and product formation slows.",
  },
  { id: "ph-drift", label: "pH drift", note: "Acid from growth outruns the pH controller." },
  {
    id: "contamination",
    label: "Possible contamination",
    note: "A second simulated consumer appears. Sensor patterns can suggest it. They cannot confirm it.",
  },
];

export type SetpointKey = "ph" | "temperature" | "agitation" | "aeration" | "feedRate" | "dissolvedOxygen";

export type Setpoints = Record<SetpointKey, number>;

export type Bounds = Record<SetpointKey, { min: number; max: number }>;

export const DEFAULT_SETPOINTS: Setpoints = {
  ph: 7.2,
  temperature: 37,
  agitation: 350,
  aeration: 1.2,
  feedRate: 0.35,
  dissolvedOxygen: 40,
};

export const DEFAULT_BOUNDS: Bounds = {
  ph: { min: 6.2, max: 8 },
  temperature: { min: 30, max: 42 },
  agitation: { min: 120, max: 700 },
  aeration: { min: 0.2, max: 2.6 },
  feedRate: { min: 0, max: 1.6 },
  dissolvedOxygen: { min: 20, max: 80 },
};

export type ProcessState = {
  tMin: number;
  ph: number;
  temperature: number;
  dissolvedOxygen: number;
  agitation: number;
  aeration: number;
  feedRate: number;
  biomass: number;
  substrate: number;
  co2: number;
  product: number;
  volume: number;
  contaminant: number;
};

export function clampSetpoints(setpoints: Setpoints, bounds: Bounds): Setpoints {
  const next = { ...setpoints };
  for (const key of Object.keys(next) as SetpointKey[]) {
    next[key] = clamp(next[key], bounds[key].min, bounds[key].max);
  }
  return next;
}

export function initialState(setpoints: Setpoints): ProcessState {
  return {
    tMin: 0,
    ph: setpoints.ph,
    temperature: setpoints.temperature,
    dissolvedOxygen: 72,
    agitation: setpoints.agitation,
    aeration: setpoints.aeration,
    feedRate: setpoints.feedRate,
    biomass: 0.55,
    substrate: 46,
    co2: 0.35,
    product: 0.3,
    volume: 1250,
    contaminant: 0,
  };
}

export function step(state: ProcessState, setpoints: Setpoints, scenario: Scenario): ProcessState {
  const dt = STEP_MINUTES / 60;
  const agitation = approach(state.agitation, setpoints.agitation, 0.12, dt);
  const aeration = approach(state.aeration, setpoints.aeration, 0.1, dt);
  const feedRate = approach(state.feedRate, setpoints.feedRate, 0.15, dt);
  const temperature = approach(state.temperature, setpoints.temperature, 0.35, dt);
  const phGain = scenario === "ph-drift" ? 0.12 : 1.15;
  const acid = scenario === "ph-drift" ? 0.62 : 0.08;
  const ph = clamp(state.ph + ((setpoints.ph - state.ph) * phGain - acid * state.biomass * 0.045) * dt, 5, 9);
  const phFactor = Math.exp(-((ph - 7.2) ** 2) / (2 * 0.45 ** 2));
  const tempFactor = Math.exp(-((temperature - 37) ** 2) / (2 * 1.6 ** 2));

  let kla = 2.6 * (agitation / 350) ** 0.85 * (Math.max(aeration, 0.05) / 1.2) ** 0.55;
  if (scenario === "oxygen-limitation") kla *= 0.22;

  const mu =
    0.52 *
    (state.substrate / (1.8 + state.substrate)) *
    (state.dissolvedOxygen / (18 + state.dissolvedOxygen)) *
    phFactor *
    tempFactor;

  let contaminant = state.contaminant;
  if (scenario === "contamination" && state.tMin >= 120) {
    const muC =
      0.4 * (state.substrate / (1.2 + state.substrate)) * (state.dissolvedOxygen / (12 + state.dissolvedOxygen));
    contaminant = Math.max(contaminant, 0.015) * Math.exp(muC * dt);
  }

  const our = 95 * mu * state.biomass + 140 * contaminant;
  const otr = kla * (100 - state.dissolvedOxygen);
  const dissolvedOxygen = clamp(state.dissolvedOxygen + (otr - our) * dt * 6, 0, 100);
  const growth = mu * state.biomass;
  const biomass = Math.max(0.05, state.biomass + (growth - 0.02 * state.biomass) * dt);
  const substrate = clamp(state.substrate + (feedRate * 4 - growth / 0.45 - contaminant * 1.2) * dt, 0, 90);
  const product = state.product + 9 * growth * (dissolvedOxygen / (25 + dissolvedOxygen)) * phFactor * dt;
  const co2 = clamp(state.co2 + (2.4 * growth + 3 * contaminant - 0.35 * state.co2) * dt, 0, 25);
  const volume = Math.min(1800, state.volume + feedRate * 6 * dt);

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
    product,
    volume,
    contaminant,
  };
}

/** Walk the same model forward. Used for yield projection and for stored demo batches. */
export function runMinutes(
  scenario: Scenario,
  setpoints: Setpoints,
  minutes: number,
  every = STEP_MINUTES,
): ProcessState[] {
  const out: ProcessState[] = [];
  let state = initialState(setpoints);
  out.push(state);
  while (state.tMin < minutes) {
    state = step(state, setpoints, scenario);
    if (state.tMin % every === 0 || state.tMin >= minutes) out.push(state);
  }
  return out;
}

export function project(
  state: ProcessState,
  setpoints: Setpoints,
  scenario: Scenario,
  until = BATCH_MINUTES,
): ProcessState {
  let cursor = state;
  while (cursor.tMin < until) cursor = step(cursor, setpoints, scenario);
  return cursor;
}

/** Illustrative agitator and air power. Not a measured utility bill. */
export function illustrativePowerKw(setpoints: Pick<Setpoints, "agitation" | "aeration" | "feedRate">): number {
  const power = (setpoints.agitation / 350) ** 3 * 1.1 + setpoints.aeration * 0.35 + setpoints.feedRate * 0.08;
  return Math.round(power * 100) / 100;
}

function approach(current: number, target: number, tau: number, dt: number) {
  return current + (target - current) * (1 - Math.exp(-dt / tau));
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
