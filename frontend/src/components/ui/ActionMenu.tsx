"use client";

import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { IconButton } from "./IconButton";

export interface MenuItem {
  key: string;
  label: string;
  /** A short explanation shown under the label. */
  hint?: string;
  icon?: React.ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  /** Draws a line above this item. */
  separated?: boolean;
  /** Shows a tick, for the currently chosen option. */
  checked?: boolean;
  danger?: boolean;
}

interface Props {
  /** Label of the button that opens the menu (tooltip and screen readers). */
  label: string;
  icon: React.ReactNode;
  items: MenuItem[];
  align?: "left" | "right";
  size?: "sm" | "md";
  disabled?: boolean;
  /** Shown above the items. */
  heading?: string;
  width?: string;
}

/**
 * An icon button that opens a small menu. Closes on outside click, Escape and after a choice;
 * arrow keys move between items.
 */
export function ActionMenu({ label, icon, items, align = "right", size = "md", disabled, heading, width = "w-60" }: Props) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();
  // Where the menu sits on the screen. It is positioned against the window (not its parent), so a scrolling
  // pane around the button can never cut it off, and it flips above the button when there is no room below.
  const [place, setPlace] = useState<{ top: number; left: number; maxHeight: number } | null>(null);

  const close = useCallback((refocus = true) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return setPlace(null);
    const trigger = button.current?.getBoundingClientRect();
    const box = menu.current;
    if (!trigger || !box) return;
    const margin = 8;
    const width = box.offsetWidth;
    const height = box.scrollHeight;
    const below = window.innerHeight - trigger.bottom - margin;
    const above = trigger.top - margin;
    const useBelow = height <= below || below >= above;
    const room = Math.max(120, useBelow ? below : above);
    const shown = Math.min(height, room);
    const left = align === "right" ? trigger.right - width : trigger.left;
    setPlace({
      top: useBelow ? trigger.bottom + 6 : Math.max(margin, trigger.top - shown - 6),
      left: Math.min(Math.max(margin, left), Math.max(margin, window.innerWidth - width - margin)),
      maxHeight: room,
    });
  }, [open, align, items.length]);

  // Moving the page under an open menu would leave it in the wrong place: close it.
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => {
      if (e.target instanceof Node && menu.current?.contains(e.target)) return; // scrolling the menu itself
      setOpen(false);
    };
    window.addEventListener("scroll", away, true);
    window.addEventListener("resize", away);
    return () => {
      window.removeEventListener("scroll", away, true);
      window.removeEventListener("resize", away);
    };
  }, [open]);

  useEffect(() => {
    if (open && place) root.current?.querySelector<HTMLElement>("[role^='menuitem']:not([disabled])")?.focus({ preventScroll: true });
  }, [open, place]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Home" && e.key !== "End") return;
    const entries = [...(root.current?.querySelectorAll<HTMLElement>("[role^='menuitem']:not([disabled])") ?? [])];
    if (entries.length === 0) return;
    e.preventDefault();
    const at = entries.indexOf(document.activeElement as HTMLElement);
    const next = e.key === "Home" ? 0 : e.key === "End" ? entries.length - 1 : e.key === "ArrowDown" ? (at + 1) % entries.length : (at - 1 + entries.length) % entries.length;
    entries[next].focus();
  };

  return (
    <div ref={root} className="relative inline-block" onKeyDown={onKeyDown}>
      <IconButton
        ref={button}
        label={label}
        size={size}
        active={open}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        {icon}
      </IconButton>
      {open && (
        <div
          ref={menu}
          id={menuId}
          role="menu"
          aria-label={label}
          style={place ? { top: place.top, left: place.left, maxHeight: place.maxHeight } : { top: 0, left: 0, visibility: "hidden" }}
          className={`fixed z-[70] max-w-[calc(100vw-1rem)] overflow-y-auto overscroll-contain ${width} rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-1.5 shadow-xl`}
        >
          {heading && <p className="px-3 pb-1 pt-1.5 text-[11px] font-bold uppercase tracking-wide text-[var(--text-muted)]">{heading}</p>}
          {items.map((item) => (
            <React.Fragment key={item.key}>
              {item.separated && <div role="separator" className="my-1 h-px bg-[var(--card-border)]" />}
              <button
                type="button"
                role={item.checked !== undefined ? "menuitemradio" : "menuitem"}
                aria-checked={item.checked}
                disabled={item.disabled}
                onClick={() => {
                  close();
                  item.onSelect();
                }}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm font-semibold hover:bg-[var(--btn-secondary-bg)] focus-visible:bg-[var(--btn-secondary-bg)] focus-visible:outline-none disabled:opacity-50 ${
                  item.danger ? "text-rose-600" : "text-[var(--text-main)]"
                }`}
              >
                {item.icon && <span className="shrink-0">{item.icon}</span>}
                <span className="min-w-0 flex-1">
                  <span className="block">{item.label}</span>
                  {item.hint && <span className="block text-xs font-normal text-[var(--text-muted)]">{item.hint}</span>}
                </span>
                {item.checked && <span aria-hidden className="text-[var(--brand-lime-hover)]">✓</span>}
              </button>
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  );
}
