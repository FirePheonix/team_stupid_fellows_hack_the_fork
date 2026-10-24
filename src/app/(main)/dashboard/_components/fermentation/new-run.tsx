"use client";

import type { ReactNode } from "react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { parseOffline, repairRun, runFromState } from "@/lib/fermentation/agent";
import {
  DEFAULT_CN,
  DEFAULT_SETPOINTS,
  FEEDSTOCK_PARAMS,
  type FeedstockId,
  type Nitrogen,
  SCENARIOS,
  type Scenario,
  type Setpoints,
} from "@/lib/fermentation/model";
import { parseTurn } from "@/server/fermatwin-actions";
import { useFermentation } from "@/stores/fermentation-store";

const FEEDSTOCKS = Object.entries(FEEDSTOCK_PARAMS) as [FeedstockId, (typeof FEEDSTOCK_PARAMS)[FeedstockId]][];

const NITROGEN: { id: Nitrogen; label: string; note: string }[] = [
  { id: "ammonia", label: "Ammonia", note: "The training point for the protein fraction." },
  {
    id: "yeast-extract",
    label: "Yeast extract",
    note: "A modelling assumption: a little more cell protein than ammonia.",
  },
];

const RATIOS = [
  { value: 8, label: "C/N 8", note: "Usual. This is the point Model A was trained at." },
  { value: 12, label: "C/N 12", note: "Less nitrogen per sugar, so the cell stores less protein." },
  { value: 5, label: "C/N 5", note: "More nitrogen per sugar, inside the allowed 5–20 band." },
];

type PresetId = "usual" | "less-air" | "harder" | "mild-ph";

const PRESETS: { id: PresetId; label: string; note: string }[] = [
  { id: "usual", label: "Usual settings", note: "pH 5, 30°C, air 1.2 vvm, feed 0.35." },
  { id: "less-air", label: "Less air", note: "Air falls to 0.48 vvm. Short air sends sugar into ethanol." },
  {
    id: "harder",
    label: "Feed harder",
    note: "Sugar feed rises to 0.45. Past the oxygen supply, extra feed becomes ethanol.",
  },
  { id: "mild-ph", label: "pH 5.5", note: "A little less acid than the usual pH 5." },
];

type Draft = {
  feedstock: FeedstockId;
  nitrogen: Nitrogen;
  cnRatio: number;
  scenario: Scenario;
  preset: PresetId | null;
  setpoints: Setpoints;
  note: string;
};

const STEPS = ["Sugar", "Nitrogen", "Carbon to nitrogen", "Disturbance", "Settings", "A note"] as const;

function presetSetpoints(id: PresetId): Setpoints {
  const next = { ...DEFAULT_SETPOINTS };
  if (id === "less-air") next.aeration = 0.48;
  if (id === "harder") next.feedRate = 0.45;
  if (id === "mild-ph") next.ph = 5.5;
  return next;
}

function setpointsFromSettings(
  settings: { sugarFeed: number; aeration: number; agitation: number; temperatureC: number; ph: number },
  base: Setpoints,
): Setpoints {
  return {
    ...base,
    feedRate: settings.sugarFeed,
    aeration: settings.aeration,
    agitation: settings.agitation,
    temperature: settings.temperatureC,
    ph: settings.ph,
  };
}

function matchingPreset(setpoints: Setpoints): PresetId | null {
  for (const item of PRESETS) {
    const candidate = presetSetpoints(item.id);
    const same =
      candidate.aeration === setpoints.aeration &&
      candidate.feedRate === setpoints.feedRate &&
      candidate.ph === setpoints.ph &&
      candidate.temperature === setpoints.temperature &&
      candidate.agitation === setpoints.agitation;
    if (same) return item.id;
  }
  return null;
}

function Choice({ on, label, note, onPick }: { on: boolean; label: string; note: string; onPick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onPick}
      className={
        on ? "rounded-lg border border-primary bg-muted px-3 py-2 text-left" : "rounded-lg border px-3 py-2 text-left"
      }
    >
      <span className="block font-medium text-sm">{label}</span>
      <span className="block text-muted-foreground text-xs">{note}</span>
    </button>
  );
}

export function NewRunFrame({ children }: { children: ReactNode }) {
  const open = useFermentation((state) => state.intakeOpen);
  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
      <div
        className={
          open ? "pointer-events-none flex min-h-0 flex-1 select-none flex-col blur-sm" : "flex min-h-0 flex-1 flex-col"
        }
        aria-hidden={open}
      >
        {children}
      </div>
      {open ? <NewRunDialog /> : null}
    </div>
  );
}

