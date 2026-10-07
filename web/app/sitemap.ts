import type { MetadataRoute } from "next";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

/** The site's own pages. Agents and matches are many and short-lived; they are reached from these. */
export default function sitemap(): MetadataRoute.Sitemap {
  return ["/", "/agent", "/live", "/field", "/ladder", "/games", "/rewards", "/about"].map((path) => ({
    url: `${SITE_URL}${path}`,
    changeFrequency: path === "/about" || path === "/games" ? "weekly" : "hourly",
    priority: path === "/" ? 1 : 0.7,
  }));
}
