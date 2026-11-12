"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink, Maximize, Pause, Play, RotateCcw, RotateCw, Volume2, VolumeX } from "lucide-react";
import {
  formatClock, loadYouTubeApi, PLAYBACK_RATES, PlayerController, type PlayerSnapshot,
} from "./youtube";

interface Props {
  videoId: string;
  title?: string | null;
  /** Start here (seconds), for resuming. */
  startSeconds?: number;
  /** Called about twice a second with the current state. */
  onUpdate?: (snapshot: PlayerSnapshot) => void;
  className?: string;
}

const EMPTY: PlayerSnapshot = { playing: false, ended: false, position: 0, duration: 0, muted: false, rate: 1, ready: false };
// YouTube error codes for "this video cannot be embedded".
const NOT_EMBEDDABLE = new Set([101, 150]);

/**
 * The official YouTube player with our own control bar (YouTube's controls and title
 * overlay are switched off), styled to match the app.
 */
export function YouTubePlayer(props: Props) {
  // A different video gets a brand new player. Without this, the error screen of the previous video
  // could remain on screen, with no place for the new player to attach.
  return <PlayerInner key={props.videoId} {...props} />;
}

function PlayerInner({ videoId, title, startSeconds = 0, onUpdate, className = "" }: Props) {
  const mount = useRef<HTMLDivElement>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  const controller = useRef<PlayerController | null>(null);
  const onUpdateRef = useRef(onUpdate);
  const [state, setState] = useState<PlayerSnapshot>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [seeking, setSeeking] = useState<number | null>(null);

  useEffect(() => {
    onUpdateRef.current = onUpdate;
  }, [onUpdate]);

  useEffect(() => {
    let cancelled = false;
    const host = document.createElement("div");
    host.style.width = "100%";
    host.style.height = "100%";
    mount.current?.appendChild(host);

    loadYouTubeApi()
      .then((yt) => {
        if (cancelled) return;
        controller.current = new PlayerController(yt, host, { videoId, startSeconds, origin: window.location.origin }, {
          onUpdate: (snapshot) => {
            setState(snapshot);
            onUpdateRef.current?.(snapshot);
          },
          onError: (code) =>
            setError(NOT_EMBEDDABLE.has(code) ? "The owner of this video does not allow it to be played here." : "This video could not be played."),
        });
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : "The player could not be loaded."));

    return () => {
      cancelled = true;
      controller.current?.destroy();
      controller.current = null;
      host.remove();
    };
    // The start position only matters when the video changes; later saves must not restart the player.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId]);

  const toggleFullscreen = useCallback(() => {
    const el = wrapper.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen?.();
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const c = controller.current;
    if (!c) return;
    if (e.key === " " || e.key === "k") { e.preventDefault(); c.toggle(); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); c.skip(-5); }
    else if (e.key === "ArrowRight") { e.preventDefault(); c.skip(5); }
    else if (e.key === "m") c.setMuted(!state.muted);
    else if (e.key === "f") toggleFullscreen();
  };

  if (error) {
    return (
      <div role="alert" className={`flex flex-col items-center justify-center gap-3 rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-8 text-center text-sm ${className}`} style={{ aspectRatio: "16 / 9" }}>
        <p>{error}</p>
        <a href={`https://www.youtube.com/watch?v=${videoId}`} target="_blank" rel="noopener noreferrer"
           className="inline-flex items-center gap-1.5 rounded-full bg-[var(--brand-lime)] px-4 py-2 font-bold text-[#0E0F0C]">
          <ExternalLink className="h-4 w-4" /> Watch on YouTube
        </a>
      </div>
    );
  }

  const position = seeking ?? state.position;
  const duration = state.duration || 0;
  const barButton = "rounded-lg p-1.5 text-white/90 hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-lime)] cursor-pointer";

  return (
    <div
      ref={wrapper}
      role="group"
      aria-label={title ? `Video player: ${title}` : "Video player"}
      tabIndex={0}
      onKeyDown={onKeyDown}
      className={`group relative w-full overflow-hidden rounded-2xl border border-[var(--card-border)] bg-black shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-lime)] ${className}`}
      style={{ aspectRatio: "16 / 9" }}
    >
      {/* The YouTube video. Clicks are caught by the overlay below, so YouTube's own menus never appear. */}
      <div ref={mount} className="absolute inset-0 [&_iframe]:h-full [&_iframe]:w-full" />
      <button
        type="button"
        aria-label={state.playing ? "Pause" : "Play"}
        onClick={() => controller.current?.toggle()}
        className="absolute inset-0 flex cursor-pointer items-center justify-center bg-transparent"
        tabIndex={-1}
      >
        {!state.playing && state.ready && (
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-[var(--brand-lime)] text-[#0E0F0C] shadow-lg">
            <Play className="ml-1 h-7 w-7 fill-current" />
          </span>
        )}
        {!state.ready && <span className="text-sm text-white/70" role="status">Loading player…</span>}
      </button>

      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent px-3 pb-2 pt-8">
        <input
          type="range"
          aria-label="Seek"
          min={0}
          max={Math.max(1, Math.floor(duration))}
          step={1}
          value={Math.min(Math.floor(position), Math.max(1, Math.floor(duration)))}
          disabled={!state.ready || duration === 0}
          onChange={(e) => setSeeking(Number(e.target.value))}
          onPointerUp={() => {
            if (seeking !== null) controller.current?.seek(seeking);
            setSeeking(null);
          }}
          onKeyUp={() => {
            if (seeking !== null) controller.current?.seek(seeking);
            setSeeking(null);
          }}
          className="h-1.5 w-full cursor-pointer accent-[var(--brand-lime)]"
        />
        <div className="mt-1 flex items-center gap-1 text-white">
          <button type="button" className={barButton} aria-label={state.playing ? "Pause" : "Play"} onClick={() => controller.current?.toggle()}>
            {state.playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
          </button>
          <button type="button" className={barButton} aria-label="Back 10 seconds" onClick={() => controller.current?.skip(-10)}>
            <RotateCcw className="h-4 w-4" />
          </button>
          <button type="button" className={barButton} aria-label="Forward 10 seconds" onClick={() => controller.current?.skip(10)}>
            <RotateCw className="h-4 w-4" />
          </button>
          <span className="ml-1 text-xs tabular-nums" aria-live="off">
            {formatClock(position)} / {formatClock(duration)}
          </span>
          <span className="flex-1" />
          <label className="sr-only" htmlFor={`rate-${videoId}`}>Playback speed</label>
          <select
            id={`rate-${videoId}`}
            value={state.rate}
            onChange={(e) => controller.current?.setRate(Number(e.target.value))}
            className="cursor-pointer rounded-md bg-white/15 px-1.5 py-1 text-xs text-white"
          >
            {PLAYBACK_RATES.map((r) => (
              <option key={r} value={r} className="text-black">{r}x</option>
            ))}
          </select>
          <button type="button" className={barButton} aria-label={state.muted ? "Unmute" : "Mute"} onClick={() => controller.current?.setMuted(!state.muted)}>
            {state.muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </button>
          <button type="button" className={barButton} aria-label="Full screen" onClick={toggleFullscreen}>
            <Maximize className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
