/** Set these to the new public addresses when the rebrand is deployed there. */
export const siteLinks = {
  website: process.env.NEXT_PUBLIC_SITE_URL || "https://agenticpad.site",
  x: process.env.NEXT_PUBLIC_SOCIAL_X_URL || "https://x.com/agenticpadsol",
  repository: (process.env.NEXT_PUBLIC_REPOSITORY_URL || "https://github.com/pyco404/oxude").replace(/\/$/, ""),
};
