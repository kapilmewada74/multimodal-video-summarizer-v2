"use client";

import React, { useRef, useState } from "react";
import { Columns2, FileText, MonitorPlay, Pin, PinOff, RotateCcw } from "lucide-react";
import { ResizableSplit } from "./ResizableSplit";
import { useElementSize, useSavedLayout } from "./hooks";
import { PHONE_MAX_WIDTH, PhoneModeContext } from "./phone";
import { isDefaultLayout, resolveOrientation, type Collapsed } from "./split";

interface Props {
  video: React.ReactNode;
  panel: React.ReactNode;
  storageKey?: string;
}

const tool = "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold cursor-pointer active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-lime)] disabled:opacity-40 disabled:cursor-not-allowed";
const idle = "border-[var(--card-border)] bg-[var(--btn-secondary-bg)] text-[var(--text-main)] hover:bg-[var(--btn-secondary-hover)]";
const active = "border-transparent bg-[var(--brand-lime)] text-[#0E0F0C]";

const segment =
  "inline-flex h-9 items-center gap-2 rounded-xl px-3.5 text-sm font-bold cursor-pointer transition-all active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-lime)]";
const segmentOn = "bg-[var(--brand-lime)] text-[#0E0F0C] shadow-sm";
const segmentOff = "text-[var(--text-muted)] hover:bg-[var(--card-bg)] hover:text-[var(--text-main)]";

/** `id` is the pane that is hidden in that view ("second" = notes hidden, so the video fills the space). */
const VIEWS: Array<{ id: Collapsed; label: string; hint: string; Icon: typeof Columns2 }> = [
  { id: null, label: "Split", hint: "Video and notes side by side", Icon: Columns2 },
  { id: "second", label: "Video", hint: "Let the video fill the space", Icon: MonitorPlay },
  { id: "first", label: "Notes", hint: "Let the notes fill the space", Icon: FileText },
];

/**
 * The video and the study panel side by side (wide screens) or stacked (tablets and phones),
 * with a draggable divider, independent scrolling, a Split / Video / Notes switch and a reset button.
 */
export function WorkspaceLayout({ video, panel, storageKey = "workspace-layout-v1" }: Props) {
  const { layout, setLayout, reset } = useSavedLayout(storageKey);
  const wrap = useRef<HTMLDivElement>(null);
  const measured = useElementSize(wrap).width;
  // Until the box has been measured (first paint, or a hidden tab) the window width is the best guess.
  const width = measured || (typeof window !== "undefined" ? window.innerWidth : 1280);
  // Wide screens put the video and notes side by side; narrow ones stack them by themselves.
  const orientation = resolveOrientation("auto", width);
  const phone = width < PHONE_MAX_WIDTH;
  const [pinned, setPinned] = useState(true);

  if (phone) {
    // Phones: one scrolling page. The video stays pinned under the navigation bar while you read.
    return (
      <PhoneModeContext.Provider value={{ phone: true, pinned }}>
        <div ref={wrap} className="w-full" data-testid="phone-workspace">
          <div className="mb-2 flex justify-end no-print">
            <button
              type="button"
              aria-pressed={pinned}
              onClick={() => setPinned((v) => !v)}
              className={`${tool} ${pinned ? active : idle}`}
              title={pinned ? "Let the video scroll away" : "Keep the video in view while you read"}
            >
              {pinned ? <Pin className="h-3.5 w-3.5" /> : <PinOff className="h-3.5 w-3.5" />}
              {pinned ? "Video pinned" : "Pin video"}
            </button>
          </div>
          {video}
          <div className="mt-3">{panel}</div>
        </div>
      </PhoneModeContext.Provider>
    );
  }

  return (
    <div ref={wrap} className="w-full">
      <div className="mb-3 flex items-center justify-between gap-3 no-print">
        <div role="group" aria-label="Workspace view" className="inline-flex items-center gap-1 rounded-2xl border border-[var(--card-border)] bg-[var(--btn-secondary-bg)] p-1">
          {VIEWS.map(({ id, label, hint, Icon }) => {
            const on = layout.collapsed === id;
            return (
              <button
                key={label}
                type="button"
                aria-pressed={on}
                title={hint}
                onClick={() => setLayout({ collapsed: id })}
                className={`${segment} ${on ? segmentOn : segmentOff}`}
              >
                <Icon className="h-4 w-4" />
                <span className="hidden sm:inline">{label}</span>
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={reset}
          disabled={isDefaultLayout(layout)}
          title="Back to the default layout"
          aria-label="Reset layout"
          className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-transparent px-3 text-xs font-bold text-[var(--text-muted)] transition-colors hover:border-[var(--card-border)] hover:bg-[var(--btn-secondary-bg)] hover:text-[var(--text-main)] disabled:pointer-events-none disabled:opacity-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-lime)] cursor-pointer"
        >
          <RotateCcw className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Reset</span>
        </button>
      </div>

      <div className="w-full" style={{ height: "clamp(520px, calc(100dvh - 10.5rem), 1500px)" }}>
        <ResizableSplit
          orientation={orientation}
          fraction={layout.fraction}
          onFractionChange={(fraction) => setLayout({ fraction })}
          onReset={reset}
          collapsed={layout.collapsed}
          first={video}
          second={panel}
          firstLabel="Video"
          secondLabel="Study notes"
        />
      </div>
    </div>
  );
}
