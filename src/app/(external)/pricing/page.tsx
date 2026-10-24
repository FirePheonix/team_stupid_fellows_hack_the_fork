import type { Metadata } from "next";

import { SiteChrome } from "../_components/landing/site-chrome";

export const metadata: Metadata = { title: "Pricing · FermaTwin" };

const tiers = [
  ["Lab", "Open", "The simulated BR-101 batch, Model A, and Model B. No account."],
  ["History", "This browser", "Finished runs stay on this computer until a database is connected."],
  ["Billing", "Off", "Razorpay is in the repo and is not offered."],
];

export default function PricingPage() {
  return (
    <SiteChrome>
      <p className="mkt-kicker">Pricing</p>
      <h1>
        The lab is <span className="mkt-mark">open</span>.
      </h1>
      <p className="mkt-lede">
        FermaTwin scores a yeast-protein batch while it is still running. Checkout is not live.
      </p>
      <div className="mkt-grid">
        {tiers.map(([name, price, copy]) => (
          <article key={name} className="mkt-card">
            <p className="mkt-kicker">{name}</p>
            <h2 style={{ marginTop: 12 }}>{price}</h2>
            <p>{copy}</p>
          </article>
        ))}
      </div>
    </SiteChrome>
  );
}
