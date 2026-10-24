"use client";

import { type ReactNode, useState } from "react";

import { Beef, CloudOff, type LucideIcon, Recycle, Sprout, Timer, Users, Wheat } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, LabelList, XAxis, YAxis } from "recharts";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  FOOTPRINT_SOURCE,
  GRID_SOURCE,
  impactOf,
  PLANT,
  PLANT_FACTOR,
  PROTEIN_FOOTPRINTS,
  RDA_SOURCE,
} from "@/lib/fermentation/impact";
import reportJson from "@/lib/fermentation/model-a-report.json";
import { AMINO_SOURCE } from "@/lib/fermentation/protein";

import { PageHeader } from "../page-header";
import { KpiTile } from "./rings";
import { useRunSnapshot } from "./snapshot";

type Scale = "batch" | "plant";

const chartConfig = {
  value: { label: "Per 100 g protein", color: "var(--chart-2)" },
} satisfies ChartConfig;

const YEAST_ROW = "Yeast (this run)";

/** UN SDG colours, nearest Tailwind palette shades. */
const SDG_STYLE = {
  2: { tile: "bg-amber-500", edge: "border-t-amber-500" },
  7: { tile: "bg-yellow-400", edge: "border-t-yellow-400" },
  9: { tile: "bg-orange-500", edge: "border-t-orange-500" },
  12: { tile: "bg-amber-700", edge: "border-t-amber-700" },
  13: { tile: "bg-green-700", edge: "border-t-green-700" },
  15: { tile: "bg-lime-500", edge: "border-t-lime-500" },
} as const;

const BAR_FILL = { yeast: "var(--color-green-600)", plant: "var(--color-lime-500)", animal: "var(--muted-foreground)" };

