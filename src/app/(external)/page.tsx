import type { Metadata } from "next";

import { LandingPage } from "./_components/landing/landing-page";

export const metadata: Metadata = {
  title: "FermaTwin · Fermentation intelligence on every run",
  description:
    "FermaTwin is an interactive 3D fermentation digital twin. Adjust operating parameters on the virtual bioreactor, then use trained models to predict yield, detect anomalies, explain what changed, and compare operating strategies.",
  alternates: {
    canonical: "/",
  },
};

export default function Home() {
  return <LandingPage />;
}
