"use client";

import React, { useEffect, useState } from "react";
import { Check, Cloud, Copy, Download, Link2, MessageCircle, X } from "lucide-react";
import { ActionMenu } from "../../components/ui/ActionMenu";
import { apiFetch, readError } from "../../lib/api";
import type { VideoDetail } from "../../lib/types";
import { getSupabase } from "../../lib/supabase";
import { callbackUrl, connectGoogle } from "../auth/session";
import { DRIVE_SCOPE, rememberPendingDrive, saveToDrive, takePendingDrive } from "./drive";
import { shareUrl, whatsappUrl } from "./share";

interface Props {
  videoId: string;
  title: string | null;
  onToast: (message: string, type?: "success" | "info" | "error") => void;
}

const button =
  "flex items-center gap-1.5 rounded-full border border-[var(--card-border)] bg-[var(--btn-secondary-bg)] hover:bg-[var(--btn-secondary-hover)] px-3.5 py-1.5 text-xs font-bold text-[var(--btn-secondary-text)] cursor-pointer active:scale-95 disabled:opacity-50";

/** Share link (copy / WhatsApp / stop sharing) and the Markdown study-pack download. */
export function ShareExportBar({ videoId, title, onToast }: Props) {
  const [token, setToken] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiFetch(`/api/videos/${videoId}`)
      .then((res) => (res.ok ? (res.json() as Promise<VideoDetail>) : null))
      .then((detail) => {
        if (!cancelled && detail?.share?.active) setToken(detail.share.token);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [videoId]);

  const driveSave = async (googleToken: string) => {
    const result = await saveToDrive(videoId, googleToken);
    if (result.ok) {
      onToast(`Saved to Google Drive as "${result.name}".`, "success");
      window.open(result.url, "_blank", "noopener,noreferrer");
    } else if (result.needsConsent) {
      await askForDrive();
    } else {
      onToast(result.message, "error");
    }
  };

  /** Sends the user to Google to allow Drive access, then back here to finish the save. */
  const askForDrive = async () => {
    const supabase = getSupabase();
    if (!supabase) return onToast("Sign-in is not set up, so Google Drive is not available.", "error");
    const { data } = await supabase.auth.getSession();
    rememberPendingDrive(videoId);
    try {
      await connectGoogle(supabase, data.session, callbackUrl(window.location.origin, window.location.pathname), DRIVE_SCOPE);
    } catch {
      onToast("Could not connect Google. Please try again.", "error");
    }
  };

  const saveToGoogleDrive = async () => {
    setBusy(true);
    try {
      const supabase = getSupabase();
      const { data } = (await supabase?.auth.getSession()) ?? { data: { session: null } };
      const googleToken = data.session?.provider_token;
      if (googleToken) await driveSave(googleToken);
      else await askForDrive();
    } catch (err) {
      onToast(err instanceof Error ? err.message : "Could not save to Google Drive.", "error");
    } finally {
      setBusy(false);
    }
  };

  // Back from Google with permission: finish the save that was waiting.
  useEffect(() => {
    if (!takePendingDrive(videoId)) return;
    const supabase = getSupabase();
    supabase?.auth.getSession().then(({ data }) => {
      const googleToken = data.session?.provider_token;
      if (googleToken) void driveSave(googleToken);
      else onToast("Google did not give Drive access. Please try again.", "error");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId]);

  const link = token ? shareUrl(window.location.origin, token) : null;

  const createLink = async () => {
    setBusy(true);
    try {
      const res = await apiFetch(`/api/videos/${videoId}/share`, { method: "POST" });
      if (!res.ok) throw new Error(await readError(res, "Could not create the link."));
      setToken((await res.json()).token);
    } catch (err) {
      onToast(err instanceof Error ? err.message : "Could not create the link.", "error");
    } finally {
      setBusy(false);
    }
  };

  const stopSharing = async () => {
    setBusy(true);
    try {
      const res = await apiFetch(`/api/videos/${videoId}/share`, { method: "DELETE" });
      if (!res.ok) throw new Error(await readError(res, "Could not stop sharing."));
      setToken(null);
      onToast("Sharing stopped. The old link no longer works.", "info");
    } catch (err) {
      onToast(err instanceof Error ? err.message : "Could not stop sharing.", "error");
    } finally {
      setBusy(false);
    }
  };

  const copyLink = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      onToast("Could not copy. Select the link and copy it manually.", "error");
    }
  };

  const downloadMarkdown = async () => {
    setBusy(true);
    try {
      const res = await apiFetch(`/api/videos/${videoId}/export.md`);
      if (!res.ok) throw new Error(await readError(res, "Could not export."));
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const safe = (title || "study-notes").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "_").slice(0, 40) || "study-notes";
      a.href = url;
      a.download = `${safe}.md`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      onToast(err instanceof Error ? err.message : "Could not export.", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="no-print">
      <div className="flex flex-wrap items-center gap-2">
        <button className={button} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          <Link2 className="h-3.5 w-3.5" /> {token ? "Shared" : "Share"}
        </button>
        <ActionMenu
          label="Export everything"
          icon={<Download className="h-4 w-4" />}
          heading="Export"
          width="w-64"
          disabled={busy}
          items={[
            { key: "md", label: "Download as Markdown", hint: "Summary, mind map, flashcards, quiz and transcript in one .md file", icon: <Download className="h-4 w-4" />, onSelect: () => void downloadMarkdown() },
            { key: "drive", label: "Save to Google Drive", hint: "A Google Doc in your own Drive", icon: <Cloud className="h-4 w-4" />, onSelect: () => void saveToGoogleDrive() },
          ]}
        />
      </div>

      {open && (
        <div className="mt-3 rounded-2xl border border-[var(--card-border)] bg-[var(--bg-app)] p-4 text-sm">
          {link ? (
            <>
              <p className="mb-2 text-xs text-[var(--text-muted)]">
                Anyone with this link can read the summary, mind map and flashcards. The transcript and quiz are not shared.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  readOnly
                  value={link}
                  onFocus={(e) => e.currentTarget.select()}
                  aria-label="Share link"
                  className="min-w-0 flex-1 rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-2 text-xs"
                />
                <button className={button} onClick={copyLink}>
                  {copied ? <Check className="h-3.5 w-3.5 text-[var(--color-success)]" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? "Copied" : "Copy"}
                </button>
                <a className={button} href={whatsappUrl(title, link)} target="_blank" rel="noopener noreferrer">
                  <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
                </a>
                <button className={button} onClick={stopSharing} disabled={busy}>
                  <X className="h-3.5 w-3.5" /> Stop sharing
                </button>
              </div>
            </>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-[var(--text-muted)]">Create a link anyone can open to read your summary. You can stop sharing at any time.</p>
              <button className={`${button} bg-[var(--brand-lime)] text-[#0E0F0C]`} onClick={createLink} disabled={busy}>
                Create link
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
