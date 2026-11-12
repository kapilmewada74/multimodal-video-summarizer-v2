// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StudySummary } from "../../../lib/types";
import { ACTIVE_WINDOW_MS, isRecentlyActive, isStudying, markActivity, resetActivityForTests, trackPageActivity } from "../activity";
import { StudyTracker, type StudyApi } from "../tracker";

const summary = (credited = 0): StudySummary => ({
  credited, today: { seconds: 0, videos_done: 0, quizzes_taken: 0 }, goals: [],
  streak: { current: 0, longest: 0, today_done: false, min_seconds: 600 },
});

describe("activity detection", () => {
  beforeEach(() => resetActivityForTests());

  it("is inactive until something happens, then active for two minutes", () => {
    expect(isRecentlyActive(1_000_000)).toBe(false);
    markActivity(1_000_000);
    expect(isRecentlyActive(1_000_000 + ACTIVE_WINDOW_MS)).toBe(true);
    expect(isRecentlyActive(1_000_000 + ACTIVE_WINDOW_MS + 1)).toBe(false);
  });

  it("counts study only while the tab is visible and the video plays or the user is active", () => {
    markActivity(5_000);
    expect(isStudying(true, true, 9_000_000)).toBe(true);    // watching, even without touching the page
    expect(isStudying(false, true, 6_000)).toBe(true);       // reading, recently active
    expect(isStudying(false, true, 9_000_000)).toBe(false);  // idle
    expect(isStudying(true, false, 6_000)).toBe(false);      // tab hidden
  });

  it("notices real page interaction and can be stopped", () => {
    const target = new EventTarget() as unknown as Window;
    const stop = trackPageActivity(target);
    resetActivityForTests();
    // (reset cleared the listener flag as well; start again to test the event path)
    const stop2 = trackPageActivity(target);
    expect(isRecentlyActive()).toBe(true);
    stop();
    stop2();
  });
});

describe("StudyTracker", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup(overrides: Partial<StudyApi> = {}, active = { value: true }) {
    const calls: string[] = [];
    const summaries: StudySummary[] = [];
    const seconds: number[] = [];
    const api: StudyApi = {
      start: vi.fn(async (video) => { calls.push(`start:${video}`); return "s1"; }),
      heartbeat: vi.fn(async (id, isActive) => { calls.push(`beat:${id}:${isActive}`); return summary(20); }),
      end: vi.fn(async (id) => { calls.push(`end:${id}`); }),
      ...overrides,
    };
    const tracker = new StudyTracker({ api, getActive: () => active.value, onSummary: (s) => summaries.push(s),
      onSessionSeconds: (s) => seconds.push(s), intervalMs: 20_000 });
    return { tracker, api, calls, summaries, seconds, active };
  }

  it("starts a session, sends a heartbeat every 20 seconds, and ends it", async () => {
    const { tracker, calls, summaries } = setup();
    await tracker.start("v1");
    expect(calls).toEqual(["start:v1"]);
    await vi.advanceTimersByTimeAsync(20_000);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(calls.filter((c) => c.startsWith("beat"))).toEqual(["beat:s1:true", "beat:s1:true"]);
    expect(summaries).toHaveLength(2);
    await tracker.stop();
    expect(calls.at(-1)).toBe("end:s1");
  });

  it("tells the server when the person is not studying", async () => {
    const { tracker, calls, active } = setup();
    await tracker.start(null);
    active.value = false;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(calls).toContain("beat:s1:false");
    await tracker.stop();
  });

  it("counts on-screen seconds only while studying", async () => {
    const { tracker, seconds, active } = setup();
    await tracker.start("v1");
    await vi.advanceTimersByTimeAsync(3000);
    active.value = false;
    await vi.advanceTimersByTimeAsync(5000);
    active.value = true;
    await vi.advanceTimersByTimeAsync(2000);
    expect(seconds.at(-1)).toBe(5);
    expect(tracker.getSessionSeconds()).toBe(5);
    await tracker.stop();
  });

  it("starts a fresh session if the server forgot this one", async () => {
    let first = true;
    const { tracker, calls, summaries } = setup({
      heartbeat: vi.fn(async (id) => {
        calls2.push(`beat:${id}`);
        if (first) { first = false; return "gone" as const; }
        return summary(10);
      }),
      start: vi.fn(async () => (calls2.push("start"), calls2.filter((c) => c === "start").length === 1 ? "s1" : "s2")),
    });
    const calls2: string[] = [];
    void calls;
    await tracker.start("v1");
    await vi.advanceTimersByTimeAsync(20_000);
    expect(calls2).toEqual(["start", "beat:s1", "start", "beat:s2"]);
    expect(summaries).toHaveLength(1);
    await tracker.stop();
  });

  it("survives a failed heartbeat and tries again", async () => {
    let n = 0;
    const { tracker, summaries } = setup({
      heartbeat: vi.fn(async () => { n += 1; if (n === 1) throw new Error("offline"); return summary(20); }),
    });
    await tracker.start("v1");
    await vi.advanceTimersByTimeAsync(20_000);
    expect(summaries).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(summaries).toHaveLength(1);
    await tracker.stop();
  });

  it("never sends two heartbeats at once", async () => {
    let release: () => void = () => undefined;
    const slow = vi.fn(() => new Promise<StudySummary>((resolve) => { release = () => resolve(summary()); }));
    const { tracker } = setup({ heartbeat: slow });
    await tracker.start("v1");
    await vi.advanceTimersByTimeAsync(20_000);
    await vi.advanceTimersByTimeAsync(20_000); // the first is still waiting
    expect(slow).toHaveBeenCalledTimes(1);
    release();
    await tracker.stop();
  });

  it("stopping while the session is still starting ends it cleanly", async () => {
    let resolveStart: (id: string) => void = () => undefined;
    const { tracker, api } = setup({ start: vi.fn(() => new Promise<string>((r) => { resolveStart = r; })) });
    const starting = tracker.start("v1");
    await tracker.stop();
    resolveStart("late");
    await starting;
    expect(api.end).toHaveBeenCalledWith("late");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(api.heartbeat).not.toHaveBeenCalled();
  });

  it("flush sends a heartbeat right away", async () => {
    const { tracker, calls } = setup();
    await tracker.start("v1");
    await tracker.flush("v1");
    expect(calls).toContain("beat:s1:true");
    await tracker.stop();
  });

  it("stopping twice is harmless", async () => {
    const { tracker, api } = setup();
    await tracker.start("v1");
    await tracker.stop();
    await tracker.stop();
    expect(api.end).toHaveBeenCalledTimes(1);
  });
});


