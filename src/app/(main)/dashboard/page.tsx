import type { Metadata } from "next";

import { OverviewView } from "./_components/fermentation/screens";

export const metadata: Metadata = { title: "Overview · FermaTwin" };

export default function Page() {
  return <OverviewView />;
}
