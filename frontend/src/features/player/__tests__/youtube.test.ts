// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  extractYouTubeId, formatClock, loadYouTubeApi, PlayerController, ProgressThrottle, resetYouTubeApiForTests,
  resumePosition, type YTNamespace, type YTPlayerLike,
} from "../youtube";

describe("extractYouTubeId", () => {
  it.each([
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://youtube.com/watch?v=dQw4w9WgXcQ&t=30s", "dQw4w9WgXcQ"],
    ["https://m.youtube.com/watch?feature=share&v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://youtu.be/dQw4w9WgXcQ?t=5", "dQw4w9WgXcQ"],
    ["youtube.com/shorts/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/live/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/embed/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["  https://youtu.be/dQw4w9WgXcQ  ", "dQw4w9WgXcQ"],
  ])("finds the id in %s", (url, id) => {
    expect(extractYouTubeId(url)).toBe(id);
  });

  it.each([
    "", "   ", "hello", "https://example.com/watch?v=dQw4w9WgXcQ", "https://www.youtube.com/watch?v=short",
    "https://www.youtube.com.evil.com/watch?v=dQw4w9WgXcQ", "https://evil.com/?u=youtube.com/watch?v=dQw4w9WgXcQ",
    "javascript:alert(1)", 'https://youtu.be/dQw4w9WgXc"><script>',
  ])("rejects %s", (bad) => {
    expect(extractYouTubeId(bad)).toBeNull();
  });

  it("handles null and undefined", () => {
    expect(extractYouTubeId(null)).toBeNull();
    expect(extractYouTubeId(undefined)).toBeNull();
  });
});

describe("clock and resume", () => {
  it.each([[0, "0:00"], [5.9, "0:05"], [65, "1:05"], [3600, "1:00:00"], [3725, "1:02:05"], [-3, "0:00"], [NaN, "0:00"], [Infinity, "0:00"]])(
    "formats %s", (seconds, text) => expect(formatClock(seconds)).toBe(text));

  it("resumes where you left off, but not at the very start, the very end, or after finishing", () => {
    expect(resumePosition(120.9, 600, false)).toBe(120);
    expect(resumePosition(3, 600, false)).toBe(0);
    expect(resumePosition(597, 600, false)).toBe(0);
    expect(resumePosition(300, 600, true)).toBe(0);
    expect(resumePosition(300, 0, false)).toBe(300); // unknown length: trust the saved position
  });
});

describe("ProgressThrottle", () => {
  it("saves at most every interval while playing", () => {
    const t = new ProgressThrottle(10_000);
    expect(t.next(0, 5, true, false)).toBe(5);
    expect(t.next(3000, 8, true, false)).toBeNull();
    expect(t.next(9999, 14, true, false)).toBeNull();
    expect(t.next(10_000, 15, true, false)).toBe(15);
  });

  it("saves immediately when paused and when the video ends", () => {
    const t = new ProgressThrottle(10_000);
    t.next(0, 5, true, false);
    expect(t.next(1000, 7, false, false)).toBe(7); // just paused
    expect(t.next(2000, 7, false, false)).toBeNull(); // still paused, nothing new
    expect(t.next(3000, 100, false, true)).toBe(100); // ended
  });

  it("never saves an unchanged or zero position", () => {
    const t = new ProgressThrottle(10);
    expect(t.next(0, 0, true, false)).toBeNull();
    expect(t.next(100, 12, true, false)).toBe(12);
    expect(t.next(200, 12.4, true, false)).toBeNull();
  });
});

// ---- a fake of YouTube's IFrame API ---------------------------------------------------------
class FakePlayer implements YTPlayerLike {
  static last: FakePlayer;
  state = -1; time = 0; length = 600; muted = false; rate = 1; destroyed = false;
  calls: string[] = [];
  constructor(public element: unknown, public options: { events: Record<string, (e: { data: number }) => void>; playerVars: Record<string, unknown>; videoId: string }) {
    FakePlayer.last = this;
  }
  playVideo() { this.calls.push("play"); this.state = 1; this.options.events.onStateChange({ data: 1 }); }
  pauseVideo() { this.calls.push("pause"); this.state = 2; this.options.events.onStateChange({ data: 2 }); }
  seekTo(s: number) { this.calls.push(`seek:${s}`); this.time = s; }
  setPlaybackRate(r: number) { this.rate = r; }
  mute() { this.muted = true; }
  unMute() { this.muted = false; }
  isMuted() { return this.muted; }
  getCurrentTime() { return this.time; }
  getDuration() { return this.length; }
  getPlayerState() { return this.state; }
  destroy() { this.destroyed = true; }
}
const FakeYT = { Player: FakePlayer, PlayerState: { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 } } as unknown as YTNamespace;

describe("PlayerController", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function make(options = {}) {
    const updates: ReturnType<PlayerController["getSnapshot"]>[] = [];
    const errors: number[] = [];
    const controller = new PlayerController(FakeYT, document.createElement("div"),
      { videoId: "dQw4w9WgXcQ", startSeconds: 42.7, origin: "https://app.test", ...options },
      { onUpdate: (s) => updates.push(s), onError: (c) => errors.push(c) });
    return { controller, updates, errors, fake: () => FakePlayer.last };
  }

  it("uses our own controls and starts where asked", () => {
    const { fake } = make();
    const vars = fake().options.playerVars;
    expect(fake().options.videoId).toBe("dQw4w9WgXcQ");
    expect(vars.controls).toBe(0); // YouTube's own controls are hidden
    expect(vars.start).toBe(42);
    expect(vars.origin).toBe("https://app.test");
    expect(vars.rel).toBe(0);
    expect(vars.fs).toBe(0);
  });

  it("reports the position and duration once ready, and keeps updating", () => {
    const { updates, fake } = make();
    fake().options.events.onReady({ data: 0 });
    expect(updates.at(-1)).toMatchObject({ ready: true, duration: 600, playing: false });
    fake().time = 12;
    vi.advanceTimersByTime(600);
    expect(updates.at(-1)?.position).toBe(12);
  });

  it("follows play and pause", () => {
    const { controller, updates, fake } = make();
    fake().options.events.onReady({ data: 0 });
    controller.toggle();
    expect(fake().calls).toContain("play");
    expect(updates.at(-1)?.playing).toBe(true);
    controller.toggle();
    expect(fake().calls).toContain("pause");
    expect(updates.at(-1)?.playing).toBe(false);
    fake().options.events.onStateChange({ data: 0 });
    expect(updates.at(-1)?.ended).toBe(true);
  });

  it("keeps seeks inside the video and supports skipping", () => {
    const { controller, fake } = make();
    fake().options.events.onReady({ data: 0 });
    controller.seek(-50);
    expect(fake().time).toBe(0);
    controller.seek(9999);
    expect(fake().time).toBe(600);
    controller.seek(100);
    controller.skip(10);
    expect(fake().time).toBe(110);
    controller.skip(-500);
    expect(fake().time).toBe(0);
  });

  it("changes speed and mute", () => {
    const { controller, updates, fake } = make();
    fake().options.events.onReady({ data: 0 });
    controller.setRate(1.5);
    expect(fake().rate).toBe(1.5);
    expect(updates.at(-1)?.rate).toBe(1.5);
    controller.setMuted(true);
    expect(fake().muted).toBe(true);
    controller.setMuted(false);
    expect(fake().muted).toBe(false);
  });

  it("passes errors on and stops everything when destroyed", () => {
    const { controller, updates, errors, fake } = make();
    fake().options.events.onReady({ data: 0 });
    fake().options.events.onError({ data: 150 });
    expect(errors).toEqual([150]);
    controller.destroy();
    expect(fake().destroyed).toBe(true);
    const count = updates.length;
    vi.advanceTimersByTime(5000);
    expect(updates.length).toBe(count); // the polling timer is gone
    expect(() => controller.play()).not.toThrow();
  });

  it("ignores a bad time reading", () => {
    const { updates, fake } = make();
    fake().options.events.onReady({ data: 0 });
    fake().time = 20;
    vi.advanceTimersByTime(600);
    fake().time = NaN;
    vi.advanceTimersByTime(600);
    expect(updates.at(-1)?.position).toBe(20);
  });
});

