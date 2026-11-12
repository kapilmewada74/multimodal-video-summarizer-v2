/** Public facts about the site, from build-time settings. Safe for the browser (nothing secret). */
export const SITE = {
  name: "SUMMARIZE.AI",
  url: (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, ""),
  contactEmail: process.env.NEXT_PUBLIC_CONTACT_EMAIL || "",
  operator: process.env.NEXT_PUBLIC_OPERATOR_NAME || "the operator of SUMMARIZE.AI",
  analyticsDomain: process.env.NEXT_PUBLIC_ANALYTICS_DOMAIN || "",
  analyticsHost: (process.env.NEXT_PUBLIC_ANALYTICS_HOST || "https://plausible.io").replace(/\/$/, ""),
};
export const LEGAL_UPDATED = "12 November 2026";
