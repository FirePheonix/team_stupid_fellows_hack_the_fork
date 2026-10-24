"use client";

import { create } from "zustand";

import { type Alarm, evaluateAlarms, predictYield, rememberAlarms, samplesToCsv } from "@/lib/fermentation/insights";
import {
  BATCH_MINUTES,
  type Bounds,
  clampSetpoints,
  DEFAULT_BOUNDS,
  DEFAULT_SETPOINTS,
  initialState,
  type ProcessState,
  REACTOR_ID,
  runMinutes,
  type Scenario,
  type SetpointKey,
  type Setpoints,
  step,
} from "@/lib/fermentation/model";

export type BatchStatus = "idle" | "running" | "paused" | "finished";

export type StoredBatch = {
  id: string;
  name: string;
  reactor: string;
  scenario: Scenario;
  status: BatchStatus;
  setpoints: Setpoints;
  samples: ProcessState[];
  alarms: Alarm[];
  startedAt: string;
  finishedAt: string | null;
};

type LiveBatch = StoredBatch & { state: ProcessState };

type FermentationStore = {
  bounds: Bounds;
  sensitivity: number;
  speed: 1 | 4 | 12;
  dissect: boolean;
  selectedPart: string | null;
  preview: Setpoints | null;
  history: StoredBatch[];
  live: LiveBatch;
  tick: () => void;
  start: () => void;
  pause: () => void;
  reset: () => void;
  finish: () => void;
  setScenario: (scenario: Scenario) => void;
  setSetpoint: (key: SetpointKey, value: number) => void;
  setSensitivity: (value: number) => void;
  setBound: (key: SetpointKey, edge: "min" | "max", value: number) => void;
  setDissect: (value: boolean) => void;
  setSelectedPart: (id: string | null) => void;
  setSpeed: (speed: 1 | 4 | 12) => void;
  setPreview: (setpoints: Setpoints | null) => void;
  applyPreview: () => void;
  hydrate: () => void;
};

const STORAGE_KEY = "fermatwin.v1";

export const useFermentation = create<FermentationStore>((set, get) => ({
  bounds: DEFAULT_BOUNDS,
  sensitivity: 50,
  speed: 1,
  dissect: false,
  selectedPart: null,
  preview: null,
  history: seedHistory(),
  live: idleBatch(DEFAULT_SETPOINTS, "stable", "BR-101 live"),
  tick: () => {
    const { live, speed, sensitivity } = get();
    if (live.status !== "running") return;
    let state = live.state;
    const samples = live.samples.slice();
    let alarms = live.alarms;
    const steps = speed;
    for (let i = 0; i < steps; i++) {
      state = step(state, live.setpoints, live.scenario);
      samples.push(state);
      const earlier = samples[Math.max(0, samples.length - 6)] ?? null;
      alarms = rememberAlarms(alarms, evaluateAlarms(state, earlier, live.setpoints, live.scenario, sensitivity));
      if (state.tMin >= BATCH_MINUTES) break;
    }
    const done = state.tMin >= BATCH_MINUTES;
    const next: LiveBatch = {
      ...live,
      state,
      samples,
      alarms,
      status: done ? "finished" : "running",
      finishedAt: done ? new Date().toISOString() : null,
    };
    set({ live: next });
    if (done) archive(get, set, next);
    else persist(get());
  },
  start: () => {
    const { live, bounds } = get();
    if (live.status === "paused") {
      set({ live: { ...live, status: "running" } });
      return;
    }
    if (live.status === "running") return;
    const setpoints = clampSetpoints(live.setpoints, bounds);
    const state = initialState(setpoints);
    set({
      preview: null,
      live: {
        ...idleBatch(setpoints, live.scenario, `${REACTOR_ID} ${live.scenario}`),
        status: "running",
        state,
        samples: [state],
        startedAt: new Date().toISOString(),
      },
    });
  },
  pause: () => {
    const { live } = get();
    if (live.status === "running") set({ live: { ...live, status: "paused" } });
  },
  reset: () => {
    const { live, bounds } = get();
    const setpoints = clampSetpoints(DEFAULT_SETPOINTS, bounds);
    set({ preview: null, live: idleBatch(setpoints, live.scenario, `${REACTOR_ID} live`) });
    persist(get());
  },
  finish: () => {
    const { live } = get();
    if (live.status === "idle") return;
    const next = { ...live, status: "finished" as const, finishedAt: new Date().toISOString() };
    set({ live: next });
    archive(get, set, next);
  },
  setScenario: (scenario) => set({ live: { ...get().live, scenario } }),
  setSetpoint: (key, value) => {
    const { live, bounds } = get();
    const setpoints = clampSetpoints({ ...live.setpoints, [key]: value }, bounds);
    set({ live: { ...live, setpoints } });
  },
  setSensitivity: (sensitivity) => set({ sensitivity }),
  setBound: (key, edge, value) => {
    const bounds = { ...get().bounds, [key]: { ...get().bounds[key], [edge]: value } };
    set({ bounds, live: { ...get().live, setpoints: clampSetpoints(get().live.setpoints, bounds) } });
  },
  setDissect: (dissect) => set({ dissect }),
  setSelectedPart: (selectedPart) => set({ selectedPart }),
  setSpeed: (speed) => set({ speed }),
  setPreview: (preview) => set({ preview }),
  applyPreview: () => {
    const { preview, live, bounds } = get();
    if (!preview) return;
    set({ preview: null, live: { ...live, setpoints: clampSetpoints(preview, bounds) } });
  },
  hydrate: () => {
    if (typeof window === "undefined") return;
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      persist(get());
      return;
    }
    try {
      const saved = JSON.parse(raw) as Partial<FermentationStore>;
      set({
        bounds: saved.bounds ?? get().bounds,
        sensitivity: saved.sensitivity ?? get().sensitivity,
        history: saved.history?.length ? saved.history : get().history,
        live: saved.live ?? get().live,
      });
    } catch {
      persist(get());
    }
  },
}));

