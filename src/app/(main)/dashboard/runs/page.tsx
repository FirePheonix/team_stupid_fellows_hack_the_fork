import type { Metadata } from "next";

import { RunsView } from "../_components/fermentation/screens";

export const metadata: Metadata = { title: "Live batch · FermaTwin" };

export default function Page() {
  return <RunsView />;
}
