"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Copy, Download, Network, RefreshCw } from "lucide-react";
import { MathText } from "../../components/MathText";
import type { MindMapData, MindMapNode } from "../../lib/types";
import { countNodes, initialCollapsed, mindmapToMarkdown } from "./mindmap";
import { MindMapCanvas } from "./MindMapCanvas";
import { BRANCH_COLORS, layoutToSvg, type MapLayout, type MapView } from "./mindmapLayout";

const VIEWS: Array<{ id: MapView; label: string; hint: string }> = [
  { id: "radial", label: "Radial", hint: "Main idea in the centre, branches around it" },
  { id: "horizontal", label: "Left to right", hint: "Logic chart: reads like a sentence, left to right" },
  { id: "vertical", label: "Top down", hint: "Org chart: the main idea on top, branches below" },
  { id: "outline", label: "Outline", hint: "A simple indented list" },
];
const VIEW_KEY = "mindmap-view-v1";
export const isMapView = (v: unknown): v is MapView => VIEWS.some((x) => x.id === v);

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Draws the SVG on a canvas (2x for sharpness) and saves it as a PNG. */
function downloadPng(svg: string, width: number, height: number, filename: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(2, 8000 / Math.max(width, height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("canvas"));
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob((blob) => (blob ? (download(blob, filename), resolve()) : reject(new Error("png"))), "image/png");
    };
    img.onerror = () => reject(new Error("image"));
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
}

interface BranchProps {
  node: MindMapNode;
  path: string;
  depth: number;
  color: string;
  collapsed: Set<string>;
  onToggle: (path: string) => void;
}

