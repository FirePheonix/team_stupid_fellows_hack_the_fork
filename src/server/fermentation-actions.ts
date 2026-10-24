"use server";

import { eq } from "drizzle-orm";

import { db } from "@/lib/db/drizzle";
import { fermentationAnomalies, fermentationBatches, fermentationSamples } from "@/lib/db/schema";
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
  if (!process.env.POSTGRES_URL && !process.env.DATABASE_URL) return { stored: false as const };
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
    console.warn("Fermentation batch stayed in the browser. Postgres did not accept it.", error);
    return { stored: false as const };
  }
}
