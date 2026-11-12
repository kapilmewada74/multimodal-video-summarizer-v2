"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { recordPomodoro } from "./api";
import { usePomodoro } from "./usePomodoro";
import { useStudySession } from "./useStudySession";
import { playChime } from "./alerts";

type Toast = (message: string, type?: "success" | "info" | "error") => void;

/**
 * Everything around one study visit: the tracked session, pausing it, the Pomodoro timer
 * and an optional goal for this session. One place, so the timer, the tracker and the panel agree.
 */
export function useStudyTools(videoId: string | null, playing: boolean, enabled: boolean, onToast: Toast) {
  const [paused, setPaused] = useState(false);
  const [goalMin, setGoalMin] = useState<number | null>(null);
  const goalHit = useRef(false);
  const sessionId = useRef<() => string | null>(() => null);
  const [pomodorosThisVisit, setPomodorosThisVisit] = useState(0);

  const pomodoro = usePomodoro({
    onFocusComplete: () => {
      const id = sessionId.current();
      setPomodorosThisVisit((n) => n + 1);
      if (id) void recordPomodoro(id);
    },
  });
  const onBreak = pomodoro.running && pomodoro.phase !== "focus";

  const session = useStudySession(videoId, playing, enabled, { paused, onBreak });
  sessionId.current = session.getSessionId;

  const togglePaused = useCallback(() => {
    setPaused((p) => {
      if (!p) void session.flush(); // send what was studied before the pause
      return !p;
    });
  }, [session]);

  const setGoal = useCallback((minutes: number | null) => {
    goalHit.current = false;
    setGoalMin(minutes);
  }, []);

  // Reaching the session goal: say so once.
  useEffect(() => {
    if (goalMin === null || goalHit.current) return;
    if (session.sessionSeconds >= goalMin * 60) {
      goalHit.current = true;
      onToast(`Session goal reached: ${goalMin} minutes of study.`, "success");
      playChime();
    }
  }, [goalMin, session.sessionSeconds, onToast]);

  const resetSession = useCallback(() => {
    session.resetSession();
    goalHit.current = false;
    setPomodorosThisVisit(0);
  }, [session]);

  return {
    summary: session.summary,
    sessionSeconds: session.sessionSeconds,
    paused, togglePaused,
    goalMin, setGoal,
    resetSession,
    pomodoro, onBreak, pomodorosThisVisit,
  };
}

export type StudyTools = ReturnType<typeof useStudyTools>;
