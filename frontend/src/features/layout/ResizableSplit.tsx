"use client";

import React, { useRef, useState } from "react";
import { fractionFromKey, fractionFromPointer, type Collapsed, type Orientation } from "./split";

interface Props {
  orientation: Orientation;
  /** Share (0-1) of the space for the first pane. */
  fraction: number;
  onFractionChange: (fraction: number) => void;
  onReset: () => void;
  collapsed: Collapsed;
  first: React.ReactNode;
  second: React.ReactNode;
  firstLabel: string;
  secondLabel: string;
  /** Smallest size, in pixels, either pane can be dragged to. */
  minPx?: number;
}

const DIVIDER_PX = 12;

/**
 * Two panes with a draggable divider. Each pane scrolls on its own. The divider works with a mouse,
 * a finger and the keyboard (arrow keys, Home, End), and a double click puts it back.
 */
export function ResizableSplit({ orientation, fraction, onFractionChange, onReset, collapsed, first, second, firstLabel, secondLabel, minPx = 160 }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const row = orientation === "row";

  const move = (e: React.PointerEvent) => {
    const el = box.current;
    if (!dragging || !el) return;
    const rect = el.getBoundingClientRect();
    onFractionChange(fractionFromPointer(row ? e.clientX : e.clientY, row ? rect.left : rect.top, row ? rect.width : rect.height, minPx));
  };

  const paneStyle = (share: number): React.CSSProperties => ({ flex: `0 0 calc(${(share * 100).toFixed(3)}% - ${DIVIDER_PX / 2}px)` });
  const showFirst = collapsed !== "first";
  const showSecond = collapsed !== "second";
  const both = showFirst && showSecond;

  return (
    <div
      ref={box}
      data-orientation={orientation}
      className={`flex h-full min-h-0 w-full min-w-0 ${row ? "flex-row" : "flex-col"} ${dragging ? "select-none" : ""}`}
    >
      {showFirst && (
        <section
          aria-label={firstLabel}
          data-pane="first"
          className={`min-h-0 min-w-0 overflow-auto ${dragging ? "pointer-events-none" : ""} ${both ? "" : "flex-1"}`}
          style={both ? paneStyle(fraction) : undefined}
        >
          {first}
        </section>
      )}

      {both && (
        <div
          role="separator"
          aria-orientation={row ? "vertical" : "horizontal"}
          aria-label={`Resize ${firstLabel} and ${secondLabel}`}
          aria-valuenow={Math.round(fraction * 100)}
          aria-valuemin={15}
          aria-valuemax={85}
          tabIndex={0}
          title="Drag to resize. Double-click to reset."
          onPointerDown={(e) => {
            e.preventDefault();
            e.currentTarget.setPointerCapture?.(e.pointerId);
            setDragging(true);
          }}
          onPointerMove={move}
          onPointerUp={(e) => {
            if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture?.(e.pointerId);
            setDragging(false);
          }}
          onPointerCancel={() => setDragging(false)}
          onDoubleClick={onReset}
          onKeyDown={(e) => {
            const next = fractionFromKey(fraction, e.key, orientation);
            if (next !== null) {
              e.preventDefault();
              onFractionChange(next);
            }
          }}
          style={{ flex: `0 0 ${DIVIDER_PX}px`, touchAction: "none" }}
          className={`group relative z-10 flex items-center justify-center rounded-full ${row ? "cursor-col-resize" : "cursor-row-resize"} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-lime)]`}
        >
          {/* a bigger invisible target makes the divider easy to grab with a finger */}
          <span className={`absolute ${row ? "-inset-x-2 inset-y-0" : "-inset-y-2 inset-x-0"}`} aria-hidden />
          <span
            aria-hidden
            className={`rounded-full transition-colors ${dragging ? "bg-[var(--brand-lime)]" : "bg-[var(--card-border)] group-hover:bg-[var(--brand-lime)]"} ${row ? "h-12 w-1" : "h-1 w-12"}`}
          />
        </div>
      )}

      {showSecond && (
        <section
          aria-label={secondLabel}
          data-pane="second"
          className={`min-h-0 min-w-0 overflow-auto ${dragging ? "pointer-events-none" : ""} ${both ? "" : "flex-1"}`}
          style={both ? paneStyle(1 - fraction) : undefined}
        >
          {second}
        </section>
      )}
    </div>
  );
}