function NewRunDialog() {
  const closeIntake = useFermentation((state) => state.closeIntake);
  const feedstock = useFermentation((state) => state.feedstock);
  const nitrogen = useFermentation((state) => state.nitrogen);
  const cnRatio = useFermentation((state) => state.cnRatio);
  const scenario = useFermentation((state) => state.live.scenario);
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<Draft>({
    feedstock,
    nitrogen,
    cnRatio: RATIOS.some((item) => item.value === cnRatio) ? cnRatio : DEFAULT_CN,
    scenario,
    preset: "usual",
    setpoints: { ...DEFAULT_SETPOINTS },
    note: "",
  });
  const [ask, setAsk] = useState("");
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const last = step === STEPS.length - 1;

  function applyParsed(text: string, source: Draft) {
    const current = runFromState(source.feedstock, source.setpoints, {
      nitrogen: source.nitrogen,
      cnRatio: source.cnRatio,
    });
    return parseTurn(text, current, null)
      .catch(() => null)
      .then((remote) => {
        const offline = parseOffline(text, current, null);
        const parsed = repairRun(remote?.run ?? null, offline);
        const settings = { ...parsed.settings };
        for (const key of ["sugarFeed", "aeration", "agitation", "temperatureC", "ph"] as const) {
          if (offline.settings[key] !== current.settings[key]) settings[key] = offline.settings[key];
        }
        const feedstock = offline.feedstock !== current.feedstock ? offline.feedstock : parsed.feedstock;
        const nitrogen = offline.nitrogen !== current.nitrogen ? offline.nitrogen : parsed.nitrogen;
        const cnRatio = offline.cnRatio !== current.cnRatio ? offline.cnRatio : parsed.cnRatio;
        const changed =
          feedstock !== current.feedstock ||
          nitrogen !== current.nitrogen ||
          cnRatio !== current.cnRatio ||
          settings.sugarFeed !== current.settings.sugarFeed ||
          settings.aeration !== current.settings.aeration ||
          settings.agitation !== current.settings.agitation ||
          settings.temperatureC !== current.settings.temperatureC ||
          settings.ph !== current.settings.ph;
        if (!changed) {
          return {
            message: parsed.unsupportedReason ?? "That sentence did not change a setting.",
            next: null,
          };
        }
        const setpoints = setpointsFromSettings(settings, source.setpoints);
        const next: Draft = {
          ...source,
          feedstock,
          nitrogen,
          cnRatio,
          setpoints,
          preset: matchingPreset(setpoints),
        };
        setDraft(next);
        return { message: "Applied to this batch.", next };
      });
  }

  async function onAsk() {
    const text = ask.trim();
    if (!text || busy) return;
    setBusy(true);
    const result = await applyParsed(text, draft);
    setReply(result.message);
    setAsk("");
    setBusy(false);
    if (result.next && !last) setStep((value) => value + 1);
  }

  function begin(source: Draft) {
    const store = useFermentation.getState();
    if (store.live.status === "running" || store.live.status === "paused") store.finish();
    store.setFeedstock(source.feedstock);
    store.setNitrogen(source.nitrogen);
    store.setCnRatio(source.cnRatio);
    store.setScenario(source.scenario);
    for (const key of Object.keys(source.setpoints) as (keyof Setpoints)[]) {
      store.setSetpoint(key, source.setpoints[key]);
    }
    store.start();
    store.closeIntake();
  }

  async function finishNote() {
    const text = draft.note.trim();
    let source = draft;
    if (text) {
      setBusy(true);
      const result = await applyParsed(text, draft);
      setBusy(false);
      if (result.next) source = result.next;
    }
    begin(source);
  }

  return (
    <div className="pointer-events-none absolute inset-0 z-40">
      <div className="sticky top-0 flex h-dvh items-center justify-center p-4 md:p-8">
        <form
          className="pointer-events-auto flex max-h-[calc(100dvh-2rem)] w-full max-w-lg flex-col gap-4 overflow-y-auto rounded-xl border bg-card p-6 shadow-lg"
          onSubmit={(event) => {
            event.preventDefault();
            if (last) {
              void finishNote();
              return;
            }
            if (ask.trim()) {
              void onAsk();
              return;
            }
            setStep((value) => value + 1);
          }}
        >
          <div className="flex items-center justify-between gap-3">
            <p className="text-muted-foreground text-xs">
              Step {step + 1} of {STEPS.length} · {STEPS[step]}
            </p>
            <button type="button" className="text-muted-foreground text-xs underline" onClick={closeIntake}>
              Cancel
            </button>
          </div>
          {step === 0 ? (
            <Step title="Which sugar is this batch grown on?" info={WHY.sugar}>
              {FEEDSTOCKS.map(([id, item]) => (
                <Choice
                  key={id}
                  on={draft.feedstock === id}
                  label={item.label}
                  note={`₹${item.priceInrPerKgSugar}/kg sugar. Sets the price and the amino-acid row.`}
                  onPick={() => setDraft({ ...draft, feedstock: id })}
                />
              ))}
            </Step>
          ) : null}
          {step === 1 ? (
            <Step title="Which nitrogen source?" info={WHY.nitrogen}>
              {NITROGEN.map((item) => (
                <Choice
                  key={item.id}
                  on={draft.nitrogen === item.id}
                  label={item.label}
                  note={item.note}
                  onPick={() => setDraft({ ...draft, nitrogen: item.id })}
                />
              ))}
            </Step>
          ) : null}
          {step === 2 ? (
            <Step title="What carbon-to-nitrogen ratio?" info={WHY.cn}>
              {RATIOS.map((item) => (
                <Choice
                  key={item.value}
                  on={draft.cnRatio === item.value}
                  label={item.label}
                  note={item.note}
                  onPick={() => setDraft({ ...draft, cnRatio: item.value })}
                />
              ))}
            </Step>
          ) : null}
          {step === 3 ? (
            <Step title="Should the batch stay steady, or carry a scripted disturbance?" info={WHY.disturbance}>
              {SCENARIOS.map((item) => (
                <Choice
                  key={item.id}
                  on={draft.scenario === item.id}
                  label={item.label}
                  note={item.note}
                  onPick={() => setDraft({ ...draft, scenario: item.id })}
                />
              ))}
            </Step>
          ) : null}
          {step === 4 ? (
            <Step title="Where should the controls start?" info={WHY.settings}>
              {PRESETS.map((item) => (
                <Choice
                  key={item.id}
                  on={draft.preset === item.id}
                  label={item.label}
                  note={item.note}
                  onPick={() => setDraft({ ...draft, preset: item.id, setpoints: presetSetpoints(item.id) })}
                />
              ))}
            </Step>
          ) : null}
          {last ? (
            <Step title="Anything you'd like to let us know?" info={WHY.note}>
              <textarea
                value={draft.note}
                onChange={(event) => setDraft({ ...draft, note: event.target.value })}
                rows={3}
                placeholder="Less air, hold 30°C, or leave this blank."
                className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
              />
              <p className="text-muted-foreground text-xs">
                A sentence is read as a run card. It does not invent a yield, and a fault flag does not confirm
                contamination.
              </p>
            </Step>
          ) : (
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground text-xs">Or say it in a sentence</span>
              <input
                value={ask}
                onChange={(event) => setAsk(event.target.value)}
                placeholder="Pea-starch hydrolysate, less air"
                className="rounded-lg border bg-background px-3 py-2"
              />
            </label>
          )}
          {reply ? <p className="text-muted-foreground text-xs">{reply}</p> : null}
          <div className="flex items-center justify-between gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={step === 0 || busy}
              onClick={() => setStep((value) => value - 1)}
            >
              Back
            </Button>
            <Button type="submit" disabled={busy}>
              {last ? "Start the batch" : "Continue"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

const WHY = {
  sugar:
    "The sugar is what the yeast turns into protein, and it sets the rupee price. More protein in the cell is better, but a cheaper sugar can still win on selling price if the batch makes enough kilograms. Glucose is the clean reference. Cane molasses is cheaper and the cell stores a little less protein. Pea-starch hydrolysate stores a little more protein and grows a little slower. All three use the same published amino-acid row, so the limiting amino acid does not change with the sugar. The protein is the yeast, not leftover pea.",
  nitrogen:
    "Nitrogen is what lets the cell store protein instead of only carbohydrate. Ammonia is the training point. Yeast extract is a modelling assumption: a little more protein in the cell. That raises protein kilograms. It does not change the amino-acid pattern, which still comes from the published row.",
  cn: "Carbon-to-nitrogen is how much sugar arrives per unit of nitrogen. Around 8, the cell stores the protein fraction Model A was trained on. Lower than 8 means more nitrogen per sugar, so the cell stores more protein, up to a small cap. Higher than 8 means the nitrogen runs short and the cell stores less protein. The amino-acid pattern stays the published row either way.",
  disturbance:
    "A steady batch keeps pH, temperature, and oxygen near the setpoints, which is where this yeast turns sugar into protein. Oxygen limitation cuts gas transfer: dissolved oxygen falls, sugar becomes ethanol, protein kilograms fall, and the selling price rises. pH drift lets acid pull the broth off pH 5, and growth slows on either side of that point. A contamination pattern adds a second consumer of the sugar. The sensors can suggest it. They cannot confirm it.",
  settings:
    "pH is most comfortable at 5. Higher or lower slows growth, so the batch makes fewer kilograms of protein. It does not change which amino acid is limiting. Temperature works the same way around 30°C: warmer or cooler is slower growth. Enough air keeps the sugar on the path to yeast protein. Short air sends it into ethanol and cuts those kilograms, and more air also adds calculated electricity to the price. More feed grows more yeast until it passes the oxygen supply; past that, the extra sugar becomes ethanol. Faster agitation moves more oxygen in, which helps, and it also adds electricity, so the selling price can rise even when the protein rises.",
  note: "Use this if a button missed something: a sugar, less air, a temperature, or a pH. The sentence changes only the setting it names. It does not invent a yield, and a fault flag does not confirm contamination.",
} as const;

function Step({ title, info, children }: { title: string; info: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start gap-2">
        <h2 className="font-medium text-lg">{title}</h2>
        <button
          type="button"
          aria-expanded={open}
          aria-label="Why we ask this"
          onClick={() => setOpen((value) => !value)}
          className="mt-1 inline-flex size-4 shrink-0 items-center justify-center rounded-full border text-[10px] leading-none"
        >
          i
        </button>
      </div>
      {open ? <p className="text-muted-foreground text-xs">{info}</p> : null}
      {children}
    </div>
  );
}
