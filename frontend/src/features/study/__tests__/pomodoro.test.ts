import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS, LIMITS, PRESETS, applySettings, formatCountdown, initialState, matchingPreset, nextPhase, pause, phaseMs,
  progress, remainingMs, reset, restore, sanitizeSettings, skip, start, tick, type PomodoroSettings,
} from "../pomodoro";

const S: PomodoroSettings = { ...DEFAULT_SETTINGS, focusMin: 25, shortMin: 5, longMin: 15, cycles: 4, autoStartBreaks: true, autoStartFocus: false };
const T0 = 1_000_000_000_000;
const MIN = 60_000;

describe("settings", () => {
  it("fills in defaults and keeps every value in range, whatever was saved", () => {
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings("garbage")).toEqual(DEFAULT_SETTINGS);
    const wild = sanitizeSettings({ focusMin: 9999, shortMin: -4, longMin: "12", cycles: 1.4, sound: "yes", notify: false });
    expect(wild.focusMin).toBe(LIMITS.focusMin.max);
    expect(wild.shortMin).toBe(LIMITS.shortMin.min);
    expect(wild.longMin).toBe(12);
    expect(wild.cycles).toBe(LIMITS.cycles.min);
    expect(wild.sound).toBe(DEFAULT_SETTINGS.sound);       // not a boolean: default
    expect(wild.notify).toBe(false);
    expect(sanitizeSettings({ focusMin: NaN }).focusMin).toBe(DEFAULT_SETTINGS.focusMin);
  });

  it("recognises the presets and calls anything else custom", () => {
    for (const p of PRESETS) expect(matchingPreset({ ...S, focusMin: p.focusMin, shortMin: p.shortMin, longMin: p.longMin, cycles: p.cycles })?.id).toBe(p.id);
    expect(matchingPreset({ ...S, focusMin: 33 })).toBeNull();
  });

  it("the presets are inside the allowed limits", () => {
    for (const p of PRESETS) {
      expect(p.focusMin).toBeGreaterThanOrEqual(LIMITS.focusMin.min);
      expect(p.shortMin).toBeGreaterThanOrEqual(LIMITS.shortMin.min);
      expect(p.longMin).toBeLessThanOrEqual(LIMITS.longMin.max);
      expect(p.cycles).toBeLessThanOrEqual(LIMITS.cycles.max);
    }
  });
});

describe("running the clock", () => {
  it("starts idle at the full focus length", () => {
    const s = initialState(S);
    expect(s).toMatchObject({ phase: "focus", running: false, endsAt: null, remainingMs: 25 * MIN, doneInRound: 0 });
    expect(remainingMs(s, T0)).toBe(25 * MIN);
  });

  it("counts down from the end time, so it stays right however often it is checked", () => {
    const s = start(initialState(S), T0);
    expect(s.running && s.endsAt).toBe(T0 + 25 * MIN);
    expect(remainingMs(s, T0 + 10 * MIN)).toBe(15 * MIN);
    expect(remainingMs(s, T0 + 99 * MIN)).toBe(0);
  });

  it("pauses and resumes without losing or gaining time", () => {
    const running = start(initialState(S), T0);
    const paused = pause(running, T0 + 10 * MIN);
    expect(paused).toMatchObject({ running: false, endsAt: null, remainingMs: 15 * MIN });
    expect(remainingMs(paused, T0 + 500 * MIN)).toBe(15 * MIN);          // time passing while paused changes nothing
    const resumed = start(paused, T0 + 60 * MIN);
    expect(resumed.endsAt).toBe(T0 + 75 * MIN);
    expect(start(resumed, T0 + 61 * MIN)).toBe(resumed);                 // starting twice does nothing
    expect(pause(paused, T0)).toBe(paused);
  });

  it("does nothing on a tick before the end", () => {
    const s = start(initialState(S), T0);
    const r = tick(s, S, T0 + 24 * MIN);
    expect(r.finished).toBeNull();
    expect(r.state).toBe(s);
    expect(tick(initialState(S), S, T0).finished).toBeNull();            // not running
  });
});

