// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StudySummary } from "../../../lib/types";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
const playChime = vi.fn();
const showNotification = vi.fn();
vi.mock("../alerts", () => ({
  playChime: () => playChime(),
  showNotification: (...a: unknown[]) => showNotification(...a),
  ensureNotificationPermission: async () => true,
  notificationsSupported: () => true,
}));
const recordPomodoro = vi.fn().mockResolvedValue(true);
vi.mock("../api", () => ({ recordPomodoro: (...a: unknown[]) => recordPomodoro(...a), httpStudyApi: {} }));
const session = {
  summary: null as StudySummary | null, sessionSeconds: 754,
  getSessionId: vi.fn(() => "sess-1"), resetSession: vi.fn(), flush: vi.fn().mockResolvedValue(undefined),
};
let lastControl: { paused: boolean; onBreak: boolean } | null = null;
vi.mock("../useStudySession", () => ({
  useStudySession: (_v: unknown, _p: unknown, _e: unknown, control: { paused: boolean; onBreak: boolean }) => { lastControl = control; return session; },
}));

import { StudyPanel } from "../StudyPanel";
import { useStudyTools } from "../useStudyTools";

const toast = vi.fn();
function Harness() {
  const tools = useStudyTools("v1", false, true, toast);
  return <StudyPanel tools={tools} />;
}

const summary = (over: Partial<StudySummary> = {}): StudySummary => ({
  credited: 0,
  today: { seconds: 25 * 60, videos_done: 0, quizzes_taken: 0, pomodoros: 2 },
  goals: [{ type: "minutes", target: 50, progress: 25, unit: "min", done: false, active: true }],
  streak: { current: 5, longest: 9, today_done: true, min_seconds: 600, freeze_available: true, at_risk: false, frozen_days: [] },
  ...over,
});

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-11T10:00:00Z"));
  localStorage.clear();
  push.mockReset(); playChime.mockReset(); showNotification.mockReset(); recordPomodoro.mockClear(); toast.mockReset();
  session.sessionSeconds = 754;
  session.summary = summary();
  session.resetSession.mockReset(); session.flush.mockClear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

const mount = () => act(() => root.render(<Harness />));
const q = <T extends Element>(sel: string) => container.querySelector(sel) as T;
const menuButton = () => q<HTMLButtonElement>("[aria-label='Study session options']");
const items = () => [...container.querySelectorAll<HTMLButtonElement>("[role=menuitem]")];
const item = (text: string) => items().find((i) => i.textContent?.includes(text))!;
const openMenu = () => act(() => menuButton().click());
const choose = (text: string) => { openMenu(); act(() => item(text).click()); };
const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

describe("the study bar", () => {
  it("shows this visit's timer, today's progress and the streak", () => {
    mount();
    expect(container.textContent).toContain("12:34");
    expect(container.textContent).toContain("25 / 50 min today");
    expect(q("[aria-label='Daily minutes goal']").getAttribute("aria-valuenow")).toBe("50");
    expect(container.textContent).toContain("5-day streak");
    expect(q("[aria-label='One missed day is forgiven this week']")).not.toBeNull();
  });

  it("warns when the streak is at risk", () => {
    session.summary = summary({ streak: { current: 5, longest: 9, today_done: false, min_seconds: 600, freeze_available: false, at_risk: true } });
    mount();
    expect(q("[title='Study today to keep your streak']")).not.toBeNull();
    expect(q("[aria-label='One missed day is forgiven this week']")).toBeNull();
  });

  it("has a three-dot menu with the session options", () => {
    mount();
    openMenu();
    expect(items().map((i) => i.textContent)).toEqual(expect.arrayContaining([
      expect.stringContaining("Focus timer (Pomodoro)"), expect.stringContaining("Timer lengths and sounds"),
      expect.stringContaining("Pause tracking"), expect.stringContaining("Set a goal for this visit"),
      expect.stringContaining("Restart this visit"), expect.stringContaining("Stats, streak and goals"),
    ]));
  });

  it("the stats item opens the study page", () => {
    mount();
    choose("Stats, streak and goals");
    expect(push).toHaveBeenCalledWith("/study");
  });
});

