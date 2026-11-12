// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { YouTubePlayer } from "../YouTubePlayer";
import { resetYouTubeApiForTests, type PlayerSnapshot } from "../youtube";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class FakePlayer {
  static instances: FakePlayer[] = [];
  state = -1; time = 0; length = 300; muted = false; rate = 1; destroyed = false; calls: string[] = [];
  constructor(public element: HTMLElement, public options: { videoId: string; playerVars: Record<string, unknown>; events: Record<string, (e: { data: number }) => void> }) {
    FakePlayer.instances.push(this);
    const frame = document.createElement("iframe");
    frame.title = "fake youtube";
    element.appendChild(frame);
  }
  playVideo() { this.calls.push("play"); this.state = 1; this.options.events.onStateChange({ data: 1 }); }
  pauseVideo() { this.calls.push("pause"); this.state = 2; this.options.events.onStateChange({ data: 2 }); }
  seekTo(s: number) { this.calls.push(`seek:${s}`); this.time = s; }
  setPlaybackRate(r: number) { this.calls.push(`rate:${r}`); this.rate = r; }
  mute() { this.calls.push("mute"); this.muted = true; }
  unMute() { this.calls.push("unmute"); this.muted = false; }
  isMuted() { return this.muted; }
  getCurrentTime() { return this.time; }
  getDuration() { return this.length; }
  getPlayerState() { return this.state; }
  destroy() { this.destroyed = true; }
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  FakePlayer.instances = [];
  resetYouTubeApiForTests();
  (window as unknown as { YT: unknown }).YT = {
    Player: FakePlayer, PlayerState: { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 },
  };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  delete (window as unknown as { YT?: unknown }).YT;
  vi.useRealTimers();
});

async function mount(props: Partial<React.ComponentProps<typeof YouTubePlayer>> = {}) {
  await act(async () => {
    root.render(<YouTubePlayer videoId="dQw4w9WgXcQ" title="Demo" {...props} />);
  });
  await act(async () => { await Promise.resolve(); });
  const fake = FakePlayer.instances[0];
  await act(async () => { fake.options.events.onReady({ data: 0 }); });
  return fake;
}

const button = (label: string) => container.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement;

