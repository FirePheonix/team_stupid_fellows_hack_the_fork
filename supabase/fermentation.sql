-- FermaTwin batch store. Paste into Supabase → SQL Editor → Run.
-- Creates the three tables the app writes. Safe to run again.
-- The app connects with the database URI (the postgres role), which bypasses row level security.
-- The public anon key cannot read these tables.

create table if not exists public.fermentation_batches (
  id text primary key,
  name varchar(120) not null,
  reactor varchar(40) default 'BR-101' not null,
  scenario varchar(40) not null,
  status varchar(20) not null,
  setpoints jsonb not null,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz default now() not null
);

create table if not exists public.fermentation_samples (
  id serial primary key,
  batch_id text not null,
  t_min integer not null,
  ph real not null,
  temperature real not null,
  dissolved_oxygen real not null,
  agitation real not null,
  aeration real not null,
  feed_rate real not null,
  biomass real not null,
  substrate real not null,
  co2 real not null,
  product real not null,
  ethanol real default 0 not null,
  contaminant real default 0 not null,
  sugar_fed_kg real default 0 not null,
  energy_kwh real default 0 not null,
  volume real not null
);

alter table public.fermentation_samples add column if not exists ethanol real default 0 not null;
alter table public.fermentation_samples add column if not exists contaminant real default 0 not null;
alter table public.fermentation_samples add column if not exists sugar_fed_kg real default 0 not null;
alter table public.fermentation_samples add column if not exists energy_kwh real default 0 not null;

create table if not exists public.fermentation_anomalies (
  id text primary key,
  batch_id text not null,
  parameter varchar(40) not null,
  part_id varchar(40) default '' not null,
  severity varchar(20) not null,
  t_min integer not null,
  evidence text not null,
  reason text not null,
  contamination_confirmed boolean default false not null
);

alter table public.fermentation_anomalies add column if not exists part_id varchar(40) default '' not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'fermentation_samples_batch_id_fk'
  ) then
    alter table public.fermentation_samples
      add constraint fermentation_samples_batch_id_fk
      foreign key (batch_id) references public.fermentation_batches (id) on delete cascade;
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'fermentation_anomalies_batch_id_fk'
  ) then
    alter table public.fermentation_anomalies
      add constraint fermentation_anomalies_batch_id_fk
      foreign key (batch_id) references public.fermentation_batches (id) on delete cascade;
  end if;
end $$;

create index if not exists fermentation_samples_batch_idx
  on public.fermentation_samples (batch_id, t_min);

alter table public.fermentation_batches enable row level security;
alter table public.fermentation_samples enable row level security;
alter table public.fermentation_anomalies enable row level security;
