import type { Metadata } from "next";

import { BenchmarkView } from "./_components/benchmark-view";

export const metadata: Metadata = { title: "Benchmark · FermaTwin" };

export default function Page() {
  return <BenchmarkView />;
}
