"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Maximize2, Minus, Plus, Scan } from "lucide-react";
import { MathText } from "../../components/MathText";
import { useElementSize } from "../layout/hooks";
import type { MindMapNode } from "../../lib/types";
import { branchColor, layoutMap, type MapLayout, type MapView } from "./mindmapLayout";

const MIN_ZOOM = 0.15;
const MAX_ZOOM = 2.5;
const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

/** Scale and offset that fit the whole map in the box, centred. */
export function fitTransform(layout: { width: number; height: number }, box: { width: number; height: number }) {
  if (!box.width || !box.height || !layout.width || !layout.height) return { k: 1, x: 0, y: 0 };
  const k = clampZoom(Math.min(box.width / layout.width, box.height / layout.height, 1.1));
  return { k, x: (box.width - layout.width * k) / 2, y: (box.height - layout.height * k) / 2 };
}

interface Props {
  data: MindMapNode;
  view: Exclude<MapView, "outline">;
  collapsed: Set<string>;
  onToggle: (path: string) => void;
  /** Change this number to fit the map to the screen again (after "expand all", for example). */
  fitKey?: number;
  /** Called with the current layout so the parent can export it. */
  onLayout?: (layout: MapLayout) => void;
}

/** A map you can drag, zoom (buttons, ctrl+wheel, pinch) and open full screen. */
export function MindMapCanvas({ data, view, collapsed, onToggle, fitKey = 0, onLayout }: Props) {
  const layout = useMemo(() => layoutMap(data, view, collapsed), [data, view, collapsed]);
  const boxRef = useRef<HTMLDivElement>(null);
  const box = useElementSize(boxRef);
  const [t, setT] = useState({ k: 1, x: 0, y: 0 });
  const [full, setFull] = useState(false);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ dist: number; k: number } | null>(null);
  const moved = useRef(false);
  const fitted = useRef("");

  useEffect(() => onLayout?.(layout), [layout, onLayout]);

  const fit = useCallback(() => setT(fitTransform(layout, box)), [layout, box]);
  // Fit when the view changes or the box first has a size; later size changes keep what you set.
  useEffect(() => {
    const key = `${view}:${box.width > 0}:${full}`;
    if (box.width > 0 && fitted.current !== key) {
      fitted.current = key;
      fit();
    }
  }, [view, box.width, full, fit]);

  const firstFit = useRef(true);
  useEffect(() => {
    if (firstFit.current) {
      firstFit.current = false;
      return;
    }
    fit();
    // Only when asked to: a single open/close must not undo the position you chose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);

  const zoomAt = (factor: number, cx: number, cy: number) =>
    setT((cur) => {
      const k = clampZoom(cur.k * factor);
      const ratio = k / cur.k;
      return { k, x: cx - (cx - cur.x) * ratio, y: cy - (cy - cur.y) * ratio };
    });
  const zoomCentre = (factor: number) => zoomAt(factor, box.width / 2, box.height / 2);

  const onPointerDown = (e: React.PointerEvent) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved.current = false;
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      gesture.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), k: t.k };
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const now = { x: e.clientX, y: e.clientY };
    pointers.current.set(e.pointerId, now);
    if (pointers.current.size === 1) {
      const dx = now.x - prev.x, dy = now.y - prev.y;
      if (!moved.current && Math.hypot(dx, dy) < 3) return;
      if (!moved.current) boxRef.current?.setPointerCapture?.(e.pointerId);
      moved.current = true;
      setT((cur) => ({ ...cur, x: cur.x + dx, y: cur.y + dy }));
    } else if (pointers.current.size === 2 && gesture.current) {
      moved.current = true;
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const rect = boxRef.current!.getBoundingClientRect();
      const factor = (gesture.current.k * (dist / gesture.current.dist)) / t.k;
      zoomAt(factor, (a.x + b.x) / 2 - rect.left, (a.y + b.y) / 2 - rect.top);
    }
  };
  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) gesture.current = null;
  };
  const onWheel = (e: React.WheelEvent) => {
    if (!(e.ctrlKey || e.metaKey)) return; // a plain scroll keeps scrolling the page
    e.preventDefault();
    const rect = boxRef.current!.getBoundingClientRect();
    zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - rect.left, e.clientY - rect.top);
  };

  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setFull(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [full]);

  const btn =
    "flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--card-border)] bg-[var(--bg-card)] text-[var(--text-main)] shadow-sm hover:bg-[var(--btn-secondary-bg)] cursor-pointer focus-visible:ring-2 focus-visible:ring-[var(--brand-lime)]";

  return (
    <div
      className={
        full
          ? "fixed inset-0 z-50 bg-[var(--bg-app)] p-3"
          : "relative"
      }
    >
      <div
        ref={boxRef}
        data-testid="mindmap-canvas"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
        className={`relative w-full overflow-hidden rounded-2xl border border-[var(--card-border)] bg-[var(--bg-app)] ${
          full ? "h-full" : "h-[62vh] min-h-[320px] max-h-[720px]"
        }`}
        style={{ touchAction: "none", cursor: "grab" }}
      >
        <div
          data-testid="mindmap-surface"
          style={{
            position: "absolute", left: 0, top: 0, width: layout.width, height: layout.height,
            transform: `translate(${t.x}px, ${t.y}px) scale(${t.k})`, transformOrigin: "0 0",
          }}
        >
          <svg width={layout.width} height={layout.height} style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }} aria-hidden>
            {layout.links.map((l) => (
              <path key={l.id} d={l.d} fill="none" stroke={branchColor(l.branch)} strokeWidth={2} strokeLinecap="round" opacity={0.85} />
            ))}
          </svg>
          {layout.nodes.map((n) => {
            const color = branchColor(n.branch);
            const root = n.depth === 0;
            const toggleable = n.hasChildren && !root;
            return (
              <div
                key={n.path}
                role={toggleable ? "button" : undefined}
                tabIndex={toggleable ? 0 : undefined}
                aria-expanded={toggleable ? !n.collapsed : undefined}
                aria-label={toggleable ? `${n.collapsed ? "Expand" : "Collapse"} ${n.lines.join(" ")}` : undefined}
                data-testid="mindmap-node"
                onClick={() => toggleable && !moved.current && onToggle(n.path)}
                onKeyDown={(e) => {
                  if (toggleable && (e.key === "Enter" || e.key === " ")) {
                    e.preventDefault();
                    onToggle(n.path);
                  }
                }}
                className={`absolute flex items-center justify-center rounded-xl border-2 px-2 text-center text-[var(--text-main)] ${
                  toggleable ? "cursor-pointer" : ""
                } ${root ? "font-black text-[#0E0F0C]" : n.depth === 1 ? "font-bold bg-[var(--card-bg)]" : "font-medium bg-[var(--card-bg)]"}`}
                style={{
                  left: n.x, top: n.y, width: n.w, minHeight: n.h, borderColor: color,
                  background: root ? color : undefined, fontSize: root ? 16 : n.depth === 1 ? 14 : 13, lineHeight: "18px",
                }}
              >
                <span className="py-1"><MathText text={n.title} /></span>
                {n.collapsed && (
                  <span
                    className="absolute -right-2 -top-2 rounded-full px-1.5 text-[10px] font-black text-[#0E0F0C]"
                    style={{ background: color }}
                    title={`${n.hiddenCount} hidden`}
                  >
                    +{n.hiddenCount}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className={`absolute right-3 flex flex-col gap-2 ${full ? "top-6" : "top-3"}`}>
        <button type="button" aria-label="Zoom in" onClick={() => zoomCentre(1.25)} className={btn}><Plus className="h-4 w-4" /></button>
        <button type="button" aria-label="Zoom out" onClick={() => zoomCentre(1 / 1.25)} className={btn}><Minus className="h-4 w-4" /></button>
        <button type="button" aria-label="Fit to screen" onClick={fit} className={btn}><Scan className="h-4 w-4" /></button>
        <button type="button" aria-label={full ? "Exit full screen" : "Full screen"} aria-pressed={full} onClick={() => setFull((v) => !v)} className={btn}>
          <Maximize2 className="h-4 w-4" />
        </button>
      </div>
      {!full && (
        <p className="mt-2 text-[11px] text-[var(--text-muted)]">
          Drag to move · pinch or Ctrl+scroll to zoom · tap an idea to open or close it
        </p>
      )}
    </div>
  );
}
