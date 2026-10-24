import {
  BATCH_MINUTES,
  type Bounds,
  clampSetpoints,
  illustrativePowerKw,
  type ProcessState,
  project,
  type Scenario,
  type SetpointKey,
  type Setpoints,
  TARGET_YIELD_G_L,
} from "./model";
import { faultEvidence, type ProteinForecast, readFault } from "./model-a";

export type Alarm = {
  id: string;
  parameter: string;
  partId: string;
  severity: "low" | "medium" | "high";
  tMin: number;
  evidence: string;
  reason: string;
  contaminationConfirmed: false;
};

export type Prediction = {
  kind: "baseline";
  disclaimer: string;
  predictedYield: number;
  targetYield: number;
  uncertainty: number;
  etaMin: number;
  influences: { parameter: string; deltaYield: number }[];
};

export type Recommendation = {
  title: string;
  reason: string;
  proposed: Setpoints;
  currentYield: number;
  proposedYield: number;
  currentPowerKw: number;
  proposedPowerKw: number;
  effect: string;
};

const DISCLAIMER = "Baseline projection from the kinetic simulation. This is not a trained machine-learning model.";

export function evaluateAlarms(
  state: ProcessState,
  earlier: ProcessState | null,
  setpoints: Setpoints,
  scenario: Scenario,
  sensitivity: number,
): Alarm[] {
  const tight = 0.55 + (sensitivity / 100) * 0.9;
  const alarms: Alarm[] = [];
  const doGap = setpoints.dissolvedOxygen - state.dissolvedOxygen;
  if (doGap > 18 / tight) {
    alarms.push(
      alarm(
        state,
        "dissolvedOxygen",
        "dissolvedOxygen",
        doGap > 30 ? "high" : "medium",
        `Dissolved oxygen is ${state.dissolvedOxygen.toFixed(1)}% at ${state.tMin} min. The setpoint is ${setpoints.dissolvedOxygen.toFixed(0)}%.`,
        "Oxygen transfer is below what the culture is using. Agitation and aeration set the transfer rate in this simulation.",
      ),
    );
  }
  const phGap = Math.abs(state.ph - setpoints.ph);
  if (phGap > 0.55 / tight) {
    alarms.push(
      alarm(
        state,
        "ph",
        "ph",
        phGap > 0.8 ? "high" : "medium",
        `pH is ${state.ph.toFixed(2)} at ${state.tMin} min. The setpoint is ${setpoints.ph.toFixed(2)}.`,
        scenario === "ph-drift"
          ? "The pH-drift scenario weakens the controller while growth keeps producing acid."
          : "pH has moved outside the band around the setpoint.",
      ),
    );
  }
  const tempGap = Math.abs(state.temperature - setpoints.temperature);
  if (tempGap > 1.8 / tight) {
    alarms.push(
      alarm(
        state,
        "temperature",
        "temperature",
        tempGap > 3 ? "high" : "low",
        `Temperature is ${state.temperature.toFixed(2)}°C at ${state.tMin} min. The setpoint is ${setpoints.temperature.toFixed(1)}°C.`,
        "The jacket has not caught the setpoint. Growth rate in this model falls as temperature leaves 37°C.",
      ),
    );
  }
  if (earlier && state.tMin - earlier.tMin >= 10 && state.substrate > 5) {
    const hours = (state.tMin - earlier.tMin) / 60;
    const slope = (state.biomass - earlier.biomass) / hours;
    if (slope < -0.04) {
      alarms.push(
        alarm(
          state,
          "biomass",
          "broth",
          "medium",
          `Biomass fell from ${earlier.biomass.toFixed(2)} to ${state.biomass.toFixed(2)} g/L over ${state.tMin - earlier.tMin} min while substrate is still ${state.substrate.toFixed(1)} g/L.`,
          "A falling biomass with substrate still present is outside the usual growth curve of this simulation.",
        ),
      );
    }
  }
  if (scenario === "contamination" && state.tMin >= 150 && earlier) {
    const productSlope = (state.product - earlier.product) / Math.max(1, (state.tMin - earlier.tMin) / 60);
    if (state.co2 > earlier.co2 && productSlope < 0.8) {
      alarms.push(
        alarm(
          state,
          "off-gas CO2",
          "broth",
          "high",
          `Off-gas CO2 rose from ${earlier.co2.toFixed(2)} to ${state.co2.toFixed(2)} while product formation over the last ${state.tMin - earlier.tMin} min was ${productSlope.toFixed(2)} g/L per hour.`,
          "That pattern can appear when an unmeasured consumer is in the broth. It does not confirm contamination.",
        ),
      );
    }
  }
  return alarms;
}

