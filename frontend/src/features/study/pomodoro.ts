/**
 * The Pomodoro timer as a plain state machine.
 *
 * Time is kept as an end timestamp (not a counter), so the timer stays right when the browser slows a
 * background tab, the laptop sleeps, or the page is reloaded. Everything here is a pure function.
 */

export type Phase = "focus" | "short" | "long";

export interface PomodoroSettings {
  /** Minutes. */
  focusMin: number;
  shortMin: number;
  longMin: number;
  /** Focus blocks before a long break. */
  cycles: number;
  autoStartBreaks: boolean;
  autoStartFocus: boolean;
  sound: boolean;
  notify: boolean;
}

export interface PomodoroPreset {
  id: string;
  name: string;
  hint: string;
  focusMin: number;
  shortMin: number;
  longMin: number;
  cycles: number;
}

export const PRESETS: PomodoroPreset[] = [
  { id: "classic", name: "Classic", hint: "25 / 5, long break 15", focusMin: 25, shortMin: 5, longMin: 15, cycles: 4 },
  { id: "deep", name: "Deep work", hint: "50 / 10, long break 30", focusMin: 50, shortMin: 10, longMin: 30, cycles: 3 },
  { id: "quick", name: "Quick", hint: "15 / 3, long break 10", focusMin: 15, shortMin: 3, longMin: 10, cycles: 4 },
];

export const LIMITS = {
  focusMin: { min: 5, max: 180 },
  shortMin: { min: 1, max: 30 },
  longMin: { min: 5, max: 60 },
  cycles: { min: 2, max: 8 },
} as const;

export const DEFAULT_SETTINGS: PomodoroSettings = {
  focusMin: 25, shortMin: 5, longMin: 15, cycles: 4,
  autoStartBreaks: true, autoStartFocus: false, sound: true, notify: true,
};

const clamp = (value: unknown, min: number, max: number, fallback: number): number => {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
};

/** Anything (for example a damaged saved value) becomes valid settings. */
export function sanitizeSettings(raw: unknown): PomodoroSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const flag = (key: keyof PomodoroSettings) => (typeof r[key] === "boolean" ? (r[key] as boolean) : (DEFAULT_SETTINGS[key] as boolean));
  return {
    focusMin: clamp(r.focusMin, LIMITS.focusMin.min, LIMITS.focusMin.max, DEFAULT_SETTINGS.focusMin),
    shortMin: clamp(r.shortMin, LIMITS.shortMin.min, LIMITS.shortMin.max, DEFAULT_SETTINGS.shortMin),
    longMin: clamp(r.longMin, LIMITS.longMin.min, LIMITS.longMin.max, DEFAULT_SETTINGS.longMin),
    cycles: clamp(r.cycles, LIMITS.cycles.min, LIMITS.cycles.max, DEFAULT_SETTINGS.cycles),
    autoStartBreaks: flag("autoStartBreaks"),
    autoStartFocus: flag("autoStartFocus"),
    sound: flag("sound"),
    notify: flag("notify"),
  };
}

/** The preset these settings match exactly, or null for custom settings. */
export function matchingPreset(s: PomodoroSettings): PomodoroPreset | null {
  return PRESETS.find((p) => p.focusMin === s.focusMin && p.shortMin === s.shortMin && p.longMin === s.longMin && p.cycles === s.cycles) ?? null;
}

export interface PomodoroState {
  phase: Phase;
  running: boolean;
  /** When the running phase ends (ms since 1970). Null while paused. */
  endsAt: number | null;
  /** What is left of the phase while paused. */
  remainingMs: number;
  /** Focus blocks finished in the current round (resets after a long break). */
  doneInRound: number;
}

export const phaseMs = (phase: Phase, s: PomodoroSettings): number =>
  (phase === "focus" ? s.focusMin : phase === "short" ? s.shortMin : s.longMin) * 60_000;

export function initialState(s: PomodoroSettings): PomodoroState {
  return { phase: "focus", running: false, endsAt: null, remainingMs: phaseMs("focus", s), doneInRound: 0 };
}

export function remainingMs(state: PomodoroState, now: number): number {
  return state.running && state.endsAt !== null ? Math.max(0, state.endsAt - now) : state.remainingMs;
}

export function start(state: PomodoroState, now: number): PomodoroState {
  if (state.running) return state;
  return { ...state, running: true, endsAt: now + Math.max(1000, state.remainingMs) };
}

