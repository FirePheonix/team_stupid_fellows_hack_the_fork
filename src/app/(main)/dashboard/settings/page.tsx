import type { Metadata } from "next";

import { SettingsView } from "../_components/fermentation/screens";

export const metadata: Metadata = { title: "Settings · FermaTwin" };

export default function Page() {
  return <SettingsView />;
}
