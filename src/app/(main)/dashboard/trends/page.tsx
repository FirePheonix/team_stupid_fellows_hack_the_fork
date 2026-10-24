import type { Metadata } from "next";

import { TrendsView } from "../_components/fermentation/screens";

export const metadata: Metadata = { title: "Trends · FermaTwin" };

export default function Page() {
  return <TrendsView />;
}
