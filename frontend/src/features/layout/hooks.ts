"use client";

import { RefObject, useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_LAYOUT, parseLayout, type LayoutState } from "./split";

/** The size of an element, kept up to date as it is resized. */
export function useElementSize<T extends HTMLElement>(ref: RefObject<T | null>): { width: number; height: number } {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    read();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", read);
      return () => window.removeEventListener("resize", read);
    }
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

/** The layout (orientation, divider position, collapsed pane), remembered in the browser. */
export function useSavedLayout(storageKey: string) {
  const [layout, setLayoutState] = useState<LayoutState>(DEFAULT_LAYOUT);
  const loaded = useRef(false);

  useEffect(() => {
    try {
      setLayoutState(parseLayout(localStorage.getItem(storageKey)));
    } catch {
      // storage unavailable: keep the default
    }
    loaded.current = true;
  }, [storageKey]);

  const setLayout = useCallback(
    (update: Partial<LayoutState> | ((prev: LayoutState) => LayoutState)) => {
      setLayoutState((prev) => {
        const next = typeof update === "function" ? update(prev) : { ...prev, ...update };
        try {
          localStorage.setItem(storageKey, JSON.stringify(next));
        } catch {
          // ignore: the layout just will not be remembered
        }
        return next;
      });
    },
    [storageKey],
  );

  const reset = useCallback(() => setLayout({ ...DEFAULT_LAYOUT }), [setLayout]);
  return { layout, setLayout, reset };
}
