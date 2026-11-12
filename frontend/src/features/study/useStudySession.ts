"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "../../lib/api";
import type { StudySummary } from "../../lib/types";
import { useAuth } from "../auth/AuthProvider";
import { isStudying, trackPageActivity } from "./activity";
import { httpStudyApi } from "./api";
import { StudyTracker } from "./tracker";

/**
 * Tracks study time while a video page is open. `playing` says whether the video is playing;
 * typing, scrolling and clicking also count as studying (see activity.ts).
 */
export interface StudyControl {
  /** The person paused tracking (for example to take a call). Nothing is credited meanwhile. */
  paused: boolean;
  /** A Pomodoro break is running: break time is not study time. */
  onBreak: boolean;
}

export function useStudySession(videoId: string | null, playing: boolean, enabled: boolean, control: StudyControl = { paused: false, onBreak: false }) {
  const { ready, signedIn } = useAuth();
  const [summary, setSummary] = useState<StudySummary | null>(null);
  const [sessionSeconds, setSessionSeconds] = useState(0);
  const playingRef = useRef(playing);
  const controlRef = useRef(control);
  const trackerRef = useRef<StudyTracker | null>(null);

  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);
  useEffect(() => {
    controlRef.current = control;
  }, [control]);

  useEffect(() => {
    if (!enabled || !ready || !signedIn) return;
    let cancelled = false;

    // Show today's numbers straight away; the first heartbeat comes 20 seconds later.
    apiFetch("/api/study/overview?days=1")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data) setSummary((prev) => prev ?? data);
      })
      .catch(() => undefined);

    const stopListening = trackPageActivity();
    const tracker = new StudyTracker({
      api: httpStudyApi,
      getActive: () =>
        !controlRef.current.paused && !controlRef.current.onBreak && isStudying(playingRef.current, document.visibilityState === "visible"),
      onSummary: setSummary,
      onSessionSeconds: setSessionSeconds,
    });
    trackerRef.current = tracker;
    void tracker.start(videoId).catch(() => undefined);

    const onPageHide = () => void tracker.stop();
    window.addEventListener("pagehide", onPageHide);
    return () => {
      cancelled = true;
      window.removeEventListener("pagehide", onPageHide);
      stopListening();
      trackerRef.current = null;
      void tracker.stop();
    };
  }, [videoId, enabled, ready, signedIn]);

  const getSessionId = useCallback(() => trackerRef.current?.getSessionId() ?? null, []);
  const resetSession = useCallback(() => trackerRef.current?.resetSeconds(), []);
  /** Send the numbers now (for example after pausing), instead of waiting for the next beat. */
  const flush = useCallback(() => trackerRef.current?.flush(videoId) ?? Promise.resolve(), [videoId]);

  return { summary, sessionSeconds, getSessionId, resetSession, flush };
}