/** Process-fault alarm from Model A's detector, with the most deviant signals as evidence. */
export function modelAlarms(samples: ProcessState[], sensitivity: number): Alarm[] {
  const last = samples.at(-1);
  if (!last) return [];
  const reading = readFault(samples, sensitivity);
  if (!reading.fault) return [];
  const evidence = faultEvidence(last);
  const lead = evidence[0];
  const PART: Record<string, string> = { ph: "ph", dissolved_oxygen: "dissolvedOxygen" };
  const parameter = PART[lead?.signal ?? ""] ?? "process";
  return [
    {
      id: `model-${last.tMin}`,
      parameter,
      partId: parameter === "process" ? "broth" : parameter,
      severity: reading.score > reading.threshold * 2 ? "high" : "medium",
      tMin: last.tMin,
      evidence: `Fault score ${reading.score.toFixed(2)} over threshold ${reading.threshold.toFixed(2)} at ${last.tMin} min. Furthest from a normal batch at this minute: ${evidence
        .map((e) => `${e.label} ${e.sigma > 0 ? "+" : ""}${e.sigma.toFixed(1)}σ`)
        .join(", ")}.`,
      reason: "Process fault suspected. Contamination is not confirmed.",
      contaminationConfirmed: false,
    },
  ];
}

export function rememberAlarms(history: Alarm[], fresh: Alarm[]): Alarm[] {
  const next = [...history];
  for (const item of fresh) {
    const prior = [...next].reverse().find((row) => row.parameter === item.parameter);
    if (!prior || item.tMin - prior.tMin >= 8) next.push(item);
  }
  return next;
}

export function predictYield(
  state: ProcessState,
  setpoints: Setpoints,
  scenario: Scenario,
  bounds: Bounds,
  activeCount: number,
): Prediction {
  const end = project(state, setpoints, scenario);
  const remaining = Math.max(0, BATCH_MINUTES - state.tMin) / BATCH_MINUTES;
  const influences = (["agitation", "aeration", "feedRate", "temperature", "ph"] as const).map((key) => {
    const bumped = clampSetpoints({ ...setpoints, [key]: nudge(setpoints[key], key) }, bounds);
    const alt = project(state, bumped, scenario);
    return { parameter: LABEL[key], deltaYield: round(alt.product - end.product) };
  });
  influences.sort((a, b) => Math.abs(b.deltaYield) - Math.abs(a.deltaYield));
  return {
    kind: "baseline",
    disclaimer: DISCLAIMER,
    predictedYield: round(end.product),
    targetYield: TARGET_YIELD_G_L,
    uncertainty: round(Math.max(0.2, end.product * 0.08 * remaining + activeCount * 0.35)),
    etaMin: Math.max(0, BATCH_MINUTES - state.tMin),
    influences,
  };
}

export function recommend(
  state: ProcessState,
  setpoints: Setpoints,
  scenario: Scenario,
  bounds: Bounds,
  alarms: Alarm[],
): Recommendation | null {
  const oxygen = alarms.some((item) => item.parameter === "dissolvedOxygen");
  const ph = alarms.some((item) => item.parameter === "ph");
  const hot = alarms.some((item) => item.parameter === "temperature");
  if (!oxygen && !ph && !hot) return null;

  const proposed = { ...setpoints };
  if (oxygen) {
    proposed.agitation = Math.min(bounds.agitation.max, setpoints.agitation + 80);
    proposed.aeration = Math.min(bounds.aeration.max, setpoints.aeration + 0.35);
  }
  if (ph && state.ph < setpoints.ph) {
    proposed.feedRate = Math.max(bounds.feedRate.min, setpoints.feedRate - 0.15);
  }
  if (hot) proposed.temperature = clampSetpoints({ ...proposed, temperature: 37 }, bounds).temperature;
  const clamped = clampSetpoints(proposed, bounds);
  const currentEnd = project(state, setpoints, scenario).product;
  const proposedEnd = project(state, clamped, scenario).product;
  const title = oxygen ? "Raise oxygen transfer" : phTitle(ph);
  const reason = oxygen
    ? `Dissolved oxygen is ${state.dissolvedOxygen.toFixed(1)}%, below the ${setpoints.dissolvedOxygen.toFixed(0)}% setpoint.`
    : phReason(ph, state, setpoints);
  return {
    title,
    reason,
    proposed: clamped,
    currentYield: round(currentEnd),
    proposedYield: round(proposedEnd),
    currentPowerKw: illustrativePowerKw(setpoints),
    proposedPowerKw: illustrativePowerKw(clamped),
    effect:
      "Yield figures are the baseline kinetic projection. Power is an illustrative estimate from agitation and air rate, not a meter reading. The suggestion is not a validated control law.",
  };
}