function Branch({ node, path, depth, color, collapsed, onToggle }: BranchProps) {
  const children = node.children ?? [];
  const hasChildren = children.length > 0;
  const isCollapsed = collapsed.has(path);

  return (
    <li className="relative">
      <div className="flex items-start gap-1.5 py-1">
        {hasChildren ? (
          <button
            onClick={() => onToggle(path)}
            aria-expanded={!isCollapsed}
            aria-label={`${isCollapsed ? "Expand" : "Collapse"} ${node.title}`}
            className="mt-0.5 shrink-0 rounded-md p-0.5 text-[var(--text-muted)] hover:bg-[var(--btn-secondary-bg)] cursor-pointer"
          >
            {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        ) : (
          <span className="mt-2 ml-1.5 mr-1 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color }} aria-hidden />
        )}
        <span
          className={`rounded-xl border px-3 py-1.5 text-sm leading-snug ${
            depth === 1 ? "font-bold" : "font-medium"
          } text-[var(--text-main)] bg-[var(--card-bg)]`}
          style={{ borderColor: color }}
        >
          {/* MathText shows plain text as text (never as HTML) and renders $...$ formulas safely. */}
          <MathText text={node.title} />
        </span>
      </div>
      {hasChildren && !isCollapsed && (
        <ul className="ml-4 border-l-2 pl-3" style={{ borderColor: color }}>
          {children.map((child, index) => (
            <Branch
              key={`${path}.${index}`}
              node={child}
              path={`${path}.${index}`}
              depth={depth + 1}
              color={color}
              collapsed={collapsed}
              onToggle={onToggle}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

interface MindMapViewProps {
  data: MindMapData | null;
  isLoading?: boolean;
  /** Shown only in the workspace; the public page is read-only. */
  onGenerate?: (force?: boolean) => void;
  onToast?: (message: string, type?: "success" | "info" | "error") => void;
}

export function MindMapView({ data, isLoading, onGenerate, onToast }: MindMapViewProps) {
  const [collapsedState, setCollapsedState] = useState<{ key: MindMapData | null; set: Set<string> }>({ key: null, set: new Set() });
  const initial = useMemo(() => (data ? initialCollapsed(data, 2) : new Set<string>()), [data]);
  // Reset to the default open/closed state whenever a new map arrives.
  const collapsed = collapsedState.key === data ? collapsedState.set : initial;
  const setCollapsed = (set: Set<string>) => setCollapsedState({ key: data, set });

  const [view, setViewState] = useState<MapView>("radial");
  useEffect(() => {
    try {
      const saved = localStorage.getItem(VIEW_KEY);
      if (isMapView(saved)) setViewState(saved);
    } catch {
      /* no storage: keep the default */
    }
  }, []);
  const setView = (next: MapView) => {
    setViewState(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      /* ignore */
    }
  };
  const [fitKey, setFitKey] = useState(0);
  const refit = () => setFitKey((k) => k + 1);
  const layoutRef = useRef<MapLayout | null>(null);
  const onLayout = useCallback((l: MapLayout) => {
    layoutRef.current = l;
  }, []);

  const toggle = (path: string) => {
    const next = new Set(collapsed);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    setCollapsed(next);
  };

  if (isLoading && !data) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-[var(--text-muted)]" role="status">
        <Network className="h-8 w-8 animate-pulse" />
        <p className="text-sm font-semibold">Building your mind map…</p>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="py-16 text-center text-sm text-[var(--text-muted)]">
        {onGenerate ? (
          <button
            onClick={() => onGenerate(false)}
            className="rounded-full bg-[var(--brand-lime)] px-5 py-2 font-bold text-[#0E0F0C] cursor-pointer"
          >
            Generate mind map
          </button>
        ) : (
          "No mind map yet."
        )}
      </div>
    );
  }

  const copyOutline = async () => {
    try {
      await navigator.clipboard.writeText(mindmapToMarkdown(data));
      onToast?.("Mind map copied as an outline.", "success");
    } catch {
      onToast?.("Could not copy to the clipboard.", "error");
    }
  };

  const baseName = (data.title || "mind-map").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 60) || "mind-map";
  const dark = typeof document !== "undefined" && document.documentElement.classList.contains("dark");
  const exportMap = async (kind: "svg" | "png") => {
    const layout = layoutRef.current;
    if (!layout) return onToast?.("Switch to a map view to save an image.", "info");
    const svg = layoutToSvg(layout, dark);
    try {
      if (kind === "svg") download(new Blob([svg], { type: "image/svg+xml" }), `${baseName}.svg`);
      else await downloadPng(svg, layout.width, layout.height, `${baseName}.png`);
    } catch {
      onToast?.("Could not save the image.", "error");
    }
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-[var(--card-border)] pb-4">
        <div>
          <h3 className="text-xl font-black tracking-tight text-[var(--text-main)]">Mind map</h3>
          <p className="text-xs text-[var(--text-muted)]">{countNodes(data)} ideas · {VIEWS.find((v) => v.id === view)?.hint}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => {
              setCollapsed(new Set());
              refit();
            }}
            className="rounded-full border border-[var(--card-border)] bg-[var(--btn-secondary-bg)] px-3 py-1.5 text-xs font-bold cursor-pointer"
          >
            Expand all
          </button>
          <button
            onClick={() => {
              setCollapsed(initialCollapsed(data, 1));
              refit();
            }}
            className="rounded-full border border-[var(--card-border)] bg-[var(--btn-secondary-bg)] px-3 py-1.5 text-xs font-bold cursor-pointer"
          >
            Collapse
          </button>
          {view !== "outline" && (
            <>
              <button onClick={() => void exportMap("png")} className="flex items-center gap-1.5 rounded-full border border-[var(--card-border)] bg-[var(--btn-secondary-bg)] px-3 py-1.5 text-xs font-bold cursor-pointer">
                <Download className="h-3.5 w-3.5" /> PNG
              </button>
              <button onClick={() => void exportMap("svg")} className="flex items-center gap-1.5 rounded-full border border-[var(--card-border)] bg-[var(--btn-secondary-bg)] px-3 py-1.5 text-xs font-bold cursor-pointer">
                <Download className="h-3.5 w-3.5" /> SVG
              </button>
            </>
          )}
          <button
            onClick={copyOutline}
            className="flex items-center gap-1.5 rounded-full border border-[var(--card-border)] bg-[var(--btn-secondary-bg)] px-3 py-1.5 text-xs font-bold cursor-pointer"
          >
            <Copy className="h-3.5 w-3.5" /> Copy outline
          </button>
          {onGenerate && (
            <button
              onClick={() => onGenerate(true)}
              disabled={isLoading}
              className="flex items-center gap-1.5 rounded-full border border-[var(--card-border)] bg-[var(--btn-secondary-bg)] px-3 py-1.5 text-xs font-bold cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} /> Regenerate
            </button>
          )}
        </div>
      </div>

      <div role="tablist" aria-label="Mind map layout" className="mb-4 flex gap-1 overflow-x-auto rounded-2xl bg-[var(--btn-secondary-bg)] p-1">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            role="tab"
            aria-selected={view === v.id}
            onClick={() => setView(v.id)}
            title={v.hint}
            className={`shrink-0 flex-1 whitespace-nowrap rounded-xl px-3 py-1.5 text-xs font-bold cursor-pointer ${
              view === v.id ? "bg-[var(--brand-lime)] text-[#0E0F0C]" : "text-[var(--text-muted)] hover:text-[var(--text-main)]"
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>

      {view !== "outline" && <MindMapCanvas data={data} view={view} collapsed={collapsed} onToggle={toggle} fitKey={fitKey} onLayout={onLayout} />}

      {view === "outline" && (
      <div className="overflow-x-auto pb-4">
        <div className="mb-2 inline-block rounded-2xl bg-[var(--brand-lime)] px-4 py-2 text-base font-black text-[#0E0F0C]">
          <MathText text={data.title} />
        </div>
        <ul className="ml-2">
          {(data.children ?? []).map((child, index) => (
            <Branch
              key={`0.${index}`}
              node={child}
              path={`0.${index}`}
              depth={1}
              color={BRANCH_COLORS[index % BRANCH_COLORS.length]}
              collapsed={collapsed}
              onToggle={toggle}
            />
          ))}
        </ul>
      </div>
      )}
    </div>
  );
}
