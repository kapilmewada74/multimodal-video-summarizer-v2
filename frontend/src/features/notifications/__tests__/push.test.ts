// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { subscriptionToJson, urlBase64ToUint8Array } from "../push";

describe("push helpers", () => {
  it("converts the base64url server key to bytes", () => {
    expect(Array.from(urlBase64ToUint8Array("AQID"))).toEqual([1, 2, 3]);
    expect(Array.from(urlBase64ToUint8Array("-_8"))).toEqual([251, 255]);       // url-safe characters, no padding
    expect(Array.from(urlBase64ToUint8Array("AA"))).toEqual([0]);                // padding is restored
  });

  it("converts a realistic 65-byte VAPID key", () => {
    const bytes = new Uint8Array(65).map((_, i) => (i * 7) % 256);
    const encoded = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(Array.from(urlBase64ToUint8Array(encoded))).toEqual(Array.from(bytes));
  });

  it("extracts the fields the server needs", () => {
    const sub = { toJSON: () => ({ endpoint: "https://fcm.googleapis.com/x", keys: { p256dh: "k", auth: "a" } }) } as unknown as PushSubscription;
    expect(subscriptionToJson(sub)).toEqual({ endpoint: "https://fcm.googleapis.com/x", keys: { p256dh: "k", auth: "a" } });
  });

  it("refuses an incomplete subscription", () => {
    const bad = { toJSON: () => ({ endpoint: "https://x", keys: { p256dh: "k" } }) } as unknown as PushSubscription;
    expect(() => subscriptionToJson(bad)).toThrow();
  });
});
