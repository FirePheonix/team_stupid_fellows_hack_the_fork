import type { Metadata } from "next";

import { RunDetailView } from "../../_components/fermentation/run-detail";

export async function generateMetadata({ params }: { params: Promise<{ runId: string }> }): Promise<Metadata> {
  const { runId } = await params;
  return { title: `${runId} · FermaTwin` };
}

export default async function Page({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  return <RunDetailView slug={runId} />;
}