export function ImpactView() {
  const snap = useRunSnapshot();
  const [scale, setScale] = useState<Scale>("batch");
  const [metric, setMetric] = useState<"co2" | "land">("co2");
  const factor = scale === "plant" ? PLANT_FACTOR : 1;
  const { setpoints } = snap.live;
  const impact = impactOf(snap.run, snap.pattern, snap.feedstock, setpoints, factor);
  const late = reportJson.yield.find((row) => row.group === "held-out normal" && row.frac === 0.8);
  const per = scale === "plant" ? "a year" : "this batch";

  const rows = [
    ...PROTEIN_FOOTPRINTS.map((row) => ({ food: row.food, kind: row.kind, value: row[metric] })),
    { food: YEAST_ROW, kind: "yeast" as const, value: metric === "co2" ? impact.co2Per100g : impact.landPer100g },
  ].sort((a, b) => b.value - a.value);
  const beefTimes = Math.round(49.89 / Math.max(impact.co2Per100g, 0.01));

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Impact"
        description="How much animal protein this run can replace, and what that saves in climate, land, and waste. Mapped to the UN Sustainable Development Goals."
        actions={
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={scale}
            onValueChange={(value) => value && setScale(value as Scale)}
          >
            <ToggleGroupItem value="batch">This batch</ToggleGroupItem>
            <ToggleGroupItem value="plant">Plant, per year</ToggleGroupItem>
          </ToggleGroup>
        }
      />
      {scale === "plant" ? (
        <p className="text-muted-foreground text-sm">
          Illustrative scale-up: one {PLANT.vesselM3} m³ vessel, one batch a day, {PLANT.batchesPerYear} days a year,
          yield scaled linearly from this 1 m³ run.
        </p>
      ) : null}

      <Card className="border-green-600/40 bg-green-600/5">
        <CardContent className="grid gap-6 md:grid-cols-[1.1fr_1fr] md:items-center">
          <div className="flex flex-col gap-2">
            <Badge variant="secondary" className="w-fit gap-1">
              <Beef className="size-3.5" /> Animal-free protein
            </Badge>
            <div className="font-semibold text-4xl tabular-nums tracking-tight md:text-5xl">
              {weight(impact.beefReplacedKg)} of beef
            </div>
            <p className="text-muted-foreground">
              replaced by the protein from {per}, with no animal raised. The same protein as{" "}
              {weight(impact.chickenReplacedKg)} of chicken, at {beefTimes}× less CO₂e than beef.
            </p>
          </div>
          <ul className="flex flex-col gap-3 text-sm">
            <Point icon={Wheat} title="Works with plant protein">
              Yeast is rich in lysine ({impact.lysinePct.toFixed(0)}% of the WHO need), the amino acid wheat and rice
              are short of, so it lifts plant-based diets and products instead of competing with them.
            </Point>
            <Point icon={Recycle} title="Runs on plant-protein leftovers">
              Pea starch, left over when pea protein is made, is one of our sugar feeds. Plant-protein plants get a
              second protein out of the same crop.
            </Point>
            <Point icon={Timer} title="Hours, not years">
              A batch takes 10 hours in a tank, all year round. A beef animal takes 18 months or more.
            </Point>
          </ul>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiTile
          icon={CloudOff}
          label="CO₂e avoided vs beef"
          value={tonnes(impact.avoidedCo2VsBeefKg)}
          note={`for the same protein, ${per}. Against chicken: ${tonnes(impact.avoidedCo2VsPoultryKg)}.`}
        />
        <KpiTile
          icon={Sprout}
          label="Land spared vs beef"
          value={area(impact.sparedLandVsBeefM2)}
          note={`of farmland for the same protein, ${per}.`}
        />
        <KpiTile
          icon={Users}
          label="Daily protein need met"
          value={scale === "plant" ? `${people(impact.personDays / 365)} people` : `${people(impact.personDays)} days`}
          note={
            scale === "plant"
              ? `fed their full protein need all year from ${tonnes(impact.proteinKg)} protein.`
              : `of one adult's protein from ${impact.proteinKg.toFixed(1)} kg, at 54 g a day.`
          }
        />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <SdgCard
          goal={2}
          name="Zero hunger"
          targets={["2.1", "2.4"]}
          value={impact.completeProtein ? "Complete protein" : `${impact.lowestAmino.pct.toFixed(0)}% coverage`}
          text={`Like meat, it carries every essential amino acid at or above the WHO adult pattern; the lowest, ${impact.lowestAmino.label}, sits at ${impact.lowestAmino.pct.toFixed(0)}%.`}
        />
        <SdgCard
          goal={13}
          name="Climate action"
          targets={[]}
          value={`${impact.co2Per100g.toFixed(1)} kg CO₂e / 100 g`}
          text={`Beef 49.9, chicken 5.7, eggs 4.2, tofu 2.0. Sugar ${pct(impact.co2Sugar, impact.co2Sugar + impact.co2Power)} and electricity ${pct(impact.co2Power, impact.co2Sugar + impact.co2Power)} of ours; every feed is charged as cane sugar, so this is a high estimate.`}
        />
        <SdgCard
          goal={15}
          name="Life on land"
          targets={[]}
          value={`${impact.landPer100g.toFixed(2)} m² / 100 g`}
          text="The only land is the sugar crop. Beef herds need 164 m² for the same 100 g of protein: land that could go back to forest."
        />
        <SdgCard
          goal={12}
          name="Responsible production"
          targets={["12.3", "12.5"]}
          value={`${kg(impact.oxygenFault.lostKg)} protected`}
          text={`An unnoticed oxygen shortfall costs ${impact.oxygenFault.lostPct.toFixed(0)}% of the protein ${per === "a year" ? "per faulty batch" : "here"}. The detector caught ${impact.oxygenFault.detectionPct}% of held-out oxygen faults, median ${impact.oxygenFault.delayMin} min after onset.`}
          badge={impact.sideStream.sideStream ? "Side-stream sugar" : undefined}
        />
        <SdgCard
          goal={7}
          name="Affordable and clean energy"
          targets={["7.3"]}
          value={`${impact.kwhPerKgProtein.toFixed(1)} kWh / kg`}
          text="Calculated agitator and air-compressor power per kg protein. Live shows each candidate's power change before it is applied."
        />
        <SdgCard
          goal={9}
          name="Industry and innovation"
          targets={["9.4", "9.5"]}
          value={late ? `${late.model_mape.toFixed(1)}% yield error` : "Digital twin"}
          text="A digital twin with trained models forecasts protein and flags faults while the batch runs, so operators fix a run instead of discarding it."
        />
      </div>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
          <div className="flex flex-col gap-1.5">
            <CardTitle>Animal protein vs animal-free protein</CardTitle>
            <CardDescription>
              {metric === "co2" ? "kg CO₂e" : "m² of land"} per 100 g protein. Grey: animal. Light green: plant. Green:
              our yeast, this run.
            </CardDescription>
          </div>
          <Tabs value={metric} onValueChange={(value) => setMetric(value as "co2" | "land")}>
            <TabsList>
              <TabsTrigger value="co2">Climate</TabsTrigger>
              <TabsTrigger value="land">Land</TabsTrigger>
            </TabsList>
          </Tabs>
        </CardHeader>
        <CardContent>
          <ChartContainer config={chartConfig} className="aspect-auto h-[360px] w-full">
            <BarChart data={rows} layout="vertical" margin={{ left: 8, right: 48 }}>
              <CartesianGrid horizontal={false} />
              <YAxis dataKey="food" type="category" width={150} tickLine={false} axisLine={false} />
              <XAxis type="number" hide />
              <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
              <Bar dataKey="value" radius={4}>
                {rows.map((row) => (
                  <Cell key={row.food} fill={BAR_FILL[row.kind]} fillOpacity={row.kind === "animal" ? 0.45 : 1} />
                ))}
                <LabelList
                  dataKey="value"
                  position="right"
                  className="fill-foreground"
                  fontSize={12}
                  formatter={(value) => (typeof value === "number" ? value.toFixed(value < 10 ? 2 : 1) : value)}
                />
              </Bar>
            </BarChart>
          </ChartContainer>
        </CardContent>
      </Card>

      <ul className="flex flex-col gap-1 text-muted-foreground text-xs">
        <li>
          {FOOTPRINT_SOURCE} Meat replaced uses the protein content implied by the same dataset (beef 20%, chicken 17%).
        </li>
        <li>Electricity: {GRID_SOURCE} 0.716 kg CO₂ per kWh.</li>
        <li>{RDA_SOURCE}</li>
        <li>Amino acids: {AMINO_SOURCE}</li>
        <li>Fault detection and yield error: held-out batches in FermaTwin's Model A report.</li>
      </ul>
    </div>
  );
}

