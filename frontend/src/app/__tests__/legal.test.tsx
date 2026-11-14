// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

import PrivacyPage from "../privacy/page";
import TermsPage from "../terms/page";
import robots from "../robots";
import sitemap from "../sitemap";

function text(node: React.ReactElement) {
  const div = document.createElement("div");
  act(() => createRoot(div).render(node));
  return div.textContent || "";
}

describe("legal pages", () => {
  it("privacy policy covers the rights the app really supports", () => {
    const t = text(<PrivacyPage />);
    for (const word of ["Service providers", "AI processing providers", "Download my data", "Delete my account", "share link", "do not sell"]) expect(t).toContain(word);
  });
  it("is honest about categories of providers without naming vendors or how the service is built", () => {
    const t = text(<PrivacyPage />).toLowerCase() + text(<TermsPage />).toLowerCase();
    for (const name of ["supabase", "groq", "gemini", "xai", "whisper", "resend", "vercel", "postgres", "sentry", "plausible", "fastapi", "row level", "database access rules"]) {
      expect(t, name).not.toContain(name);
    }
    expect(t).toContain("current list of providers");   // the details are available on request
  });
  it("terms cover AI mistakes, acceptable use and deleting the account", () => {
    const t = text(<TermsPage />);
    for (const word of ["Acceptable use", "AI output can be wrong", "delete your account", "Privacy Policy"]) expect(t).toContain(word);
  });
});

describe("search engine files", () => {
  it("keeps private pages and shared summaries out of search results", () => {
    const rule = robots().rules as { disallow: string[] };
    const blocked = (Array.isArray(rule) ? rule[0].disallow : rule.disallow);
    for (const path of ["/api/", "/library", "/s/", "/settings", "/video/", "/admin"]) expect(blocked).toContain(path);
  });
  it("lists only the public pages", () => {
    const urls = sitemap().map((e) => new URL(e.url).pathname);
    expect(urls).toEqual(["/", "/contact", "/privacy", "/terms"]);
  });
});
