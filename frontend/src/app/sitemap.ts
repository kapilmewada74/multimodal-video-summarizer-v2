import type { MetadataRoute } from "next";
import { SITE } from "../lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return ["", "/contact", "/privacy", "/terms"].map((path) => ({
    url: `${SITE.url}${path}`,
    lastModified: now,
    changeFrequency: path ? "yearly" : "weekly",
    priority: path ? 0.3 : 1,
  }));
}
