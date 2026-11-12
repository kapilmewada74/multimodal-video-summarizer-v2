/** Browser notifications (Web Push). Works only with the keys configured on the server. */

/** The VAPID public key is sent as base64url text; the browser needs raw bytes. */
export function urlBase64ToUint8Array(value: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function pushSupported(win: Window = window): boolean {
  return "serviceWorker" in navigator && "PushManager" in win && "Notification" in win;
}

export function subscriptionToJson(subscription: PushSubscription): { endpoint: string; keys: { p256dh: string; auth: string } } {
  const data = subscription.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  if (!data.endpoint || !data.keys?.p256dh || !data.keys?.auth) throw new Error("Incomplete push subscription.");
  return { endpoint: data.endpoint, keys: { p256dh: data.keys.p256dh, auth: data.keys.auth } };
}