describe("pausing tracking", () => {
  it("tells the tracker nothing should be counted, flushes what was studied, and can resume", () => {
    mount();
    expect(lastControl).toEqual({ paused: false, onBreak: false });
    choose("Pause tracking");
    expect(session.flush).toHaveBeenCalledTimes(1);
    expect(lastControl).toEqual({ paused: true, onBreak: false });
    expect(container.textContent).toContain("Paused");
    openMenu();
    expect(item("Resume tracking")).toBeDefined();
    act(() => item("Resume tracking").click());
    expect(lastControl?.paused).toBe(false);
    expect(container.textContent).not.toContain("Paused");
  });

  it("restarting the visit's timer does not touch saved study time", () => {
    mount();
    choose("Restart this visit");
    expect(session.resetSession).toHaveBeenCalledTimes(1);
  });
});

describe("goal for this visit", () => {
  it("shows the goal, its progress, and says so once when it is reached", () => {
    mount();
    choose("Set a goal for this visit");
    expect(q("[role=group][aria-label='Goal for this visit']")).not.toBeNull();
    act(() => [...container.querySelectorAll("button")].find((b) => b.textContent === "15 min")!.click());
    expect(container.textContent).toContain("Visit goal 15 min");
    expect(q("[aria-label='Goal for this visit'][role=progressbar]").getAttribute("aria-valuenow")).toBe("84");   // 754 s of 900 s
    expect(toast).not.toHaveBeenCalled();
    session.sessionSeconds = 901;
    mount();
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith("Session goal reached: 15 minutes of study.", "success");
    expect(playChime).toHaveBeenCalledTimes(1);
    session.sessionSeconds = 950;
    mount();
    expect(toast).toHaveBeenCalledTimes(1);                                                                     // not again
  });

  it("can be removed", () => {
    mount();
    choose("Set a goal for this visit");
    act(() => [...container.querySelectorAll("button")].find((b) => b.textContent === "30 min")!.click());
    choose("Change the goal for this visit");
    act(() => [...container.querySelectorAll("button")].find((b) => b.textContent?.includes("No goal"))!.click());
    expect(container.textContent).not.toContain("Visit goal");
  });
});

describe("focus timer", () => {
  const timerText = () => q("[role=timer]").textContent;
  const start = () => act(() => [...container.querySelectorAll("button")].find((b) => b.textContent === "Start")!.click());

  it("opens from the menu with the classic 25 minute focus block, ready to start", () => {
    mount();
    choose("Focus timer (Pomodoro)");
    expect(q("[role=group][aria-label='Focus timer']")).not.toBeNull();
    expect(timerText()).toBe("25:00");
    expect(container.textContent).toContain("Focus");
    expect(container.textContent).toContain("2 focus blocks today");
  });

  it("counts down, and breaks are not study time", () => {
    mount();
    choose("Focus timer (Pomodoro)");
    start();
    advance(60_000);
    expect(timerText()).toBe("24:00");
    expect(lastControl?.onBreak).toBe(false);                    // focusing: counts
    advance(24 * 60_000);                                        // block ends: a break starts on its own
    expect(container.textContent).toContain("Short break");
    expect(container.textContent).toContain("Break: not counted");
    expect(lastControl?.onBreak).toBe(true);
  });

  it("a finished focus block rings, notifies and is sent to the server once for this session", () => {
    mount();
    choose("Focus timer (Pomodoro)");
    start();
    advance(25 * 60_000 + 600);
    expect(playChime).toHaveBeenCalled();
    expect(showNotification).toHaveBeenCalledWith("Focus time is over", expect.any(String));
    expect(recordPomodoro).toHaveBeenCalledTimes(1);
    expect(recordPomodoro).toHaveBeenCalledWith("sess-1");
  });

  it("pausing keeps the time left and starting again picks it up", () => {
    mount();
    choose("Focus timer (Pomodoro)");
    start();
    advance(10 * 60_000);
    act(() => [...container.querySelectorAll("button")].find((b) => b.textContent === "Pause")!.click());
    expect(timerText()).toBe("15:00");
    advance(5 * 60_000);
    expect(timerText()).toBe("15:00");
    expect([...container.querySelectorAll("button")].some((b) => b.textContent === "Resume")).toBe(true);
  });

  it("skip moves to the break without counting a block; reset goes back", () => {
    mount();
    choose("Focus timer (Pomodoro)");
    start();
    advance(60_000);
    act(() => q<HTMLButtonElement>("[aria-label='Skip to the next phase']").click());
    expect(container.textContent).toContain("Short break");
    expect(timerText()).toBe("05:00");
    expect(recordPomodoro).not.toHaveBeenCalled();
    act(() => q<HTMLButtonElement>("[aria-label='Reset the timer']").click());
    expect(timerText()).toBe("25:00");
    expect(container.textContent).toContain("Focus");
  });

  it("a running timer shows as a small chip in the bar after the card is closed", () => {
    mount();
    choose("Focus timer (Pomodoro)");
    start();
    advance(60_000);
    act(() => q<HTMLButtonElement>("[aria-label='Close the focus timer']").click());
    const chip = q<HTMLButtonElement>("[aria-label^='Focus timer: Focus']");
    expect(chip.textContent).toContain("24:00");
  });

  it("shows the countdown in the tab title while running, and restores it afterwards", () => {
    document.title = "Gradient descent";
    mount();
    choose("Focus timer (Pomodoro)");
    start();
    advance(1000);
    expect(document.title).toMatch(/^\(24:59 Focus\) Gradient descent$/);
    act(() => [...container.querySelectorAll("button")].find((b) => b.textContent === "Pause")!.click());
    expect(document.title).toBe("Gradient descent");
  });
});

