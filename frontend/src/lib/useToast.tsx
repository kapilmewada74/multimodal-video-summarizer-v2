"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";

export type ToastType = "success" | "info" | "error" | "warning";
interface ToastState {
  message: string;
  type: ToastType;
}

/** A small toast notification: `showToast(message, type)` and render `toastView`. */
export function useToast() {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((message: string, type: ToastType = "info") => {
    setToast({ message, type });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 3800);
  }, []);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const toastView = toast ? (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-6 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-2xl bg-[var(--card-bg)] border border-[var(--card-border)] shadow-2xl text-xs font-bold text-[var(--text-main)] max-w-sm"
    >
      {toast.type === "success" ? (
        <CheckCircle2 className="w-4 h-4 text-[var(--color-success)] shrink-0" />
      ) : toast.type === "error" ? (
        <AlertCircle className="w-4 h-4 text-[var(--color-danger)] shrink-0" />
      ) : (
        <Info className="w-4 h-4 shrink-0" />
      )}
      <span className="flex-1 leading-snug">{toast.message}</span>
      <button
        onClick={() => setToast(null)}
        className="p-1 rounded-lg hover:bg-black/10 dark:hover:bg-white/10 cursor-pointer"
        aria-label="Dismiss notification"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  ) : null;

  return { showToast, toastView };
}
