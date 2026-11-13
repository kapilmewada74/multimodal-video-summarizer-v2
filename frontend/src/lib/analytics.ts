/**
 * Privacy-friendly product analytics (Plausible: no cookies, no personal data, no cross-site tracking).
 * Does nothing unless NEXT_PUBLIC_ANALYTICS_DOMAIN is set. Events carry no user ids, emails or video links.
 */
export type FunnelEvent =
  | "sign_in_started"
  | "summary_submitted"
  | "summary_ready"
  | "study_started"
  | "playlist_created"
  | "export_used"
  | "guest_started"
  | "signin_prompt_shown"
  | "signin_prompt_accepted"
  | "signin_prompt_dismissed";

type Plausible = (name: string, options?: { props?: Record<string, string | number | boolean> }) => void;

export function track(event: FunnelEvent, props?: Record<string, string | number | boolean>): void {
  try {
    const plausible = (window as unknown as { plausible?: Plausible }).plausible;
    if (typeof plausible === "function") plausible(event, props ? { props } : undefined);
  } catch {
    /* analytics must never break the app */
  }
}
