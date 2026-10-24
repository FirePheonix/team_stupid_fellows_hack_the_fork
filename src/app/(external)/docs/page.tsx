import type { Metadata } from "next";

import { SiteChrome } from "../_components/landing/site-chrome";

export const metadata: Metadata = { title: "Docs · FermaTwin" };

const docs = [
  ["Open the lab", "The live batch is the run still open. Finished runs each have their own page."],
  [
    "Ask",
    "Plain language can set the sugar, the air, and the carbon-to-nitrogen ratio. The score and the rupee price come from the models.",
  ],
  [
    "A fault flag",
    "It is a process warning. It does not confirm contamination. Power in the price is calculated, not metered.",
  ],
];

export default function DocsPage() {
  return (
    <SiteChrome>
      <p className="mkt-kicker">Docs</p>
      <h1>
        Start with the <span className="mkt-mark">batch</span>.
      </h1>
      <div className="mkt-grid">
        {docs.map(([title, copy]) => (
          <article key={title} className="mkt-card">
            <h2>{title}</h2>
            <p>{copy}</p>
          </article>
        ))}
      </div>
    </SiteChrome>
  );
}
