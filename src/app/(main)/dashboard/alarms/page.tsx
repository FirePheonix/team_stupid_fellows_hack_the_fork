import type { Metadata } from "next";

import { AlarmsView } from "../_components/fermentation/screens";

export const metadata: Metadata = { title: "Alarms · FermaTwin" };

export default function Page() {
  return <AlarmsView />;
}
