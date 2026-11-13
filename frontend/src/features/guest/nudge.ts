/**
 * When to ask a guest to sign in. New visitors often close a pop-up just to get it out of the way, so the first
 * dismissal does not count against us: it comes back on the next visit (even the same day). Once it has been
 * dismissed twice, it waits a week between appearances. It never appears again on the page where it was closed.
 * Pure functions, so they are easy to test; the browser storage part is a thin wrapper.
 */
export const NUDGE_KEY = "signin-nudge-v1";
export const DAY_MS = 24 * 60 * 60 * 1000;
/** Dismissals that are forgiven: the card returns on the next visit. After this many, it waits a week. */
export const FREE_DISMISSALS = 1;
export const WEEK_MS = 7 * DAY_MS;

export interface NudgeState {
  dismissals: number;
  lastDismissedAt: number;
}

export const EMPTY_NUDGE: NudgeState = { dismissals: 0, lastDismissedAt: 0 };

export function canShowNudge(state: NudgeState, now: number): boolean {
  if (state.dismissals <= FREE_DISMISSALS) return true;
  return now - state.lastDismissedAt >= WEEK_MS;
}

export function recordDismissal(state: NudgeState, now: number): NudgeState {
  return { dismissals: state.dismissals + 1, lastDismissedAt: now };
}

export function loadNudgeState(): NudgeState {
  try {
    const raw = JSON.parse(localStorage.getItem(NUDGE_KEY) ?? "null");
    if (raw && Number.isFinite(raw.dismissals) && Number.isFinite(raw.lastDismissedAt)) {
      return { dismissals: raw.dismissals, lastDismissedAt: raw.lastDismissedAt };
    }
  } catch {
    /* no storage or damaged value: treat as never dismissed */
  }
  return EMPTY_NUDGE;
}

export function saveNudgeState(state: NudgeState): void {
  try {
    localStorage.setItem(NUDGE_KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

/**
 * "Once per visit": the reminder is shown at most once in a browser session (until the tab is closed), and never again
 * after it was dismissed, on ANY page. Each page mounts its own copy of the reminder, so the memory has to live outside
 * the component. sessionStorage survives moving between pages; the plain variable covers browsers that block storage.
 */
export const SESSION_KEY = "signin-nudge-session-v1";
let handledInMemory = false;

export function handledThisSession(): boolean {
  if (handledInMemory) return true;
  try {
    return sessionStorage.getItem(SESSION_KEY) === "1";
  } catch {
    return false;
  }
}

export function markHandledThisSession(): void {
  handledInMemory = true;
  try {
    sessionStorage.setItem(SESSION_KEY, "1");
  } catch {
    /* ignore */
  }
}

/** Forgets the in-memory flag (tests only). */
export function resetNudgeSessionForTests(): void {
  handledInMemory = false;
}

/** Someone closed any sign-in card: do not nag again this visit, and wait a day (a week after a few times) next visit. */
export function noteDismissed(now = Date.now()): void {
  markHandledThisSession();
  saveNudgeState(recordDismissal(loadNudgeState(), now));
}
