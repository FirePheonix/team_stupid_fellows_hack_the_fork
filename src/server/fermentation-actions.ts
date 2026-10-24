"use server";

import { desc, eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db/drizzle";
import { fermentationAnomalies, fermentationBatches, fermentationSamples } from "@/lib/db/schema";
import { databaseUrl } from "@/lib/db/url";
import type { Alarm } from "@/lib/fermentation/insights";
import type { ProcessState, Setpoints } from "@/lib/fermentation/model";

export type SavedBatch = {
  id: string;
  name: string;
  reactor: string;
  scenario: string;
  status: string;
  setpoints: Setpoints;
  samples: ProcessState[];
  alarms: Alarm[];
  startedAt: string;
  finishedAt: string | null;
};

export async function saveFermentationBatch(batch: SavedBatch) {
  if (!databaseUrl()) return { stored: false as const };
  try {
    await db
      .insert(fermentationBatches)
      .values({
        id: batch.id,
        name: batch.name,
        reactor: batch.reactor,
        scenario: batch.scenario,
        status: batch.status,
        setpoints: batch.setpoints,
        startedAt: batch.startedAt ? new Date(batch.startedAt) : null,
        finishedAt: batch.finishedAt ? new Date(batch.finishedAt) : null,
      })
      .onConflictDoUpdate({
        target: fermentationBatches.id,
        set: {
          name: batch.name,
          status: batch.status,
          setpoints: batch.setpoints,
          finishedAt: batch.finishedAt ? new Date(batch.finishedAt) : null,
        },
      });
    await db.delete(fermentationSamples).where(eq(fermentationSamples.batchId, batch.id));
    await db.delete(fermentationAnomalies).where(eq(fermentationAnomalies.batchId, batch.id));
    if (batch.samples.length > 0) {
      await db.insert(fermentationSamples).values(
        batch.samples.map((row) => ({
          batchId: batch.id,
          tMin: row.tMin,
          ph: row.ph,
          temperature: row.temperature,
          dissolvedOxygen: row.dissolvedOxygen,
          agitation: row.agitation,
          aeration: row.aeration,
          feedRate: row.feedRate,
          biomass: row.biomass,
          substrate: row.substrate,
          co2: row.co2,
          product: row.product,
          ethanol: row.ethanol,
          contaminant: row.contaminant,
          sugarFedKg: row.sugarFedKg,
          energyKwh: row.energyKwh,
          volume: row.volume,
        })),
      );
    }
    if (batch.alarms.length > 0) {
      await db.insert(fermentationAnomalies).values(
        batch.alarms.map((row) => ({
          id: `${batch.id}:${row.id}`,
          batchId: batch.id,
          parameter: row.parameter,
          partId: row.partId,
          severity: row.severity,
          tMin: row.tMin,
          evidence: row.evidence,
          reason: row.reason,
          contaminationConfirmed: false,
        })),
      );
    }
    return { stored: true as const };
  } catch (error) {
    console.warn("Fermentation batch stayed in the browser. Supabase did not accept it.", error);
    return { stored: false as const };
  }
}

export async function listFermentationBatches(): Promise<SavedBatch[]> {
  if (!databaseUrl()) return [];
  try {
    const batches = await db.select().from(fermentationBatches).orderBy(desc(fermentationBatches.startedAt)).limit(24);
    const ids = batches.map((batch) => batch.id);
    if (ids.length === 0) return [];
    const samples = await db.select().from(fermentationSamples).where(inArray(fermentationSamples.batchId, ids));
    const alarms = await db.select().from(fermentationAnomalies).where(inArray(fermentationAnomalies.batchId, ids));
    return batches.flatMap((batch) => {
      const setpoints = readSetpoints(batch.setpoints);
      if (!setpoints) return [];
      return [
        {
          id: batch.id,
          name: batch.name,
          reactor: batch.reactor,
          scenario: batch.scenario,
          status: batch.status,
          setpoints,
          samples: samples
            .filter((row) => row.batchId === batch.id)
            .sort((a, b) => a.tMin - b.tMin)
            .map((row) => ({
              tMin: row.tMin,
              ph: row.ph,
              temperature: row.temperature,
              dissolvedOxygen: row.dissolvedOxygen,
              agitation: row.agitation,
              aeration: row.aeration,
              feedRate: row.feedRate,
              biomass: row.biomass,
              substrate: row.substrate,
              co2: row.co2,
              product: row.product,
              ethanol: row.ethanol,
              contaminant: row.contaminant,
              sugarFedKg: row.sugarFedKg,
              energyKwh: row.energyKwh,
              volume: row.volume,
            })),
          alarms: alarms
            .filter((row) => row.batchId === batch.id)
            .map((row) => ({
              id: row.id,
              parameter: row.parameter,
              partId: row.partId,
              severity:
                row.severity === "low" || row.severity === "medium" || row.severity === "high"
                  ? row.severity
                  : "medium",
              tMin: row.tMin,
              evidence: row.evidence,
              reason: row.reason,
              contaminationConfirmed: false as const,
            })),
          startedAt: batch.startedAt?.toISOString() ?? "",
          finishedAt: batch.finishedAt?.toISOString() ?? null,
        },
      ];
    });
  } catch (error) {
    console.warn("Finished runs stayed in the browser. Supabase did not answer.", error);
    return [];
  }
}

function readSetpoints(value: unknown): Setpoints | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<Setpoints>;
  const keys = ["ph", "temperature", "agitation", "aeration", "feedRate", "dissolvedOxygen"] as const;
  if (!keys.every((key) => typeof row[key] === "number")) return null;
  return {
    ph: row.ph ?? 0,
    temperature: row.temperature ?? 0,
    agitation: row.agitation ?? 0,
    aeration: row.aeration ?? 0,
    feedRate: row.feedRate ?? 0,
    dissolvedOxygen: row.dissolvedOxygen ?? 0,
  };
}