describe("tracker session controls", () => {
  it("knows the server's session id once started, and can restart the on-screen timer", async () => {
    vi.useFakeTimers();
    const api: StudyApi = { start: vi.fn().mockResolvedValue("sess-9"), heartbeat: vi.fn().mockResolvedValue(summary()), end: vi.fn().mockResolvedValue(undefined) };
    const seconds: number[] = [];
    const tracker = new StudyTracker({ api, getActive: () => true, onSummary: () => {}, onSessionSeconds: (n) => seconds.push(n) });
    expect(tracker.getSessionId()).toBeNull();
    await tracker.start("v1");
    expect(tracker.getSessionId()).toBe("sess-9");
    vi.advanceTimersByTime(3000);
    expect(tracker.getSessionSeconds()).toBe(3);
    tracker.resetSeconds();
    expect(tracker.getSessionSeconds()).toBe(0);
    expect(seconds.at(-1)).toBe(0);
    vi.advanceTimersByTime(2000);
    expect(tracker.getSessionSeconds()).toBe(2);
    await tracker.stop();
    expect(tracker.getSessionId()).toBeNull();
    vi.useRealTimers();
  });

  it("does not count a second while the person is not studying (paused, on a break, tab hidden)", async () => {
    vi.useFakeTimers();
    const api: StudyApi = { start: vi.fn().mockResolvedValue("s"), heartbeat: vi.fn().mockResolvedValue(summary()), end: vi.fn().mockResolvedValue(undefined) };
    let active = true;
    const tracker = new StudyTracker({ api, getActive: () => active, onSummary: () => {} });
    await tracker.start(null);
    vi.advanceTimersByTime(5000);
    active = false;
    vi.advanceTimersByTime(60_000);
    active = true;
    vi.advanceTimersByTime(2000);
    expect(tracker.getSessionSeconds()).toBe(7);
    await tracker.stop();
    vi.useRealTimers();
  });
});
