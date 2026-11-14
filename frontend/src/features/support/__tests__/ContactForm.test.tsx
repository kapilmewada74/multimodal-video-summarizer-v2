// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const apiFetch = vi.fn();
let auth: Record<string, unknown> = {};
vi.mock("../../../lib/api", () => ({
  apiFetch: (...a: unknown[]) => apiFetch(...a),
  readError: async (res: { json: () => Promise<{ message?: string }> }, fallback: string) => (await res.json()).message ?? fallback,
}));
vi.mock("../../auth/AuthProvider", () => ({ useAuth: () => auth }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

import { ContactForm } from "../ContactForm";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  apiFetch.mockReset();
  auth = { signedIn: false, email: null, profile: { name: null } };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const render = async () => { await act(async () => root.render(<ContactForm />)); };
const type = async (selector: string, value: string) => {
  const el = container.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement;
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const submit = async () => { await act(async () => { container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); }); };

describe("ContactForm", () => {
  it("shows what is wrong and sends nothing when the form is incomplete", async () => {
    await render();
    await submit();
    expect(container.textContent).toContain("valid email address");
    expect(container.textContent).toContain("at least 10 characters");
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("sends the message and then thanks the person", async () => {
    apiFetch.mockResolvedValue({ ok: true, json: async () => ({ received: true }) });
    await render();
    await type('input[type="email"]', "ada@example.org");
    await type("textarea", "My upload stops at ninety percent.");
    await submit();
    expect(apiFetch).toHaveBeenCalledTimes(1);
    const [url, init] = apiFetch.mock.calls[0];
    expect(url).toBe("/api/contact");
    expect(JSON.parse(init.body)).toMatchObject({ email: "ada@example.org", message: "My upload stops at ninety percent.", category: "general", website: "" });
    expect(container.textContent).toContain("Thanks, we got your message");
    expect(container.textContent).toContain("ada@example.org");
  });

  it("keeps what was typed and shows the server's reason when sending fails", async () => {
    apiFetch.mockResolvedValue({ ok: false, json: async () => ({ message: "Too many messages. Please wait 60 seconds and try again." }) });
    await render();
    await type('input[type="email"]', "ada@example.org");
    await type("textarea", "My upload stops at ninety percent.");
    await submit();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Please wait 60 seconds");
    expect((container.querySelector("textarea") as HTMLTextAreaElement).value).toBe("My upload stops at ninety percent.");
  });

  it("fills in the email and name of a signed-in person", async () => {
    auth = { signedIn: true, email: "me@example.org", profile: { name: "Me Myself" } };
    await render();
    expect((container.querySelector('input[type="email"]') as HTMLInputElement).value).toBe("me@example.org");
    expect((container.querySelector('input[autocomplete="name"]') as HTMLInputElement).value).toBe("Me Myself");
  });

  it("hides the trap field from people and screen readers", async () => {
    await render();
    const trap = container.querySelector('input[tabindex="-1"]') as HTMLInputElement;
    expect(trap.closest('[aria-hidden="true"]')).not.toBeNull();
  });
});
