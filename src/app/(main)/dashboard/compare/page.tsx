import type { Metadata } from "next";

import { CompareView } from "../_components/fermentation/screens";

export const metadata: Metadata = { title: "Compare batches · FermaTwin" };

export default function Page() {
  return <CompareView />;
}
