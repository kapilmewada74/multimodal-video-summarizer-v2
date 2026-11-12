"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ensureNotificationPermission, playChime, showNotification } from "./alerts";
import {
  PHASE_LABEL, applySettings, initialState, pause, progress, remainingMs, reset, skip, start, tick,
  type Phase, type PomodoroSettings, type PomodoroState,
} from "./pomodoro";
import { loadSettings, loadState, saveSettings, saveState } from "./pomodoroStorage";

interface Options {
  /** A focus block ran its full length. */
  onFocusComplete?: () => void;
  /** A break ended or a block was skipped, and so on: the phase now showing. */
  onPhaseChange?: (phase: Phase, running: boolean) => void;
}

const MESSAGES: Record<Phase, { title: string; body: string }> = {
  focus: { title: "Focus time is over", body: "Nice work. Take a short break." },
  short: { title: "Break is over", body: "Ready for the next focus block?" },
  long: { title: "Long break is over", body: "Ready to start a new round?" },
};

/** The Pomodoro timer for a page: settings and progress are kept in this browser and survive a reload. */
export function usePomodoro({ onFocusComplete, onPhaseChange }: Options = {}) {
  const [settings, setSettingsState] = useState<PomodoroSettings>(() => loadSettings());
  const [state, setState] = useState<PomodoroState>(() => loadState(loadSettings()));
  const [now, setNow] = useState(() => Date.now());
  const settingsRef = useRef(settings);
  const stateRef = useRef(state);
  const callbacks = useRef({ onFocusComplete, onPhaseChange });
  callbacks.current = { onFocusComplete, onPhaseChange };
  settingsRef.current = settings;
  stateRef.current = state;

  // Persist.
  useEffect(() => saveState(state), [state]);

  // The clock: twice a second while running (the end time, not the ticks, decides when the phase is over).
  useEffect(() => {
    if (!state.running) return;
    const timer = setInterval(() => {
      const t = Date.now();
      setNow(t);
      const result = tick(stateRef.current, settingsRef.current, t);
      if (result.finished) {
        stateRef.current = result.state;
        setState(result.state);
        const s = settingsRef.current;
        if (s.sound) playChime();
        if (s.notify) showNotification(MESSAGES[result.finished].title, MESSAGES[result.finished].body);
        if (result.finished === "focus") callbacks.current.onFocusComplete?.();
        callbacks.current.onPhaseChange?.(result.state.phase, result.state.running);
      }
    }, 500);
    return () => clearInterval(timer);
  }, [state.running]);

  // The tab title shows the countdown, so it can be watched from another tab.
  const remaining = remainingMs(state, now);
  useEffect(() => {
    const original = document.title.replace(/^\(\d\d:\d\d [^)]*\) /, "");
    if (state.running) {
      const m = Math.floor(Math.ceil(remaining / 1000) / 60);
      const sec = Math.ceil(remaining / 1000) % 60;
      document.title = `(${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")} ${PHASE_LABEL[state.phase]}) ${original}`;
    } else document.title = original;
    return () => {
      document.title = original;
    };
  }, [state.running, state.phase, remaining]);

  const update = useCallback((next: PomodoroState) => {
    stateRef.current = next;
    setState(next);
    setNow(Date.now());
    callbacks.current.onPhaseChange?.(next.phase, next.running);
  }, []);

  const toggle = useCallback(() => {
    const t = Date.now();
    const current = stateRef.current;
    if (current.running) return update(pause(current, t));
    if (settingsRef.current.notify) void ensureNotificationPermission();
    if (settingsRef.current.sound) playChime(); // wakes the audio system now (it needs a click), so the end-of-block chime is allowed
    update(start(current, t));
  }, [update]);

  const doSkip = useCallback(() => update(skip(stateRef.current, settingsRef.current, Date.now())), [update]);
  const doReset = useCallback(() => update(reset(settingsRef.current)), [update]);

  const changeSettings = useCallback((next: PomodoroSettings) => {
    const before = settingsRef.current;
    settingsRef.current = next;
    setSettingsState(next);
    saveSettings(next);
    const adjusted = applySettings(stateRef.current, before, next);
    if (adjusted !== stateRef.current) {
      stateRef.current = adjusted;
      setState(adjusted);
    }
  }, []);

  return {
    settings, state, remaining, phase: state.phase, running: state.running,
    progress: progress(state, settings, now),
    toggle, skip: doSkip, reset: doReset, changeSettings,
    idle: !state.running && state.remainingMs === initialState(settings).remainingMs && state.phase === "focus" && state.doneInRound === 0,
  };
}
