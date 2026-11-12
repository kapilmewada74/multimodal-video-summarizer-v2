// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiFetch = vi.fn();
vi.mock("../../../lib/api", () => ({
  apiFetch: (...a: unknown[]) => apiFetch(...a),
  readError: async (res: Response, fallback = "x") => {
    try { return (await res.clone().json()).message ?? fallback; } catch { return fallback; }
  },
}));

import { DRIVE_SCOPE, rememberPendingDrive, saveToDrive, takePendingDrive } from "../drive";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  apiFetch.mockReset();
  sessionStorage.clear();
});

describe("saveToDrive", () => {
  it("sends the token in the body and returns the Google Doc link", async () => {
    apiFetch.mockResolvedValue(json({ id: "d", name: "Notes", url: "https://docs.google.com/document/d/d/edit" }));
    const result = await saveToDrive("v1", "ya29.token");
    expect(result).toEqual({ ok: true, name: "Notes", url: "https://docs.google.com/document/d/d/edit" });
    const [url, init] = apiFetch.mock.calls[0];
    expect(url).toBe("/api/videos/v1/export/drive");
    expect(JSON.parse(init.body)).toEqual({ access_token: "ya29.token" });
    expect(url).not.toContain("ya29"); // never in the address
  });

  it("asks for permission again when Google refused the token", async () => {
    apiFetch.mockResolvedValue(json({ code: "drive_auth", message: "Connect again" }, 400));
    expect(await saveToDrive("v1", "t")).toEqual({ ok: false, needsConsent: true, message: "Connect again" });
  });

  it("reports other failures without asking for permission", async () => {
    apiFetch.mockResolvedValue(json({ code: "drive_failed", message: "Try later" }, 502));
    expect(await saveToDrive("v1", "t")).toEqual({ ok: false, needsConsent: false, message: "Try later" });
    apiFetch.mockResolvedValue(new Response("oops", { status: 500 }));
    expect((await saveToDrive("v1", "t")).ok).toBe(false);
  });
});

describe("pending save while the user is at Google", () => {
  it("is remembered for the same video only, and only once", () => {
    rememberPendingDrive("v1");
    expect(takePendingDrive("v2")).toBe(false);
    expect(takePendingDrive("v1")).toBe(true);
    expect(takePendingDrive("v1")).toBe(false);
  });
});
