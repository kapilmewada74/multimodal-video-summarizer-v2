"use client";

import React, { useCallback, useEffect, useState } from "react";
import { BellRing, Loader2 } from "lucide-react";
import { apiFetch, readError } from "../../lib/api";
import type { NotificationChannel, NotificationKind, NotificationSettings as Settings } from "../../lib/types";
import { useAuth } from "../auth/AuthProvider";
import { hourLabel, KIND_LABELS } from "./format";
import { pushSupported, subscriptionToJson, urlBase64ToUint8Array } from "./push";

type Toast = (message: string, type?: "success" | "info" | "error") => void;
const KINDS = Object.keys(KIND_LABELS) as NotificationKind[];
const CHANNELS: { key: NotificationChannel; label: string }[] = [
  { key: "in_app", label: "In the app" },
  { key: "email", label: "Email" },
  { key: "push", label: "Browser" },
];
const select = "rounded-lg border border-[var(--card-border)] bg-[var(--bg-app)] px-2 py-1.5 text-sm";
const hours = Array.from({ length: 24 }, (_, h) => h);

export function NotificationSettings({ onToast }: { onToast: Toast }) {
  const { ready, signedIn, configured, email } = useAuth();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [quietOn, setQuietOn] = useState(false);
  const [saving, setSaving] = useState(false);
  const [browserBusy, setBrowserBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await apiFetch("/api/notifications/settings");
    if (!res.ok) return onToast(await readError(res, "Could not load your settings."), "error");
    const data: Settings = await res.json();
    setSettings(data);
    setQuietOn(data.quiet_start !== null && data.quiet_end !== null);
  }, [onToast]);

  useEffect(() => {
    if (ready && signedIn) void load();
  }, [ready, signedIn, load]);

  const save = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      const body = quietOn
        ? { prefs: settings.prefs, reminder_hour: settings.reminder_hour, quiet_start: settings.quiet_start ?? 22, quiet_end: settings.quiet_end ?? 7 }
        : { prefs: settings.prefs, reminder_hour: settings.reminder_hour, clear_quiet_hours: true };
      const res = await apiFetch("/api/notifications/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error(await readError(res));
      setSettings(await res.json());
      onToast("Settings saved.", "success");
    } catch (err) {
      onToast(err instanceof Error ? err.message : "Could not save your settings.", "error");
    } finally {
      setSaving(false);
    }
  };

  const enableBrowser = async () => {
    setBrowserBusy(true);
    try {
      if (!pushSupported()) throw new Error("This browser does not support notifications.");
      if ((await Notification.requestPermission()) !== "granted") throw new Error("Notifications are blocked. Allow them in your browser's site settings, then try again.");
      const keyRes = await apiFetch("/api/push/public-key");
      if (!keyRes.ok) throw new Error(await readError(keyRes, "Browser notifications are not set up on this server."));
      const { public_key } = await keyRes.json();
      const registration = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(public_key) }));
      const res = await apiFetch("/api/push/subscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(subscriptionToJson(subscription)) });
      if (!res.ok) throw new Error(await readError(res, "Could not turn on browser notifications."));
      onToast("Browser notifications are on for this device.", "success");
      await load();
    } catch (err) {
      onToast(err instanceof Error ? err.message : "Could not turn on browser notifications.", "error");
    } finally {
      setBrowserBusy(false);
    }
  };

  const disableBrowser = async () => {
    setBrowserBusy(true);
    try {
      const registration = await navigator.serviceWorker.getRegistration("/sw.js");
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        await apiFetch("/api/push/unsubscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: subscription.endpoint }) });
        await subscription.unsubscribe();
      }
      onToast("Browser notifications are off for this device.", "info");
      await load();
    } catch {
      onToast("Could not turn off browser notifications.", "error");
    } finally {
      setBrowserBusy(false);
    }
  };

  if (!configured) return <div className="py-20 text-center text-sm text-[var(--text-muted)]">Sign-in is not configured for this app yet.</div>;
  if (!settings) return <div className="flex items-center justify-center gap-2 py-24 text-sm text-[var(--text-muted)]" role="status"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>;

  const card = "rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-5";
  const setPref = (kind: NotificationKind, channel: NotificationChannel, value: boolean) =>
    setSettings({ ...settings, prefs: { ...settings.prefs, [kind]: { ...settings.prefs[kind], [channel]: value } } });

  return (
    <div className="grid gap-6">
      <h1 className="text-2xl font-black tracking-tight">Notification settings</h1>

      {!email && <p className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4 text-sm">Your account has no email address, so email notifications are not available.</p>}

      <section className={card} aria-label="What to be notified about">
        <h2 className="mb-3 text-sm font-black">What to be notified about</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-[var(--text-muted)]">
                <th className="pb-2 pr-3 font-bold">Notification</th>
                {CHANNELS.map((c) => <th key={c.key} className="px-2 pb-2 text-center font-bold">{c.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {KINDS.map((kind) => (
                <tr key={kind} className="border-t border-[var(--card-border)]">
                  <td className="py-3 pr-3"><p className="font-bold">{KIND_LABELS[kind].title}</p><p className="text-xs text-[var(--text-muted)]">{KIND_LABELS[kind].hint}</p></td>
                  {CHANNELS.map((c) => {
                    const unavailable = (c.key === "email" && (!settings.email_available || !email)) || (c.key === "push" && !settings.push_available);
                    return (
                      <td key={c.key} className="px-2 text-center">
                        <input type="checkbox" aria-label={`${KIND_LABELS[kind].title} by ${c.label}`} checked={settings.prefs[kind][c.key]} disabled={unavailable}
                          onChange={(e) => setPref(kind, c.key, e.target.checked)} className="h-4 w-4 accent-[var(--brand-lime)] disabled:opacity-40" />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!settings.email_available && <p className="mt-3 text-xs text-[var(--text-muted)]">Email is not set up on this server yet.</p>}
        {!settings.push_available && <p className="mt-1 text-xs text-[var(--text-muted)]">Browser notifications are not set up on this server yet.</p>}
      </section>

      <section className={card} aria-label="Timing">
        <h2 className="mb-3 text-sm font-black">Timing</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="grid gap-1 text-xs font-bold">Streak reminder time
            <select value={settings.reminder_hour} onChange={(e) => setSettings({ ...settings, reminder_hour: Number(e.target.value) })} className={select}>
              {hours.map((h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
            </select>
            <span className="font-normal text-[var(--text-muted)]">In your time zone ({settings.timezone}).</span>
          </label>
          <div className="grid gap-1 text-xs font-bold">
            <label className="flex items-center gap-2"><input type="checkbox" checked={quietOn} onChange={(e) => setQuietOn(e.target.checked)} className="h-4 w-4 accent-[var(--brand-lime)]" /> Quiet hours (no email or browser alerts)</label>
            <div className="flex items-center gap-2">
              <select aria-label="Quiet hours start" disabled={!quietOn} value={settings.quiet_start ?? 22} onChange={(e) => setSettings({ ...settings, quiet_start: Number(e.target.value) })} className={select}>{hours.map((h) => <option key={h} value={h}>{hourLabel(h)}</option>)}</select>
              <span className="font-normal">to</span>
              <select aria-label="Quiet hours end" disabled={!quietOn} value={settings.quiet_end ?? 7} onChange={(e) => setSettings({ ...settings, quiet_end: Number(e.target.value) })} className={select}>{hours.map((h) => <option key={h} value={h}>{hourLabel(h)}</option>)}</select>
            </div>
          </div>
        </div>
      </section>

      <section className={card} aria-label="This browser">
        <h2 className="mb-1 flex items-center gap-1.5 text-sm font-black"><BellRing className="h-4 w-4" /> Notifications on this device</h2>
        <p className="mb-3 text-xs text-[var(--text-muted)]">Get alerts even when this site is not open. Turn it on for each browser you use.</p>
        {settings.push_available ? (
          settings.push_subscribed ? (
            <button onClick={disableBrowser} disabled={browserBusy} className="rounded-full border border-[var(--card-border)] bg-[var(--btn-secondary-bg)] px-4 py-2 text-sm font-bold disabled:opacity-60 cursor-pointer">Turn off on this browser</button>
          ) : (
            <button onClick={enableBrowser} disabled={browserBusy} className="rounded-full bg-[var(--brand-lime)] px-4 py-2 text-sm font-black text-[#0E0F0C] disabled:opacity-60 cursor-pointer">{browserBusy ? "Working…" : "Turn on for this browser"}</button>
          )
        ) : (
          <p className="text-sm text-[var(--text-muted)]">Not available yet.</p>
        )}
      </section>

      <div><button onClick={save} disabled={saving} className="rounded-full bg-[var(--brand-lime)] px-6 py-2.5 text-sm font-black text-[#0E0F0C] disabled:opacity-60 cursor-pointer">{saving ? "Saving…" : "Save settings"}</button></div>
    </div>
  );
}
