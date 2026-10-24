import type { Metadata } from "next";

import { ImpactView } from "../_components/fermentation/impact-view";

export const metadata: Metadata = { title: "Impact · FermaTwin" };

export default function Page() {
  return <ImpactView />;
}
