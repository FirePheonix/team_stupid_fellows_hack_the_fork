CREATE TABLE "fermentation_batches" (
  "id" text PRIMARY KEY NOT NULL,
  "name" varchar(120) NOT NULL,
  "reactor" varchar(40) DEFAULT 'BR-101' NOT NULL,
  "scenario" varchar(40) NOT NULL,
  "status" varchar(20) NOT NULL,
  "setpoints" jsonb NOT NULL,
  "started_at" timestamp with time zone,
  "finished_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "fermentation_samples" (
  "id" serial PRIMARY KEY NOT NULL,
  "batch_id" text NOT NULL,
  "t_min" integer NOT NULL,
  "ph" real NOT NULL,
  "temperature" real NOT NULL,
  "dissolved_oxygen" real NOT NULL,
  "agitation" real NOT NULL,
  "aeration" real NOT NULL,
  "feed_rate" real NOT NULL,
  "biomass" real NOT NULL,
  "substrate" real NOT NULL,
  "co2" real NOT NULL,
  "product" real NOT NULL,
  "volume" real NOT NULL
);

CREATE TABLE "fermentation_anomalies" (
  "id" text PRIMARY KEY NOT NULL,
  "batch_id" text NOT NULL,
  "parameter" varchar(40) NOT NULL,
  "severity" varchar(20) NOT NULL,
  "t_min" integer NOT NULL,
  "evidence" text NOT NULL,
  "reason" text NOT NULL,
  "contamination_confirmed" boolean DEFAULT false NOT NULL
);

ALTER TABLE "fermentation_samples" ADD CONSTRAINT "fermentation_samples_batch_id_fermentation_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."fermentation_batches"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "fermentation_anomalies" ADD CONSTRAINT "fermentation_anomalies_batch_id_fermentation_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."fermentation_batches"("id") ON DELETE cascade ON UPDATE no action;
CREATE INDEX "fermentation_samples_batch_idx" ON "fermentation_samples" USING btree ("batch_id","t_min");
