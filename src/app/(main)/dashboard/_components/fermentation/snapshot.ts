"use client";

import { useMemo } from "react";

import {
  BATCH_MINUTES,
  FEEDSTOCK_PARAMS,
  illustrativePowerKw,
  proteinFractionScale,
  scaleForecast,
} from "@/lib/fermentation/model";
import { driversAt, faultEvidence, forecastProtein, readFault } from "@/lib/fermentation/model-a";
import { economics, modelB, scoreOf } from "@/lib/fermentation/protein";
import { useFermentation } from "@/stores/fermentation-store";

/** One read of the live yeast run: Model A, Model B, price, and how far the batch has gone. */
export function useRunSnapshot() {
  const live = useFermentation((s) => s.live);
  const feedstock = useFermentation((s) => s.feedstock);
  const nitrogen = useFermentation((s) => s.nitrogen);
  const cnRatio = useFermentation((s) => s.cnRatio);
  const sensitivity = useFermentation((s) => s.sensitivity);
  const forecast = scaleForecast(forecastProtein(live.samples, live.setpoints, feedstock), nitrogen, cnRatio);
  const fault = readFault(live.samples, sensitivity);
  const pattern = modelB(feedstock);
  const run = useMemo(
    () => economics(forecast, live.state, live.setpoints, live.scenario, feedstock),
    [forecast, live.state, live.setpoints, live.scenario, feedstock],
  );
  const score = scoreOf(run, pattern, fault);
  return {
    live,
    feedstock,
    nitrogen,
    cnRatio,
    sensitivity,
    forecast,
    fault,
    pattern,
    run,
    score,
    elapsed: live.state.tMin / BATCH_MINUTES,
    powerKw: illustrativePowerKw(live.setpoints),
    drivers: driversAt(forecast.frac).slice(0, 4),
    evidence: faultEvidence(live.state),
    sugar: FEEDSTOCK_PARAMS[feedstock],
    scale: proteinFractionScale(nitrogen, cnRatio),
  };
}
