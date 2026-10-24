import type { Metadata } from "next";

import { InsightsView } from "../_components/fermentation/screens";

export const metadata: Metadata = { title: "Insights · FermaTwin" };

export default function Page() {
  return <InsightsView />;
}
