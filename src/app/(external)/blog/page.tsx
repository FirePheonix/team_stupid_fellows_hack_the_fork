import type { Metadata } from "next";

import { SiteChrome } from "../_components/landing/site-chrome";

export const metadata: Metadata = { title: "Blog · FermaTwin" };

const posts = [
  [
    "The protein score",
    "A 0–1 score from protein per kilogram of sugar, the rupee price, and the limiting amino acid.",
  ],
  [
    "One amino-acid row",
    "Glucose, cane molasses, and pea-starch hydrolysate share the published S. cerevisiae row on file.",
  ],
  [
    "A fault is not contamination",
    "The detector can flag a run. It cannot confirm an infection. Power in the price is calculated, not metered.",
  ],
];

export default function BlogPage() {
  return (
    <SiteChrome>
      <p className="mkt-kicker">Blog</p>
      <h1>
        Notes from the <span className="mkt-mark">batch</span>.
      </h1>
      <div className="mkt-grid">
        {posts.map(([title, copy]) => (
          <article key={title} className="mkt-card">
            <h2>{title}</h2>
            <p>{copy}</p>
          </article>
        ))}
      </div>
    </SiteChrome>
  );
}
