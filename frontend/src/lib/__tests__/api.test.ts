import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch, readError, setTokenProvider } from "../api";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  setTokenProvider({ getToken: async () => null });
});
afterEach(() => vi.unstubAllGlobals());

function authHeader(callIndex = 0): string | null {
  const init = fetchMock.mock.calls[callIndex][1] as RequestInit;
  return new Headers(init.headers).get("Authorization");
}

describe("apiFetch", () => {
  it("adds the bearer token", async () => {
    setTokenProvider({ getToken: async () => "tok123" });
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    await apiFetch("/api/history");
    expect(authHeader()).toBe("Bearer tok123");
  });

  it("sends no Authorization header without a session", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    await apiFetch("/api/history");
    expect(authHeader()).toBeNull();
  });

  it("keeps the caller's own headers and body", async () => {
    setTokenProvider({ getToken: async () => "t" });
    fetchMock.mockResolvedValue(new Response("{}"));
    await apiFetch("/api/x", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(new Headers(init.headers).get("Content-Type")).toBe("application/json");
    expect(init.method).toBe("POST");
    expect(init.body).toBe("{}");
  });

  it("retries once with a fresh token when the session has expired", async () => {
    setTokenProvider({ getToken: async () => "old", refreshToken: async () => "new" });
    fetchMock
      .mockResolvedValueOnce(new Response("{}", { status: 401 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    const res = await apiFetch("/api/history");
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(authHeader(1)).toBe("Bearer new");
  });

  it("does not loop when the refreshed token is also rejected", async () => {
    setTokenProvider({ getToken: async () => "old", refreshToken: async () => "new" });
    fetchMock.mockResolvedValue(new Response("{}", { status: 401 }));
    const res = await apiFetch("/api/history");
    expect(res.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry when refreshing gives the same token or nothing", async () => {
    setTokenProvider({ getToken: async () => "same", refreshToken: async () => "same" });
    fetchMock.mockResolvedValue(new Response("{}", { status: 401 }));
    await apiFetch("/api/history");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("readError", () => {
  const json = (body: unknown, status = 400) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  it("prefers the server's message", async () => {
    expect(await readError(json({ code: "daily_limit_reached", message: "Used 10 of 10 today" }, 429))).toBe(
      "Used 10 of 10 today",
    );
  });
  it("falls back to detail", async () => {
    expect(await readError(json({ detail: "Invalid YouTube URL." }))).toBe("Invalid YouTube URL.");
  });
  it("does not show raw validation internals", async () => {
    expect(await readError(json({ detail: [{ msg: "field required", loc: ["body", "x"] }] }, 422))).toBe(
      "Some of the information sent was invalid.",
    );
  });
  it("uses the fallback for non-JSON bodies", async () => {
    expect(await readError(new Response("<html>502</html>", { status: 502 }), "Custom fallback")).toBe("Custom fallback");
  });
  it("can read the body after another reader consumed it", async () => {
    const res = json({ message: "hello" });
    await res.clone().text();
    expect(await readError(res)).toBe("hello");
  });
});
