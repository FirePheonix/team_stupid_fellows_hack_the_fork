import packageJson from "../../package.json";

const currentYear = new Date().getFullYear();

/** Product name shown in the dashboard. */
export const BRAND = "FermaTwin";

/**
 * Email and password sign-in, registration, and Razorpay billing stay in the repo.
 * They are stale: the live site does not offer them.
 */
export const AUTH_AND_BILLING_STALE: boolean = true;

export const APP_CONFIG = {
  name: "FermaTwin",
  version: packageJson.version,
  copyright: `\u00A9 ${currentYear}, FermaTwin.`,
  meta: {
    title: "FermaTwin · fermentation process intelligence",
    description:
      "A simulated yeast bioreactor with trained protein prediction, fault detection, and explainable alerts. No plant hardware required.",
  },
};