describe("YouTubePlayer (customized player)", () => {
  it("creates the official player with YouTube's own controls turned off", async () => {
    const fake = await mount({ startSeconds: 90 });
    expect(fake.options.videoId).toBe("dQw4w9WgXcQ");
    expect(fake.options.playerVars).toMatchObject({ controls: 0, rel: 0, modestbranding: 1, start: 90, fs: 0 });
    expect(container.querySelector("iframe")).not.toBeNull();
    expect(container.querySelector('[aria-label="Video player: Demo"]')).not.toBeNull();
  });

  it("draws our own control bar", async () => {
    await mount();
    for (const label of ["Play", "Back 10 seconds", "Forward 10 seconds", "Mute", "Full screen"]) {
      expect(button(label), label).not.toBeNull();
    }
    expect(container.querySelector('input[aria-label="Seek"]')).not.toBeNull();
    expect(container.querySelector('select[aria-label], select')).not.toBeNull();
    expect(container.textContent).toContain("0:00 / 5:00");
  });

  it("plays, pauses and shows the current time", async () => {
    const fake = await mount();
    await act(async () => { button("Play").click(); });
    expect(fake.calls).toContain("play");
    expect(button("Pause")).not.toBeNull();
    fake.time = 65;
    await act(async () => { vi.advanceTimersByTime(600); });
    expect(container.textContent).toContain("1:05 / 5:00");
    await act(async () => { button("Pause").click(); });
    expect(fake.calls).toContain("pause");
  });

  it("skips back and forward 10 seconds", async () => {
    const fake = await mount();
    fake.time = 100;
    await act(async () => { vi.advanceTimersByTime(600); });
    await act(async () => { button("Forward 10 seconds").click(); });
    expect(fake.time).toBe(110);
    await act(async () => { button("Back 10 seconds").click(); });
    expect(fake.time).toBe(100);
  });

  it("changes speed and mutes", async () => {
    const fake = await mount();
    const select = container.querySelector("select") as HTMLSelectElement;
    await act(async () => {
      select.value = "1.5";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(fake.calls).toContain("rate:1.5");
    await act(async () => { button("Mute").click(); });
    expect(fake.muted).toBe(true);
    expect(button("Unmute")).not.toBeNull();
  });

  it("works from the keyboard (space, arrows, m)", async () => {
    const fake = await mount();
    const group = container.querySelector('[role="group"]') as HTMLElement;
    const press = (key: string) => act(async () => { group.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })); });
    await press(" ");
    expect(fake.calls).toContain("play");
    fake.time = 50;
    await act(async () => { vi.advanceTimersByTime(600); });
    await press("ArrowRight");
    expect(fake.time).toBe(55);
    await press("ArrowLeft");
    expect(fake.time).toBe(50);
    await press("m");
    expect(fake.muted).toBe(true);
  });

  it("reports its state so the page can save progress and time the study session", async () => {
    const updates: PlayerSnapshot[] = [];
    const fake = await mount({ onUpdate: (s) => updates.push(s) });
    await act(async () => { button("Play").click(); });
    fake.time = 12;
    await act(async () => { vi.advanceTimersByTime(600); });
    const last = updates.at(-1)!;
    expect(last).toMatchObject({ playing: true, position: 12, duration: 300 });
  });

  it("explains when a video cannot be embedded and links to YouTube", async () => {
    const fake = await mount();
    await act(async () => { fake.options.events.onError({ data: 150 }); });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("does not allow it to be played here");
    const link = container.querySelector("a") as HTMLAnchorElement;
    expect(link.href).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(link.rel).toContain("noopener");
  });

  it("shows a general message for other errors", async () => {
    const fake = await mount();
    await act(async () => { fake.options.events.onError({ data: 2 }); });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("could not be played");
  });

  it("switches to a new video without leaving the old player behind", async () => {
    const first = await mount();
    await act(async () => { root.render(<YouTubePlayer videoId="aaaaaaaaaaa" title="Other" />); });
    await act(async () => { await Promise.resolve(); });
    expect(first.destroyed).toBe(true);
    expect(FakePlayer.instances).toHaveLength(2);
    expect(FakePlayer.instances[1].options.videoId).toBe("aaaaaaaaaaa");
    expect(container.querySelectorAll("iframe")).toHaveLength(1);
  });

  it("loads a new video after the previous one showed an error (for example pasting another link)", async () => {
    const first = await mount();
    await act(async () => { first.options.events.onError({ data: 150 }); });
    expect(container.querySelector('[role="alert"]')).not.toBeNull();

    // The person pastes a different link over the old one: only the video id changes.
    await act(async () => { root.render(<YouTubePlayer videoId="aaaaaaaaaaa" title="Other" />); });
    await act(async () => { await Promise.resolve(); });
    const second = FakePlayer.instances[1];
    await act(async () => { second.options.events.onReady({ data: 0 }); });

    expect(container.querySelector('[role="alert"]')).toBeNull();            // the error is gone
    expect(container.querySelectorAll("iframe")).toHaveLength(1);              // and the new player is really on the page
    expect(container.textContent).not.toContain("Loading player");
    expect(first.destroyed).toBe(true);
  });

  it("cleans up when removed", async () => {
    const fake = await mount();
    act(() => root.unmount());
    expect(fake.destroyed).toBe(true);
    root = createRoot(container);
  });

  it("shows a loading state until the player is ready", async () => {
    await act(async () => { root.render(<YouTubePlayer videoId="dQw4w9WgXcQ" />); });
    expect(container.textContent).toContain("Loading player");
  });
});