export function pause(state: PomodoroState, now: number): PomodoroState {
  if (!state.running) return state;
  return { ...state, running: false, endsAt: null, remainingMs: remainingMs(state, now) };
}

/** The phase that follows `state.phase` (a long break after every `cycles`-th focus block). */
export function nextPhase(state: PomodoroState, s: PomodoroSettings): { phase: Phase; doneInRound: number } {
  if (state.phase === "focus") {
    const done = state.doneInRound + 1;
    return done >= s.cycles ? { phase: "long", doneInRound: done } : { phase: "short", doneInRound: done };
  }
  // after a break: a new focus block (a long break closes the round)
  return { phase: "focus", doneInRound: state.phase === "long" ? 0 : state.doneInRound };
}

function enter(phase: Phase, doneInRound: number, s: PomodoroSettings, now: number, running: boolean): PomodoroState {
  const ms = phaseMs(phase, s);
  return { phase, doneInRound, running, endsAt: running ? now + ms : null, remainingMs: ms };
}

export interface TickResult {
  state: PomodoroState;
  /** Set when a phase ran out on this tick. A finished focus block is what counts as a pomodoro. */
  finished: Phase | null;
}

/** Advance the clock. When the phase has run out, move on (starting the next one if the settings say so). */
export function tick(state: PomodoroState, s: PomodoroSettings, now: number): TickResult {
  if (!state.running || state.endsAt === null || now < state.endsAt) return { state, finished: null };
  const finished = state.phase;
  const next = nextPhase(state, s);
  const auto = next.phase === "focus" ? s.autoStartFocus : s.autoStartBreaks;
  // Only one phase per tick: after a long sleep the timer does not run through several phases in a row.
  return { state: enter(next.phase, next.doneInRound, s, now, auto), finished };
}

/** Skip to the next phase now. The schedule moves on, but skipping never counts as a finished block. */
export function skip(state: PomodoroState, s: PomodoroSettings, now: number): PomodoroState {
  const next = nextPhase(state, s);
  return enter(next.phase, next.doneInRound, s, now, false);
}

export function reset(s: PomodoroSettings): PomodoroState {
  return initialState(s);
}

/**
 * New settings while the timer is idle: a phase that had not been started follows the new length, and one that
 * was paused part-way keeps what is left (but never more than the new length). A running timer is never changed.
 */
export function applySettings(state: PomodoroState, before: PomodoroSettings, after: PomodoroSettings): PomodoroState {
  if (state.running) return state;
  const untouched = state.remainingMs === phaseMs(state.phase, before);
  const full = phaseMs(state.phase, after);
  return { ...state, remainingMs: untouched ? full : Math.min(state.remainingMs, full) };
}

/** A saved state after a reload: a timer that ran out while the page was closed is not counted; it moves on, paused. */
export function restore(saved: unknown, s: PomodoroSettings, now: number): PomodoroState {
  const fresh = initialState(s);
  if (!saved || typeof saved !== "object") return fresh;
  const r = saved as Record<string, unknown>;
  const phase = r.phase === "focus" || r.phase === "short" || r.phase === "long" ? r.phase : null;
  if (!phase) return fresh;
  const done = clamp(r.doneInRound, 0, s.cycles, 0);
  const full = phaseMs(phase, s);
  if (r.running === true && typeof r.endsAt === "number") {
    if (r.endsAt > now) return { phase, running: true, endsAt: Math.min(r.endsAt, now + full), remainingMs: full, doneInRound: done };
    const next = nextPhase({ phase, running: false, endsAt: null, remainingMs: 0, doneInRound: done }, s);
    return enter(next.phase, next.doneInRound, s, now, false);
  }
  const rem = typeof r.remainingMs === "number" && Number.isFinite(r.remainingMs) ? Math.min(full, Math.max(1000, r.remainingMs)) : full;
  return { phase, running: false, endsAt: null, remainingMs: rem, doneInRound: done };
}

export const PHASE_LABEL: Record<Phase, string> = { focus: "Focus", short: "Short break", long: "Long break" };

export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const sec = total % 60;
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

/** 0 to 1: how much of the phase has passed (for the ring). */
export function progress(state: PomodoroState, s: PomodoroSettings, now: number): number {
  const full = phaseMs(state.phase, s);
  return full > 0 ? Math.min(1, Math.max(0, 1 - remainingMs(state, now) / full)) : 0;
}
