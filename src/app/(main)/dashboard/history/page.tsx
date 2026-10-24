import type { Metadata } from "next";

import { HistoryView } from "../_components/fermentation/screens";

export const metadata: Metadata = { title: "Batch history · FermaTwin" };

export default function Page() {
  return <HistoryView />;
}