export function explainProcess(
  state: ProcessState,
  alarms: Alarm[],
  forecast: ProteinForecast,
): { happening: string; why: string; next: string } {
  const lead = alarms[0];
  const remaining = Math.max(0, BATCH_MINUTES - state.tMin);
  if (!lead) {
    return {
      happening: `At ${state.tMin} min the broth holds ${state.biomass.toFixed(1)} g/L yeast, ${state.ethanol.toFixed(1)} g/L ethanol, and ${state.dissolvedOxygen.toFixed(0)}% dissolved oxygen.`,
      why: "Model A's fault score is under the threshold for this sensitivity, so the run looks like a normal batch at this minute.",
      next: `Model A predicts ${forecast.kg.toFixed(1)} kg protein (80% range ${forecast.low.toFixed(1)}–${forecast.high.toFixed(1)} kg) at the planned end, ${remaining} min from now.`,
    };
  }
  return {
    happening: lead.evidence,
    why: lead.reason,
    next: `Model A predicts ${forecast.kg.toFixed(1)} kg protein (${forecast.low.toFixed(1)}–${forecast.high.toFixed(1)} kg). Check the candidate table before changing air or agitation.`,
  };
}

/**
 * Plain sentences about damage that the readings already point at, before that damage has finished.
 * `aheadEthanol` is the kinetic end only when the caller has projected the rest of a still-open batch.
 */
export function forewarning(
  samples: ProcessState[],
  setpoints: Setpoints,
  sensitivity: number,
  aheadEthanol: number | null = null,
): string {
  const now = samples.at(-1);
  if (!now || now.tMin < 10) {
    return "The batch has not moved far enough to warn. The first useful sign is dissolved oxygen leaving its target, or pH and temperature leaving 5 and 30°C, while ethanol is still low.";
  }

  const lines: string[] = [];
  const oxygenShort = samples.find((row) => row.tMin >= 40 && row.dissolvedOxygen < setpoints.dissolvedOxygen - 2);
  const ethanolLater = oxygenShort
    ? samples.find((row) => row.tMin > oxygenShort.tMin + 30 && row.ethanol > oxygenShort.ethanol + 1)
    : undefined;

  if (oxygenShort && ethanolLater) {
    lines.push(
      `Dissolved oxygen was already under the ${setpoints.dissolvedOxygen.toFixed(0)}% target at ${oxygenShort.tMin} min (${oxygenShort.dissolvedOxygen.toFixed(0)}%), before ethanol reached ${ethanolLater.ethanol.toFixed(1)} g/L at ${ethanolLater.tMin} min. Sugar that missed the oxygen became ethanol instead of yeast protein. Contamination is not confirmed.`,
    );
  } else if (oxygenShort && aheadEthanol !== null && aheadEthanol > now.ethanol + 1) {
    lines.push(
      `Dissolved oxygen is already under the ${setpoints.dissolvedOxygen.toFixed(0)}% target at ${oxygenShort.tMin} min (${oxygenShort.dissolvedOxygen.toFixed(0)}%), and ethanol is still ${now.ethanol.toFixed(1)} g/L. Held on these knobs, the kinetic path puts ethanol near ${aheadEthanol.toFixed(1)} g/L by the end. Those grams do not become protein. The amino-acid pattern does not change.`,
    );
  }

  const phOff = samples.find((row) => row.tMin >= 16 && Math.abs(row.ph - 5) >= 0.4);
  if (phOff && Math.abs(now.ph - 5) >= 0.35 && lines.length < 2) {
    lines.push(
      `pH left 5 at ${phOff.tMin} min (it was ${phOff.ph.toFixed(2)}). Growth in this model is fastest at 5, so staying here slows the kilograms. It does not change which amino acid is limiting.`,
    );
  }

  const warm = samples.find((row) => row.tMin >= 16 && Math.abs(row.temperature - 30) >= 2);
  if (warm && Math.abs(now.temperature - 30) >= 1.5 && lines.length < 2) {
    lines.push(
      `Temperature left 30°C at ${warm.tMin} min (it was ${warm.temperature.toFixed(1)}°C). Warmer or cooler from there is slower growth, not a different protein.`,
    );
  }

  const fault = readFault(samples, sensitivity);
  if (lines.length < 2 && !fault.fault && fault.score > fault.threshold * 0.7 && now.tMin >= 40) {
    const names = faultEvidence(now)
      .slice(0, 2)
      .map((item) => item.label)
      .join(" and ");
    lines.push(
      `The fault score is ${fault.score.toFixed(2)}, still under ${fault.threshold.toFixed(2)}. ${names} are the readings pulling it up. If they keep drifting, the batch will be marked suspected. Contamination is not confirmed.`,
    );
  }

  if (lines.length === 0) {
    return `At ${now.tMin} min nothing is running ahead of the protein. Dissolved oxygen is ${now.dissolvedOxygen.toFixed(0)}% against a ${setpoints.dissolvedOxygen.toFixed(0)}% target, pH is ${now.ph.toFixed(2)}, temperature is ${now.temperature.toFixed(1)}°C, and ethanol is ${now.ethanol.toFixed(1)} g/L.`;
  }
  return lines.join(" ");
}

