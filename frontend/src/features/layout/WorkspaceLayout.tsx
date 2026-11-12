"use client";

import React, { useRef, useState } from "react";
import { Columns2, Maximize2, Minimize2, Pin, PinOff, RotateCcw, Rows2 } from "lucide-react";
import { ResizableSplit } from "./ResizableSplit";
import { useElementSize, useSavedLayout } from "./hooks";
import { PHONE_MAX_WIDTH, PhoneModeContext } from "./phone";
import { isDefaultLayout, resolveOrientation } from "./split";

interface Props {
  video: React.ReactNode;
  panel: React.ReactNode;
  storageKey?: string;
}

const tool = "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold cursor-pointer active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-lime)] disabled:opacity-40 disabled:cursor-not-allowed";
const idle = "border-[var(--card-border)] bg-[var(--btn-secondary-bg)] text-[var(--text-main)] hover:bg-[var(--btn-secondary-hover)]";
const active = "border-transparent bg-[var(--brand-lime)] text-[#0E0F0C]";

/**
 * The video and the study panel side by side (wide screens) or stacked (tablets and phones),
 * with a draggable divider, independent scrolling, collapse and a reset button.
 */
export function WorkspaceLayout({ video, panel, storageKey = "workspace-layout-v1" }: Props) {
  const { layout, setLayout, reset } = useSavedLayout(storageKey);
  const wrap = useRef<HTMLDivElement>(null);
  const measured = useElementSize(wrap).width;
  // Until the box has been measured (first paint, or a hidden tab) the window width is the best guess.
  const width = measured || (typeof window !== "undefined" ? window.innerWidth : 1280);
  const orientation = resolveOrientation(layout.orientation, width);
  const canChooseOrientation = width >= 1024;
  const phone = width < PHONE_MAX_WIDTH;
  const [pinned, setPinned] = useState(true);

  const toggleCollapse = (pane: "first" | "second") => setLayout({ collapsed: layout.collapsed === pane ? null : pane });

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
      <div className="mb-3 flex flex-wrap items-center gap-2 no-print" role="toolbar" aria-label="Workspace layout">
        <button
          type="button"
          className={`${tool} ${orientation === "row" ? active : idle}`}
          aria-pressed={orientation === "row"}
          disabled={!canChooseOrientation}
          title={canChooseOrientation ? "Video and notes side by side" : "Side by side needs a wider screen"}
          onClick={() => setLayout({ orientation: "row" })}
        >
          <Columns2 className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Side by side</span>
        </button>
        <button
          type="button"
          className={`${tool} ${orientation === "column" ? active : idle}`}
          aria-pressed={orientation === "column"}
          title="Video above, notes below"
          onClick={() => setLayout({ orientation: "column" })}
        >
          <Rows2 className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Stacked</span>
        </button>
        <span className="mx-1 hidden h-5 w-px bg-[var(--card-border)] sm:block" aria-hidden />
        <button
          type="button"
          className={`${tool} ${layout.collapsed === "second" ? active : idle}`}
          aria-pressed={layout.collapsed === "second"}
          onClick={() => toggleCollapse("second")}
          title={layout.collapsed === "second" ? "Show the notes again" : "Make the video fill the space"}
        >
          {layout.collapsed === "second" ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          <span className="hidden sm:inline">{layout.collapsed === "second" ? "Show notes" : "Expand video"}</span>
        </button>
        <button
          type="button"
          className={`${tool} ${layout.collapsed === "first" ? active : idle}`}
          aria-pressed={layout.collapsed === "first"}
          onClick={() => toggleCollapse("first")}
          title={layout.collapsed === "first" ? "Show the video again" : "Make the notes fill the space"}
        >
          {layout.collapsed === "first" ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          <span className="hidden sm:inline">{layout.collapsed === "first" ? "Show video" : "Expand notes"}</span>
        </button>
        <button type="button" className={`${tool} ${idle} ml-auto`} onClick={reset} disabled={isDefaultLayout(layout)} title="Back to the default layout">
          <RotateCcw className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Reset layout</span>
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
