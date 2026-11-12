import { DEFAULT_SETTINGS, initialState, restore, sanitizeSettings, type PomodoroSettings, type PomodoroState } from "./pomodoro";

const SETTINGS_KEY = "pomodoro-settings-v1";
const STATE_KEY = "pomodoro-state-v1";

/** Saved in this browser only. Storage can be missing or blocked, so every call is guarded. */
export function loadSettings(): PomodoroSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? sanitizeSettings(JSON.parse(raw)) : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: PomodoroSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* the timer still works, it just forgets the choice */
  }
}

export function loadState(settings: PomodoroSettings, now: number = Date.now()): PomodoroState {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    return raw ? restore(JSON.parse(raw), settings, now) : initialState(settings);
  } catch {
    return initialState(settings);
  }
}

export function saveState(state: PomodoroState): void {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}
