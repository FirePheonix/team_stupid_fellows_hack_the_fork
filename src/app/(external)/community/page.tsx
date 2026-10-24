import type { Metadata } from "next";

import { SiteChrome } from "../_components/landing/site-chrome";

const SOURCE = "https://github.com/FirePheonix/team_stupid_fellows_hack_the_fork";

export const metadata: Metadata = { title: "Community · FermaTwin" };

export default function CommunityPage() {
  return (
    <SiteChrome>
      <p className="mkt-kicker">Contribute</p>
      <h1>
        The lab is <span className="mkt-mark">open</span>.
      </h1>
      <p className="mkt-lede">
        FermaTwin is open source. Questions about a run, a feedstock, or a model belong in the repository.
      </p>
      <div className="mkt-grid">
        <article className="mkt-card">
          <h2>The repository</h2>
          <p>Read the simulator, Model A, and Model B.</p>
          <p>
            <a href={SOURCE}>github.com/FirePheonix/team_stupid_fellows_hack_the_fork</a>
          </p>
        </article>
        <article className="mkt-card">
          <h2>Suggest a fix</h2>
          <p>Open an issue when a score, a price, or a fault note does not match the packet.</p>
        </article>
        <article className="mkt-card">
          <h2>Bring a feedstock</h2>
          <p>A new sugar needs a published amino-acid row. The lab does not invent one.</p>
        </article>
      </div>
    </SiteChrome>
  );
}
