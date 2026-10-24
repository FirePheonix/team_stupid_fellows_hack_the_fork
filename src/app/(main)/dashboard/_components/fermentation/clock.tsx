"use client";

import { type ReactNode, useEffect } from "react";

import { useFermentation } from "@/stores/fermentation-store";

export function FermentationClock({ children }: { children: ReactNode }) {
  const tick = useFermentation((s) => s.tick);
  const hydrate = useFermentation((s) => s.hydrate);
  useEffect(() => {
    hydrate();
    const id = window.setInterval(tick, 500);
    return () => window.clearInterval(id);
  }, [hydrate, tick]);
  return children;
}
