ALTER TABLE "fermentation_samples" ADD COLUMN "ethanol" real DEFAULT 0 NOT NULL;
ALTER TABLE "fermentation_samples" ADD COLUMN "contaminant" real DEFAULT 0 NOT NULL;
ALTER TABLE "fermentation_samples" ADD COLUMN "sugar_fed_kg" real DEFAULT 0 NOT NULL;
ALTER TABLE "fermentation_samples" ADD COLUMN "energy_kwh" real DEFAULT 0 NOT NULL;
ALTER TABLE "fermentation_anomalies" ADD COLUMN "part_id" varchar(40) DEFAULT '' NOT NULL;
