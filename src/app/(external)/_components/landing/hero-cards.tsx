"use client";

import type { CSSProperties, ReactNode } from "react";
import { useState } from "react";

import Image from "next/image";

import { modelAlarms, rememberAlarms } from "@/lib/fermentation/insights";
import {
  BATCH_MINUTES,
  DEFAULT_SETPOINTS,
  initialState,
  type ProcessState,
  REACTOR_ID,
  runMinutes,
  type Scenario,
} from "@/lib/fermentation/model";

const STAGE = "jsx-60721d3153d0348b";
const PEEK = "jsx-f4deca1016db76e4";
const FEEDSTOCK = "pea-starch-hydrolysate";

const COLUMNS = [
  { id: "protein", long: "Protein g/L", short: "g/L" },
  { id: "ethanol", long: "Ethanol g/L", short: "EtOH" },
  { id: "oxygen", long: "Dissolved oxygen", short: "DO" },
  { id: "alarms", long: "Alarms", short: "Alm" },
  { id: "minutes", long: "Minutes", short: "Min" },
] as const;

type ColumnId = (typeof COLUMNS)[number]["id"];
type RunFilter = "all" | "live" | "finished" | "alarmed";

const FILTERS: { id: RunFilter; label: string }[] = [
  { id: "all", label: "All runs" },
  { id: "live", label: "Live" },
  { id: "finished", label: "Finished" },
  { id: "alarmed", label: "Alarmed" },
];

type LabRun = {
  id: string;
  name: string;
  kind: "live" | "finished";
  alarmCount: number;
  protein: string;
  ethanol: string;
  oxygen: string;
  alarms: string;
  minutes: string;
  signal: string;
};

const SCENARIO_RUNS: { id: Scenario; name: string }[] = [
  { id: "stable", name: "Demo · stable" },
  { id: "oxygen-limitation", name: "Demo · oxygen limit" },
  { id: "ph-drift", name: "Demo · pH drift" },
  { id: "contamination", name: "Demo · fault pattern" },
];

function signalOf(parameter: string) {
  if (parameter === "dissolvedOxygen") return "DO";
  if (parameter === "ph") return "pH";
  if (parameter === "process") return "mix";
  return "—";
}

function countAlarms(samples: ProcessState[]) {
  let alarms: ReturnType<typeof modelAlarms> = [];
  for (let i = 1; i <= samples.length; i++) alarms = rememberAlarms(alarms, modelAlarms(samples.slice(0, i), 50));
  return alarms;
}

function buildRuns(): LabRun[] {
  const live = initialState(DEFAULT_SETPOINTS, FEEDSTOCK);
  const open: LabRun = {
    id: "live",
    name: `Live · ${REACTOR_ID}`,
    kind: "live",
    alarmCount: 0,
    protein: live.product.toFixed(2),
    ethanol: live.ethanol.toFixed(2),
    oxygen: `${live.dissolvedOxygen.toFixed(1)}%`,
    alarms: "0",
    minutes: String(live.tMin),
    signal: "—",
  };
  const finished = SCENARIO_RUNS.map((item) => {
    const samples = runMinutes(item.id, DEFAULT_SETPOINTS, BATCH_MINUTES, 10, FEEDSTOCK);
    const end = samples.at(-1) ?? live;
    const alarms = countAlarms(samples);
    return {
      id: item.id,
      name: item.name,
      kind: "finished" as const,
      alarmCount: alarms.length,
      protein: end.product.toFixed(2),
      ethanol: end.ethanol.toFixed(2),
      oxygen: `${end.dissolvedOxygen.toFixed(1)}%`,
      alarms: String(alarms.length),
      minutes: String(end.tMin),
      signal: signalOf(alarms.at(-1)?.parameter ?? ""),
    };
  });
  return [open, ...finished];
}

const RUNS = buildRuns();

function passes(run: LabRun, filter: RunFilter, alarmsOn: boolean) {
  if (!alarmsOn && run.alarmCount > 0) return false;
  if (filter === "live") return run.kind === "live";
  if (filter === "finished") return run.kind === "finished";
  if (filter === "alarmed") return run.alarmCount > 0;
  return true;
}

function badge(run: LabRun) {
  if (run.kind === "live") return { label: "Open", tone: "is-green" };
  if (run.alarmCount > 0) return { label: "Alarmed", tone: "is-amber" };
  return { label: "Finished", tone: "is-green" };
}

