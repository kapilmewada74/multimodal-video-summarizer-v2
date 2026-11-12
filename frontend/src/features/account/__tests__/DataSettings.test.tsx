// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const signOut = vi.fn();
vi.mock("../../auth/AuthProvider", () => ({ useAuth: () => ({ signOut }) }));
const apiFetch = vi.fn();
vi.mock("../../../lib/api", () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  readError: async (_r: unknown, fallback: string) => fallback,
}));

import { DataSettings } from "../DataSettings";

let container: HTMLDivElement;
let root: Root;
const toast = vi.fn();
beforeEach(() => {
  signOut.mockReset().mockResolvedValue(undefined);
  apiFetch.mockReset();
  toast.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<DataSettings onToast={toast} />));
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const button = (label: string) => [...container.querySelectorAll("button")].find((b) => b.textContent?.includes(label)) as HTMLButtonElement;
const type = (value: string) => {
  const input = container.querySelector("#confirm-delete") as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => { setter.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
};

describe("DataSettings", () => {
  it("does not offer the delete button until the person opens the confirmation", () => {
    expect(container.querySelector("#confirm-delete")).toBeNull();
    expect(button("Delete everything")).toBeUndefined();
  });

  it("keeps Delete disabled until DELETE is typed exactly", () => {
    act(() => button("Delete my account").click());
    expect(button("Delete everything").disabled).toBe(true);
    type("delete");
    expect(button("Delete everything").disabled).toBe(true);
    type("DELETE");
    expect(button("Delete everything").disabled).toBe(false);
  });

  it("sends the confirmation, then signs out", async () => {
    apiFetch.mockResolvedValue({ ok: true });
    act(() => button("Delete my account").click());
    type("DELETE");
    await act(async () => button("Delete everything").click());
    expect(apiFetch).toHaveBeenCalledWith("/api/me", expect.objectContaining({ method: "DELETE", body: JSON.stringify({ confirm: "DELETE" }) }));
    expect(signOut).toHaveBeenCalled();
  });

  it("stays signed in and says so when deletion fails", async () => {
    apiFetch.mockResolvedValue({ ok: false });
    act(() => button("Delete my account").click());
    type("DELETE");
    await act(async () => button("Delete everything").click());
    expect(signOut).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith("Could not delete your account.", "error");
  });

  it("cancel closes the confirmation and clears what was typed", () => {
    act(() => button("Delete my account").click());
    type("DELETE");
    act(() => button("Cancel").click());
    expect(container.querySelector("#confirm-delete")).toBeNull();
    act(() => button("Delete my account").click());
    expect((container.querySelector("#confirm-delete") as HTMLInputElement).value).toBe("");
  });

  it("downloads the data file", async () => {
    apiFetch.mockResolvedValue({ ok: true, blob: async () => new Blob(["{}"]) });
    const create = vi.fn(() => "blob:x");
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: vi.fn() });
    await act(async () => button("Download my data").click());
    expect(apiFetch).toHaveBeenCalledWith("/api/me/export");
    expect(create).toHaveBeenCalled();
  });
});
