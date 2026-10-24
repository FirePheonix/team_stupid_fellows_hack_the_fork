"use client";

import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { useFermentation } from "@/stores/fermentation-store";

import { PageHeader } from "../page-header";
import { RunReport, runPath } from "./screens";

export function RunDetailView({ slug }: { slug: string }) {
  const history = useFermentation((state) => state.history);
  const live = useFermentation((state) => state.live);
  const batch = history.find((item) => item.id === slug);
  const open = live.id === slug;

  if (!batch && open) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader
          title={live.name}
          description="This slug is the batch that is still open. Live is that latest run."
          actions={
            <Link href="/dashboard/runs" className="text-sm underline">
              Open live
            </Link>
          }
        />
      </div>
    );
  }

  if (!batch) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader
          title="Run not in this browser"
          description={`${runPath(slug)} is not among the finished batches stored here.`}
          actions={
            <Link href="/dashboard/history" className="text-sm underline">
              All runs
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={batch.name}
        description={runPath(batch.id)}
        actions={
          <>
            {open ? <Badge variant="outline">Latest · still open</Badge> : <Badge variant="secondary">Finished</Badge>}
            <Link href="/dashboard/history" className="text-sm underline">
              All runs
            </Link>
            <Link href="/dashboard/runs" className="text-sm underline">
              Live
            </Link>
          </>
        }
      />
      <RunReport batch={batch} />
    </div>
  );
}