function Point({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-background text-green-600">
        <Icon className="size-4" />
      </div>
      <div className="flex flex-col gap-0.5">
        <span className="font-medium">{title}</span>
        <span className="text-muted-foreground">{children}</span>
      </div>
    </li>
  );
}

function SdgCard({
  goal,
  name,
  targets,
  value,
  text,
  badge,
}: {
  goal: keyof typeof SDG_STYLE;
  name: string;
  targets: string[];
  value: string;
  text: string;
  badge?: string;
}) {
  return (
    <Card className={`overflow-hidden border-t-4 ${SDG_STYLE[goal].edge}`}>
      <CardHeader className="flex flex-row items-center gap-3">
        <div
          className={`flex size-11 shrink-0 items-center justify-center rounded-md font-semibold text-lg text-white ${SDG_STYLE[goal].tile}`}
        >
          {goal}
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <CardTitle className="text-sm">
            SDG {goal} · {name}
          </CardTitle>
          <div className="flex flex-wrap gap-1">
            {targets.map((target) => (
              <Badge key={target} variant="outline" className="text-[10px]">
                Target {target}
              </Badge>
            ))}
            {badge ? (
              <Badge variant="secondary" className="text-[10px]">
                {badge}
              </Badge>
            ) : null}
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <div className="font-medium text-2xl tabular-nums tracking-tight">{value}</div>
        <p className="text-muted-foreground text-sm">{text}</p>
      </CardContent>
    </Card>
  );
}

function people(value: number) {
  return Math.round(value).toLocaleString("en-US");
}

function weight(valueKg: number) {
  return valueKg >= 1000 ? tonnes(valueKg) : `${Math.round(valueKg)} kg`;
}

function kg(value: number) {
  return value >= 1000 ? tonnes(value) : `${value.toFixed(1)} kg`;
}

function tonnes(valueKg: number) {
  if (valueKg < 1000) return `${Math.round(valueKg).toLocaleString("en-US")} kg`;
  const t = valueKg / 1000;
  return `${t >= 100 ? Math.round(t).toLocaleString("en-US") : t.toFixed(1)} t`;
}

function area(m2: number) {
  if (m2 < 10_000) return `${Math.round(m2).toLocaleString("en-US")} m²`;
  const ha = m2 / 10_000;
  return `${ha >= 100 ? Math.round(ha).toLocaleString("en-US") : ha.toFixed(1)} ha`;
}

function pct(part: number, whole: number) {
  return `${Math.round((part / Math.max(whole, 1e-9)) * 100)}%`;
}