export function usePrediction() {
  const live = useFermentation((s) => s.live);
  const bounds = useFermentation((s) => s.bounds);
  const sensitivity = useFermentation((s) => s.sensitivity);
  const active = evaluateAlarms(live.state, earlierSample(live.samples), live.setpoints, live.scenario, sensitivity);
  return predictYield(live.state, live.setpoints, live.scenario, bounds, active.length);
}

export function downloadCsv(samples: ProcessState[], name: string) {
  const blob = new Blob([samplesToCsv(samples)], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${name}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function idleBatch(setpoints: Setpoints, scenario: Scenario, name: string): LiveBatch {
  const state = initialState(setpoints);
  return {
    id: "live",
    name,
    reactor: REACTOR_ID,
    scenario,
    status: "idle",
    setpoints,
    state,
    samples: [state],
    alarms: [],
    startedAt: "",
    finishedAt: null,
  };
}

function archive(get: () => FermentationStore, set: (partial: Partial<FermentationStore>) => void, live: LiveBatch) {
  if (live.samples.length < 2) return;
  const record: StoredBatch = {
    id: `batch-${Date.now()}`,
    name: live.name,
    reactor: live.reactor,
    scenario: live.scenario,
    status: "finished",
    setpoints: live.setpoints,
    samples: live.samples.filter((_, index) => index % 5 === 0 || index === live.samples.length - 1),
    alarms: live.alarms,
    startedAt: live.startedAt || new Date().toISOString(),
    finishedAt: live.finishedAt,
  };
  const history = [record, ...get().history].slice(0, 24);
  set({ history });
  persist({ ...get(), history });
  void import("@/server/fermentation-actions").then((mod) => mod.saveFermentationBatch(record)).catch(() => undefined);
}

function earlierSample(samples: ProcessState[]) {
  return samples[Math.max(0, samples.length - 6)] ?? null;
}

function seedHistory(): StoredBatch[] {
  return [
    seeded("demo-stable", "Demo · stable", "stable", "2026-06-10T05:00:00.000Z"),
    seeded("demo-oxygen", "Demo · oxygen limit", "oxygen-limitation", "2026-06-11T05:00:00.000Z"),
  ];
}

function seeded(id: string, name: string, scenario: Scenario, startedAt: string): StoredBatch {
  const samples = runMinutes(scenario, DEFAULT_SETPOINTS, BATCH_MINUTES, 10);
  let alarms: Alarm[] = [];
  for (let i = 0; i < samples.length; i++) {
    const state = samples[i];
    if (!state) continue;
    alarms = rememberAlarms(
      alarms,
      evaluateAlarms(state, samples[Math.max(0, i - 2)] ?? null, DEFAULT_SETPOINTS, scenario, 50),
    );
  }
  return {
    id,
    name,
    reactor: REACTOR_ID,
    scenario,
    status: "finished",
    setpoints: DEFAULT_SETPOINTS,
    samples,
    alarms,
    startedAt,
    finishedAt: startedAt,
  };
}

function persist(state: Pick<FermentationStore, "bounds" | "sensitivity" | "history" | "live">) {
  if (typeof window === "undefined") return;
  const payload = { bounds: state.bounds, sensitivity: state.sensitivity, history: state.history, live: state.live };
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}