describe("phases", () => {
  it("a finished focus block is reported and a short break starts by itself when asked", () => {
    const r = tick(start(initialState(S), T0), S, T0 + 25 * MIN);
    expect(r.finished).toBe("focus");
    expect(r.state).toMatchObject({ phase: "short", running: true, doneInRound: 1, remainingMs: 5 * MIN });
    expect(r.state.endsAt).toBe(T0 + 30 * MIN);
  });

  it("breaks wait for you when automatic breaks are off", () => {
    const r = tick(start(initialState(S), T0), { ...S, autoStartBreaks: false }, T0 + 25 * MIN);
    expect(r.state).toMatchObject({ phase: "short", running: false, endsAt: null });
  });

  it("the next focus block starts by itself only when asked", () => {
    const inBreak = { phase: "short" as const, running: true, endsAt: T0, remainingMs: 5 * MIN, doneInRound: 1 };
    expect(tick(inBreak, S, T0).state).toMatchObject({ phase: "focus", running: false });
    expect(tick(inBreak, { ...S, autoStartFocus: true }, T0).state).toMatchObject({ phase: "focus", running: true });
    expect(tick(inBreak, S, T0).finished).toBe("short");
  });

  it("every fourth block is followed by a long break, which closes the round", () => {
    let state = initialState(S);
    let t = T0;
    const phases: string[] = [];
    for (let i = 0; i < 9; i++) {                                       // focus, break, focus, break ... through one full round
      state = start(state, t);
      const r = tick(state, { ...S, autoStartBreaks: false, autoStartFocus: false }, state.endsAt!);
      t = state.endsAt!;
      phases.push(`${state.phase}->${r.state.phase}:${r.state.doneInRound}`);
      state = r.state;
    }
    expect(phases).toEqual([
      "focus->short:1", "short->focus:1", "focus->short:2", "short->focus:2",
      "focus->short:3", "short->focus:3", "focus->long:4", "long->focus:0", "focus->short:1",
    ]);
  });

  it("a long sleep moves on only one phase, not through the whole day", () => {
    const s = start(initialState(S), T0);
    const r = tick(s, S, T0 + 24 * 60 * MIN);
    expect(r.finished).toBe("focus");
    expect(r.state.phase).toBe("short");
    expect(r.state.endsAt).toBe(T0 + 24 * 60 * MIN + 5 * MIN);          // the break starts from now, it is not already over
  });

  it("nextPhase follows the round", () => {
    expect(nextPhase({ ...initialState(S), phase: "focus", doneInRound: 3 }, S)).toEqual({ phase: "long", doneInRound: 4 });
    expect(nextPhase({ ...initialState(S), phase: "focus", doneInRound: 0 }, S)).toEqual({ phase: "short", doneInRound: 1 });
    expect(nextPhase({ ...initialState(S), phase: "long", doneInRound: 4 }, S)).toEqual({ phase: "focus", doneInRound: 0 });
  });

  it("skipping moves the schedule on, never starts the clock and never counts as finished", () => {
    const skipped = skip(start(initialState(S), T0), S, T0 + MIN);
    expect(skipped).toMatchObject({ phase: "short", running: false, endsAt: null, remainingMs: 5 * MIN, doneInRound: 1 });
  });

  it("reset goes back to the start of a fresh round", () => {
    expect(reset(S)).toEqual(initialState(S));
  });
});

describe("changing the settings", () => {
  it("never touches a running timer", () => {
    const running = start(initialState(S), T0);
    expect(applySettings(running, S, { ...S, focusMin: 50 })).toBe(running);
  });

  it("an unstarted phase follows the new length", () => {
    const next = applySettings(initialState(S), S, { ...S, focusMin: 50 });
    expect(next.remainingMs).toBe(50 * MIN);
  });

  it("a phase paused part-way keeps what is left, but never more than the new length", () => {
    const paused = pause(start(initialState(S), T0), T0 + 10 * MIN);        // 15 min left
    expect(applySettings(paused, S, { ...S, focusMin: 50 }).remainingMs).toBe(15 * MIN);
    expect(applySettings(paused, S, { ...S, focusMin: 10 }).remainingMs).toBe(10 * MIN);
  });
});

describe("restoring after a reload", () => {
  it("a missing or damaged saved state gives a fresh timer", () => {
    for (const bad of [null, undefined, "x", 5, {}, { phase: "nap" }]) expect(restore(bad, S, T0)).toEqual(initialState(S));
  });

  it("a timer still running continues to the same end time", () => {
    const saved = start(initialState(S), T0);
    expect(restore(saved, S, T0 + 5 * MIN)).toMatchObject({ phase: "focus", running: true, endsAt: T0 + 25 * MIN });
  });

  it("an end time too far ahead (tampered or from other settings) is cut to the phase length", () => {
    const restored = restore({ phase: "focus", running: true, endsAt: T0 + 9999 * MIN, doneInRound: 0 }, S, T0);
    expect(restored.endsAt).toBe(T0 + 25 * MIN);
  });

  it("a focus block that ran out while the page was closed is not counted: it moves on, paused", () => {
    const saved = start(initialState(S), T0);
    const restored = restore(saved, S, T0 + 40 * MIN);
    expect(restored).toMatchObject({ phase: "short", running: false, doneInRound: 1 });
  });

  it("a paused timer keeps what was left", () => {
    const paused = pause(start(initialState(S), T0), T0 + 10 * MIN);
    expect(restore(paused, S, T0 + 999 * MIN)).toMatchObject({ running: false, remainingMs: 15 * MIN });
    expect(restore({ ...paused, remainingMs: 99999 * MIN }, S, T0).remainingMs).toBe(25 * MIN);   // never more than a full phase
  });
});

describe("display helpers", () => {
  it("formats a countdown as mm:ss, rounding up so it never shows 00:00 early", () => {
    expect(formatCountdown(25 * MIN)).toBe("25:00");
    expect(formatCountdown(61_000)).toBe("01:01");
    expect(formatCountdown(1)).toBe("00:01");
    expect(formatCountdown(0)).toBe("00:00");
    expect(formatCountdown(-500)).toBe("00:00");
    expect(formatCountdown(125 * MIN)).toBe("125:00");
  });

  it("progress goes from 0 to 1 over the phase", () => {
    const running = start(initialState(S), T0);
    expect(progress(running, S, T0)).toBe(0);
    expect(progress(running, S, T0 + 5 * MIN + 12_500)).toBeCloseTo(0.2083, 3);
    expect(progress(running, S, T0 + 999 * MIN)).toBe(1);
    expect(progress(initialState(S), S, T0)).toBe(0);
  });

  it("phase lengths come from the settings", () => {
    expect([phaseMs("focus", S), phaseMs("short", S), phaseMs("long", S)]).toEqual([25 * MIN, 5 * MIN, 15 * MIN]);
  });
});
