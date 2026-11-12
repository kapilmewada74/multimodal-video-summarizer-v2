"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, CheckCheck } from "lucide-react";
import { apiFetch } from "../../lib/api";
import type { AppNotification } from "../../lib/types";
import { useAuth } from "../auth/AuthProvider";
import { timeAgo } from "./format";

/** The bell in the top bar: unread count and a short list. Refreshes every minute and when you return to the tab. */
export function NotificationBell() {
  const { ready, signedIn, configured } = useAuth();
  const router = useRouter();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch("/api/notifications?limit=15");
      if (!res.ok) return;
      const data = await res.json();
      setItems(data.items);
      setUnread(data.unread);
    } catch {
      // try again at the next refresh
    }
  }, []);

  useEffect(() => {
    if (!configured || !ready || !signedIn) return;
    void load();
    const timer = setInterval(() => void load(), 60_000);
    const onVisible = () => document.visibilityState === "visible" && void load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [configured, ready, signedIn, load]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  const markRead = async (body: { ids?: string[]; all?: boolean }) => {
    const res = await apiFetch("/api/notifications/read", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (res.ok) setUnread((await res.json()).unread);
  };

  const openItem = (n: AppNotification) => {
    setOpen(false);
    if (!n.read) {
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
      void markRead({ ids: [n.id] });
    }
    if (n.link && n.link.startsWith("/")) router.push(n.link);
  };

  if (!configured || !ready || !signedIn) return null;

  return (
    <div className="relative" ref={box}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
        aria-expanded={open}
        className="relative flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--card-border)] bg-[var(--btn-secondary-bg)] text-[var(--text-main)] hover:bg-[var(--btn-secondary-hover)] cursor-pointer focus-visible:ring-2 focus-visible:ring-[var(--brand-lime)]"
      >
        <Bell className="h-4 w-4" />
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-black text-white">{unread > 9 ? "9+" : unread}</span>
        )}
      </button>
      {open && (
        <div role="dialog" aria-label="Notifications" className="absolute right-0 top-12 z-50 w-80 max-w-[90vw] overflow-hidden rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] shadow-2xl">
          <div className="flex items-center justify-between border-b border-[var(--card-border)] px-4 py-2.5">
            <p className="text-sm font-black">Notifications</p>
            {unread > 0 && (
              <button onClick={() => { setItems((p) => p.map((x) => ({ ...x, read: true }))); void markRead({ all: true }); }} className="inline-flex items-center gap-1 text-xs font-bold text-[var(--text-muted)] hover:text-[var(--text-main)] cursor-pointer">
                <CheckCheck className="h-3.5 w-3.5" /> Mark all read
              </button>
            )}
          </div>
          {items.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-[var(--text-muted)]">You are all caught up.</p>
          ) : (
            <ul className="max-h-96 overflow-y-auto">
              {items.map((n) => (
                <li key={n.id}>
                  <button onClick={() => openItem(n)} className="flex w-full items-start gap-2.5 px-4 py-3 text-left hover:bg-[var(--btn-secondary-bg)] cursor-pointer">
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.read ? "bg-transparent" : "bg-[var(--brand-lime)]"}`} aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className={`block text-sm ${n.read ? "font-medium" : "font-bold"}`}>{n.title}</span>
                      {n.body && <span className="block truncate text-xs text-[var(--text-muted)]">{n.body}</span>}
                      <span className="mt-0.5 block text-[11px] text-[var(--text-muted)]">{timeAgo(n.created_at)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <a href="/settings" className="block border-t border-[var(--card-border)] px-4 py-2.5 text-center text-xs font-bold text-[var(--text-muted)] hover:text-[var(--text-main)]">Notification settings</a>
        </div>
      )}
    </div>
  );
}