describe("timer settings", () => {
  const openSettings = () => choose("Timer lengths and sounds");

  it("offers presets and custom lengths, and a preset changes the idle timer", () => {
    mount();
    openSettings();
    expect(q("[role=group][aria-label='Timer settings']")).not.toBeNull();
    act(() => [...container.querySelectorAll("button")].find((b) => b.textContent?.startsWith("Deep work"))!.click());
    expect(q("[role=timer]").textContent).toBe("50:00");
    expect([...container.querySelectorAll("button")].find((b) => b.textContent?.startsWith("Deep work"))!.getAttribute("aria-pressed")).toBe("true");
    const saved = JSON.parse(localStorage.getItem("pomodoro-settings-v1")!);
    expect(saved).toMatchObject({ focusMin: 50, shortMin: 10, longMin: 30, cycles: 3 });
  });

  it("a custom focus length is applied, kept in range and marked custom", () => {
    mount();
    openSettings();
    const focus = q<HTMLInputElement>("input[aria-label='Focus (min)']");
    const setValue = (el: HTMLInputElement, v: string) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    };
    act(() => setValue(focus, "40"));
    expect(q("[role=timer]").textContent).toBe("40:00");
    expect(container.textContent).toContain("Custom: change a length below".slice(0, 6));
    act(() => setValue(focus, "9999"));
    expect(q<HTMLInputElement>("input[aria-label='Focus (min)']").value).toBe("180");
    act(() => q<HTMLButtonElement>("[aria-label='Less focus']").click());
    expect(q<HTMLInputElement>("input[aria-label='Focus (min)']").value).toBe("179");
  });

  it("the switches are saved and a running timer is not changed under you", () => {
    mount();
    openSettings();
    act(() => q<HTMLInputElement>("[role=switch][type=checkbox]").click());                // start breaks automatically: off
    expect(JSON.parse(localStorage.getItem("pomodoro-settings-v1")!).autoStartBreaks).toBe(false);
    act(() => [...container.querySelectorAll("button")].find((b) => b.textContent === "Start")!.click());
    advance(60_000);
    act(() => q<HTMLButtonElement>("[aria-label='More focus']").click());
    expect(q("[role=timer]").textContent).toBe("24:00");
  });

  it("settings and progress survive a reload", () => {
    mount();
    openSettings();
    act(() => [...container.querySelectorAll("button")].find((b) => b.textContent?.startsWith("Quick"))!.click());
    act(() => [...container.querySelectorAll("button")].find((b) => b.textContent === "Start")!.click());
    advance(3 * 60_000);
    act(() => root.unmount());
    root = createRoot(container);
    mount();
    expect(q("[aria-label^='Focus timer: Focus']").textContent).toContain("12:00");          // 15 min block, 3 gone
  });

  it("damaged saved settings fall back to the defaults instead of breaking the page", () => {
    localStorage.setItem("pomodoro-settings-v1", "{not json");
    localStorage.setItem("pomodoro-state-v1", "42");
    mount();
    choose("Focus timer (Pomodoro)");
    expect(q("[role=timer]").textContent).toBe("25:00");
  });
});
