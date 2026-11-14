"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Loader2, Send } from "lucide-react";
import { apiFetch, readError } from "../../lib/api";
import { SITE } from "../../lib/site";
import { useAuth } from "../auth/AuthProvider";
import { CATEGORIES, MAX_MESSAGE, validateContact, type ContactDraft, type ContactErrors } from "./contact";

const field =
  "w-full rounded-xl border border-[var(--card-border)] bg-[var(--bg-app)] px-3.5 py-2.5 text-sm text-[var(--text-main)] outline-none transition-colors placeholder:text-[var(--text-muted)] focus:border-[var(--brand-lime-hover)] focus-visible:ring-2 focus-visible:ring-[var(--brand-lime)]";

/** The Contact us form. Works for visitors without an account; signed-in people have their details filled in. */
export function ContactForm() {
  const { email: accountEmail, profile, signedIn } = useAuth();
  const [draft, setDraft] = useState<ContactDraft>({ name: "", email: "", category: "general", subject: "", message: "" });
  const [trap, setTrap] = useState("");           // the hidden field: only bots fill it in
  const [errors, setErrors] = useState<ContactErrors>({});
  const [status, setStatus] = useState<"idle" | "sending" | "sent">("idle");
  const [failure, setFailure] = useState<string | null>(null);

  // Fill in who they are once, without overwriting something they already typed.
  useEffect(() => {
    if (!signedIn) return;
    setDraft((d) => ({ ...d, email: d.email || accountEmail || "", name: d.name || profile.name || "" }));
  }, [signedIn, accountEmail, profile.name]);

  const set = (key: keyof ContactDraft) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setDraft((d) => ({ ...d, [key]: event.target.value }));
    if (key === "email" || key === "message") setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (status === "sending") return;
    const found = validateContact(draft);
    setErrors(found);
    setFailure(null);
    if (Object.keys(found).length) return;
    setStatus("sending");
    try {
      const res = await apiFetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...draft, email: draft.email.trim(), website: trap }),
      });
      if (!res.ok) throw new Error(await readError(res, "We could not send your message. Please try again."));
      setStatus("sent");
    } catch (err: unknown) {
      setFailure(err instanceof Error ? err.message : "We could not send your message. Please try again.");
      setStatus("idle");
    }
  };

  if (status === "sent") {
    return (
      <div role="status" className="rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-8 text-center">
        <CheckCircle2 className="mx-auto h-10 w-10 text-[var(--brand-lime-hover)] dark:text-[var(--brand-lime)]" />
        <h2 className="mt-4 text-xl font-black">Thanks, we got your message</h2>
        <p className="mx-auto mt-2 max-w-sm text-sm text-[var(--text-muted)]">
          We read every message and will reply to <strong className="text-[var(--text-main)]">{draft.email.trim()}</strong> as soon as we can.
        </p>
        <Link href="/" className="mt-6 inline-flex h-10 items-center rounded-xl bg-[var(--brand-lime)] px-5 text-sm font-bold text-[#0E0F0C]">Back to home</Link>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4 rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-5 sm:p-7">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm font-bold">
          Your name <span className="font-normal text-[var(--text-muted)]">(optional)</span>
          <input className={`${field} mt-1.5 font-normal`} value={draft.name} onChange={set("name")} maxLength={100} autoComplete="name" />
        </label>
        <label className="block text-sm font-bold">
          Email
          <input
            className={`${field} mt-1.5 font-normal`} type="email" value={draft.email} onChange={set("email")} maxLength={254}
            autoComplete="email" aria-invalid={!!errors.email} aria-describedby={errors.email ? "contact-email-error" : undefined}
          />
          {errors.email && <span id="contact-email-error" role="alert" className="mt-1 block text-xs font-medium text-red-600 dark:text-red-400">{errors.email}</span>}
        </label>
      </div>

      <label className="block text-sm font-bold">
        What is it about?
        <select className={`${field} mt-1.5 font-normal`} value={draft.category} onChange={set("category")}>
          {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
      </label>

      <label className="block text-sm font-bold">
        Subject <span className="font-normal text-[var(--text-muted)]">(optional)</span>
        <input className={`${field} mt-1.5 font-normal`} value={draft.subject} onChange={set("subject")} maxLength={150} />
      </label>

      <label className="block text-sm font-bold">
        Message
        <textarea
          className={`${field} mt-1.5 min-h-40 resize-y font-normal`} value={draft.message} onChange={set("message")} maxLength={MAX_MESSAGE}
          aria-invalid={!!errors.message} aria-describedby={errors.message ? "contact-message-error" : undefined}
          placeholder="Tell us what happened or what you need. If a video is involved, include its link."
        />
        <span className="mt-1 flex justify-between gap-3 text-xs font-normal text-[var(--text-muted)]">
          {errors.message ? <span id="contact-message-error" role="alert" className="font-medium text-red-600 dark:text-red-400">{errors.message}</span> : <span />}
          <span>{draft.message.length} / {MAX_MESSAGE}</span>
        </span>
      </label>

      {/* Hidden from people and screen readers; a bot that fills in every field gives itself away. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>Website <input tabIndex={-1} autoComplete="off" value={trap} onChange={(e) => setTrap(e.target.value)} /></label>
      </div>

      {failure && <p role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-sm text-red-700 dark:text-red-300">{failure}</p>}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="submit" disabled={status === "sending"}
          className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-xl bg-[var(--brand-lime)] px-6 text-sm font-bold text-[#0E0F0C] transition-all hover:bg-[var(--brand-lime-hover)] active:scale-95 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:ring-2 focus-visible:ring-[var(--text-main)]"
        >
          {status === "sending" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          {status === "sending" ? "Sending…" : "Send message"}
        </button>
        {SITE.contactEmail && (
          <p className="text-xs text-[var(--text-muted)]">Or email <a className="font-semibold underline" href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a></p>
        )}
      </div>
    </form>
  );
}