describe("loadYouTubeApi", () => {
  beforeEach(() => {
    resetYouTubeApiForTests();
    document.head.innerHTML = "";
  });

  it("loads the script once and resolves when YouTube says it is ready", async () => {
    const win = { YT: undefined, onYouTubeIframeAPIReady: undefined } as unknown as Window;
    const first = loadYouTubeApi(win, document);
    const second = loadYouTubeApi(win, document);
    expect(document.head.querySelectorAll("script").length).toBe(1);
    expect(document.head.querySelector("script")?.src).toBe("https://www.youtube.com/iframe_api");
    (win as unknown as { YT: YTNamespace }).YT = FakeYT;
    win.onYouTubeIframeAPIReady?.();
    expect(await first).toBe(FakeYT);
    expect(await second).toBe(FakeYT);
  });

  it("returns immediately if the API is already there", async () => {
    const win = { YT: FakeYT } as unknown as Window;
    expect(await loadYouTubeApi(win, document)).toBe(FakeYT);
    expect(document.head.querySelectorAll("script").length).toBe(0);
  });

  it("can be retried after a failed load", async () => {
    const win = { YT: undefined } as unknown as Window;
    const failing = loadYouTubeApi(win, document);
    document.head.querySelector("script")?.onerror?.(new Event("error"));
    await expect(failing).rejects.toThrow(/Could not load/);
    document.head.innerHTML = "";
    void loadYouTubeApi(win, document);
    expect(document.head.querySelectorAll("script").length).toBe(1);
  });
});
