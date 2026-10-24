import type { Metadata } from "next";

import { SiteChrome } from "../_components/landing/site-chrome";

const SOURCE = "https://github.com/FirePheonix/team_stupid_fellows_hack_the_fork";

export const metadata: Metadata = { title: "Developers · FermaTwin" };

export default function DevelopersPage() {
  return (
    <SiteChrome>
      <p className="mkt-kicker">Developers</p>
      <h1>
        Built for the <span className="mkt-mark">batch</span>.
      </h1>
      <div className="mkt-grid">
        <article id="why" className="mkt-card">
          <h2>Why we built</h2>
          <p>
            Yeast protein on glucose, cane molasses, or pea-starch hydrolysate needs a score before the batch ends.
            FermaTwin keeps that score next to the vessel.
          </p>
        </article>
        <article id="how" className="mkt-card">
          <h2>How we're working</h2>
          <p>
            Model A is a set of exported trees. Model B is one published amino-acid row. A language model only fills the
            request and writes the paragraph from that packet.
          </p>
        </article>
        <article className="mkt-card">
          <h2>The source</h2>
          <p>The lab, the simulator, and the two models live in the open repository.</p>
          <p>
            <a href={SOURCE}>View the source</a>
          </p>
        </article>
      </div>
    </SiteChrome>
  );
}
