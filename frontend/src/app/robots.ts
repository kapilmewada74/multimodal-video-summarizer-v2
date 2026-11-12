import type { MetadataRoute } from "next";
import { SITE } from "../lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      // Private pages, the API and shared summaries (they belong to the person who shared them) stay out of search results.
      { userAgent: "*", allow: "/", disallow: ["/api/", "/library", "/playlists", "/study", "/settings", "/documents", "/video/", "/s/", "/auth/", "/login"] },
    ],
    sitemap: `${SITE.url}/sitemap.xml`,
  };
}