function cell(run: LabRun, id: ColumnId) {
  if (id === "protein") return run.protein;
  if (id === "ethanol") return run.ethanol;
  if (id === "oxygen") return run.oxygen;
  if (id === "alarms") return run.alarms;
  return run.minutes;
}

function Mark({ stage }: { stage?: boolean }) {
  const cls = stage ? `${STAGE} card-mark` : `${PEEK} card-mark`;
  return <Image src="/logo/icon.png" alt="" width={18} height={18} className={cls} />;
}

function SlotFrame({
  front,
  slot,
  label,
  onOpen,
  children,
}: {
  front: boolean;
  slot: number;
  label: string;
  onOpen: () => void;
  children: ReactNode;
}) {
  const className = front ? `${STAGE} card-slot slot-${slot} is-front` : `${STAGE} card-slot slot-${slot}`;
  return (
    <div className={className}>
      {children}
      {front ? null : (
        <button
          type="button"
          aria-label={label}
          className="absolute inset-0 z-10 cursor-pointer bg-transparent"
          onClick={onOpen}
        />
      )}
    </div>
  );
}

function Tick() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.8"
      aria-hidden="true"
    >
      <path d="m5 12 4.5 4.5L19 7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function rotate(slots: number[], index: number) {
  const current = slots[index] ?? 0;
  if (current <= 0) return slots;
  const offset = (slots.length - current) % slots.length;
  return slots.map((slot) => (slot + offset) % slots.length);
}

export function HeroCards() {
  const [slots, setSlots] = useState([2, 1, 3, 0]);
  const [filters, setFilters] = useState<RunFilter[]>(["all", "all", "all", "all"]);
  const [alarmsOn, setAlarmsOn] = useState([true, true, true, true]);
  const [columns, setColumns] = useState<ColumnId[]>(COLUMNS.map((column) => column.id));

  function shown(index: number) {
    const filter = filters[index] ?? "all";
    const includeAlarms = alarmsOn[index] ?? true;
    return RUNS.filter((run) => passes(run, filter, includeAlarms));
  }

  function setFilter(index: number, filter: RunFilter) {
    if ((slots[index] ?? 0) !== 0) return;
    setFilters((current) => current.map((item, i) => (i === index ? filter : item)));
  }

  function toggleAlarms(index: number) {
    if ((slots[index] ?? 0) !== 0) return;
    setAlarmsOn((current) => current.map((item, i) => (i === index ? !item : item)));
  }

  function toggleColumn(id: ColumnId) {
    if ((slots[3] ?? 0) !== 0) return;
    setColumns((current) => {
      const on = current.includes(id);
      if (on && current.length <= 1) return current;
      const next = on ? current.filter((item) => item !== id) : [...current, id];
      return COLUMNS.map((column) => column.id).filter((item) => next.includes(item));
    });
  }

  function onSlotClick(index: number) {
    if ((slots[index] ?? 0) === 0) return;
    setSlots((current) => rotate(current, index));
  }

  return (
    <div className={`${STAGE} collage`}>
      <div className={`${STAGE} collage-stage`}>
        <div className={`${STAGE} collage-stack`} data-hero-cards="1">
          <PeekCard
            slot={slots[0] ?? 2}
            title="Operating Strategy Optimization"
            variant="peek-pam"
            filter={filters[0] ?? "all"}
            alarmsOn={alarmsOn[0] ?? true}
            rows={shown(0)}
            onOpen={() => onSlotClick(0)}
            onFilter={(filter) => setFilter(0, filter)}
            onToggle={() => toggleAlarms(0)}
            mode="strategy"
          />
          <PeekCard
            slot={slots[1] ?? 1}
            title="Early Yield Prediction"
            variant="peek-certs"
            filter={filters[1] ?? "all"}
            alarmsOn={alarmsOn[1] ?? true}
            rows={shown(1)}
            onOpen={() => onSlotClick(1)}
            onFilter={(filter) => setFilter(1, filter)}
            onToggle={() => toggleAlarms(1)}
            mode="yield"
          />
          <PeekCard
            slot={slots[2] ?? 3}
            title="Explainable Process Intelligence"
            variant="peek-agent"
            filter={filters[2] ?? "all"}
            alarmsOn={alarmsOn[2] ?? true}
            rows={shown(2)}
            onOpen={() => onSlotClick(2)}
            onFilter={(filter) => setFilter(2, filter)}
            onToggle={() => toggleAlarms(2)}
            mode="explain"
          />
          <LabCard
            slot={slots[3] ?? 0}
            filter={filters[3] ?? "all"}
            alarmsOn={alarmsOn[3] ?? true}
            rows={shown(3)}
            columns={columns}
            onOpen={() => onSlotClick(3)}
            onFilter={(filter) => setFilter(3, filter)}
            onToggle={() => toggleAlarms(3)}
            onColumn={toggleColumn}
          />
        </div>
      </div>
    </div>
  );
}