export function correlations(samples: ProcessState[]) {
  const pairs: [keyof ProcessState, keyof ProcessState][] = [
    ["dissolvedOxygen", "product"],
    ["ph", "product"],
    ["temperature", "biomass"],
    ["substrate", "biomass"],
  ];
  if (samples.length < 8) {
    return { ready: false as const, note: "Need at least 8 samples from this batch before a correlation is reported." };
  }
  const rows = pairs.map(([left, right]) => ({
    left: LABEL[left] ?? left,
    right: LABEL[right] ?? right,
    r: pearson(
      samples.map((row) => Number(row[left])),
      samples.map((row) => Number(row[right])),
    ),
  }));
  return { ready: true as const, rows };
}

export function samplesToCsv(samples: ProcessState[]) {
  const headers = [
    "t_min",
    "ph",
    "temperature_c",
    "dissolved_oxygen_pct",
    "agitation_rpm",
    "aeration_vvm",
    "feed_rate",
    "biomass_g_l",
    "substrate_g_l",
    "co2",
    "product_g_l",
    "volume_l",
  ];
  const lines = samples.map((row) =>
    [
      row.tMin,
      row.ph,
      row.temperature,
      row.dissolvedOxygen,
      row.agitation,
      row.aeration,
      row.feedRate,
      row.biomass,
      row.substrate,
      row.co2,
      row.product,
      row.volume,
    ]
      .map((value) => Number(value).toFixed(4))
      .join(","),
  );
  return [headers.join(","), ...lines].join("\n");
}

const LABEL: Record<string, string> = {
  ph: "pH",
  temperature: "Temperature",
  agitation: "Agitation",
  aeration: "Aeration",
  feedRate: "Feed rate",
  dissolvedOxygen: "Dissolved oxygen",
  product: "Product",
  biomass: "Biomass",
  substrate: "Substrate",
};

function alarm(
  state: ProcessState,
  parameter: string,
  partId: string,
  severity: Alarm["severity"],
  evidence: string,
  reason: string,
): Alarm {
  return {
    id: `${parameter}-${state.tMin}`,
    parameter,
    partId,
    severity,
    tMin: state.tMin,
    evidence,
    reason,
    contaminationConfirmed: false,
  };
}

function phTitle(ph: boolean) {
  return ph ? "Slow the acid load" : "Bring temperature back";
}

function phReason(ph: boolean, state: ProcessState, setpoints: Setpoints) {
  if (ph) return `pH is ${state.ph.toFixed(2)}, away from ${setpoints.ph.toFixed(2)}.`;
  return `Temperature is ${state.temperature.toFixed(2)}°C.`;
}

function nudge(value: number, key: SetpointKey) {
  if (key === "ph") return value + 0.2;
  if (key === "temperature") return value + 1;
  if (key === "agitation") return value + 50;
  if (key === "aeration") return value + 0.2;
  return value + 0.1;
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}

function pearson(xs: number[], ys: number[]) {
  const n = xs.length;
  const mx = xs.reduce((sum, value) => sum + value, 0) / n;
  const my = ys.reduce((sum, value) => sum + value, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const a = (xs[i] ?? 0) - mx;
    const b = (ys[i] ?? 0) - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  if (dx === 0 || dy === 0) return 0;
  return Math.round((num / Math.sqrt(dx * dy)) * 100) / 100;
}