function Tabs({
  label,
  filter,
  stage,
  onFilter,
}: {
  label: string;
  filter: RunFilter;
  stage?: boolean;
  onFilter: (filter: RunFilter) => void;
}) {
  const tab = stage ? `${STAGE} stage-tab` : `${PEEK} peek-tab`;
  const list = stage ? `${STAGE} stage-tablist` : `${PEEK} peek-tablist`;
  return (
    <div role="tablist" aria-label={`${label} runs`} className={list}>
      {FILTERS.map((item) => {
        const on = item.id === filter;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={on}
            className={on ? `${tab} is-active` : tab}
            onClick={() => onFilter(item.id)}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

function AlarmSwitch({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      className={on ? `${PEEK} peek-toggle is-on` : `${PEEK} peek-toggle`}
      onClick={onToggle}
    >
      <span aria-hidden="true" className={`${PEEK} sync-track`}>
        <span className={`${PEEK} sync-knob`} />
      </span>
      <span className={`${PEEK} peek-toggle-copy`}>{on ? "Alarms included" : "Quiet runs"}</span>
    </button>
  );
}

function PeekCard({
  slot,
  title,
  variant,
  filter,
  alarmsOn,
  rows,
  onOpen,
  onFilter,
  onToggle,
  mode,
}: {
  slot: number;
  title: string;
  variant: string;
  filter: RunFilter;
  alarmsOn: boolean;
  rows: LabRun[];
  onOpen: () => void;
  onFilter: (filter: RunFilter) => void;
  onToggle: () => void;
  mode: "strategy" | "yield" | "explain";
}) {
  const front = slot === 0;
  return (
    <SlotFrame front={front} slot={slot} label={`Show ${title}`} onOpen={onOpen}>
      <div aria-hidden={front ? undefined : true} className={`${PEEK} peek-card ${variant}`}>
        <div className={`${PEEK} peek-tabs`}>
          <span className={`${PEEK} card-label`}>
            <Mark />
            {title}
          </span>
          <Tabs label={title} filter={filter} onFilter={onFilter} />
          <AlarmSwitch on={alarmsOn} onToggle={onToggle} />
        </div>
        <div className={`${PEEK} peek-rows`}>
          <PeekHead mode={mode} />
          {rows.length === 0 ? (
            <div className={`${PEEK} peek-row`}>
              <span className={`${PEEK} peek-row-name`}>No runs in this filter.</span>
            </div>
          ) : (
            rows.map((run) => <PeekRow key={run.id} run={run} mode={mode} />)
          )}
        </div>
      </div>
    </SlotFrame>
  );
}

function PeekHead({ mode }: { mode: "strategy" | "yield" | "explain" }) {
  if (mode === "strategy") {
    return (
      <div className={`${PEEK} peek-row peek-head`}>
        <span className={`${PEEK} peek-row-clock`}>Min</span>
        <span className={`${PEEK} peek-row-name`}>Run</span>
        <span className={`${PEEK} peek-row-meta`}>Status</span>
      </div>
    );
  }
  if (mode === "yield") {
    return (
      <div className={`${PEEK} peek-row peek-head`}>
        <span className={`${PEEK} peek-row-name`}>Run</span>
        <span className={`${PEEK} peek-row-status`}>Status</span>
        <span className={`${PEEK} peek-row-meta`}>Protein</span>
      </div>
    );
  }
  return (
    <div className={`${PEEK} peek-row peek-head`}>
      <span className={`${PEEK} peek-row-name`}>Run</span>
      <span className={`${PEEK} peek-row-bundle`}>Signal</span>
      <span className={`${PEEK} peek-row-meta`}>Min</span>
      <span className={`${PEEK} peek-row-status`}>Status</span>
    </div>
  );
}

function PeekRow({ run, mode }: { run: LabRun; mode: "strategy" | "yield" | "explain" }) {
  const mark = badge(run);
  const pill = (
    <span className={`${PEEK} peek-badge ${mark.tone}`} title="Contamination is not confirmed.">
      {mark.label}
    </span>
  );
  if (mode === "strategy") {
    return (
      <div className={`${PEEK} peek-row`}>
        <span className={`${PEEK} peek-row-clock`}>{run.minutes}</span>
        <span className={`${PEEK} peek-row-name`}>{run.name}</span>
        <span className={`${PEEK} peek-badge ${mark.tone}`} title="Contamination is not confirmed.">
          {mark.label}
        </span>
      </div>
    );
  }
  if (mode === "yield") {
    return (
      <div className={`${PEEK} peek-row`}>
        <span className={`${PEEK} peek-row-name`}>{run.name}</span>
        <span className={`${PEEK} peek-row-status`}>{pill}</span>
        <span className={`${PEEK} peek-row-meta`}>{run.protein}</span>
      </div>
    );
  }
  return (
    <div className={`${PEEK} peek-row`}>
      <span className={`${PEEK} peek-row-name`}>{run.name}</span>
      <span className={`${PEEK} peek-row-bundle`}>
        <span className={`${PEEK} peek-bundle`}>{run.signal}</span>
      </span>
      <span className={`${PEEK} peek-row-meta`}>{run.minutes}</span>
      <span className={`${PEEK} peek-row-status`}>{pill}</span>
    </div>
  );
}

function LabCard({
  slot,
  filter,
  alarmsOn,
  rows,
  columns,
  onOpen,
  onFilter,
  onToggle,
  onColumn,
}: {
  slot: number;
  filter: RunFilter;
  alarmsOn: boolean;
  rows: LabRun[];
  columns: ColumnId[];
  onOpen: () => void;
  onFilter: (filter: RunFilter) => void;
  onToggle: () => void;
  onColumn: (id: ColumnId) => void;
}) {
  const front = slot === 0;
  return (
    <SlotFrame front={front} slot={slot} label="Show 3D Bioreactor Lab" onOpen={onOpen}>
      <div className={`${STAGE} collage-card collage-window`}>
        <div className={`${STAGE} stage-app`}>
          <div className={`${STAGE} stage-tabs`}>
            <span className={`${STAGE} card-label`}>
              <Mark stage />
              3D Bioreactor Lab
            </span>
            <Tabs label="3D Bioreactor Lab" filter={filter} stage onFilter={onFilter} />
            <AlarmSwitch on={alarmsOn} onToggle={onToggle} />
          </div>
          <div className={`${STAGE} stage-table-wrap`}>
            <div className={`${STAGE} stage-table`} style={{ "--envcount": String(columns.length) } as CSSProperties}>
              <div className={`${STAGE} stage-row stage-head`}>
                <span className={`${STAGE} stage-cell-name`}>Run</span>
                {COLUMNS.filter((column) => columns.includes(column.id)).map((column) => (
                  <span key={column.id} className={`${STAGE} stage-cell-env`}>
                    <span className={`${STAGE} env-long`}>{column.long}</span>
                    <span className={`${STAGE} env-short`}>{column.short}</span>
                  </span>
                ))}
              </div>
              {rows.length === 0 ? (
                <div className={`${STAGE} stage-row stage-tr`}>
                  <span className={`${STAGE} stage-cell-name`}>No runs in this filter.</span>
                </div>
              ) : (
                rows.map((run) => (
                  <div key={run.id} className={`${STAGE} stage-row stage-tr`}>
                    <span className={`${STAGE} stage-cell-name`}>
                      <span className={`${STAGE} stage-row-name`}>{run.name}</span>
                    </span>
                    {COLUMNS.filter((column) => columns.includes(column.id)).map((column) => (
                      <span key={column.id} className={`${STAGE} stage-cell-env`}>
                        {cell(run, column.id)}
                      </span>
                    ))}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
      <div className={`${STAGE} collage-overlay collage-overlay-env`}>
        <div className={`${STAGE} env-card`}>
          <div className={`${STAGE} env-list`}>
            {COLUMNS.map((column) => {
              const on = columns.includes(column.id);
              return (
                <button
                  key={column.id}
                  type="button"
                  aria-pressed={on}
                  className={on ? `${STAGE} env-opt is-on` : `${STAGE} env-opt`}
                  onClick={() => onColumn(column.id)}
                >
                  <span className={`${STAGE} env-box`}>{on ? <Tick /> : null}</span>
                  {column.long}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </SlotFrame>
  );
}
