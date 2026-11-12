// @vitest-environment jsdom
import React, { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PresentationData } from "../../../components/PresentationView";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const apiFetch = vi.fn();
vi.mock("../../../lib/api", () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  readError: async (res: Response, fallback = "Something went wrong.") => {
    try { return (await res.clone().json()).message ?? fallback; } catch { return fallback; }
  },
}));
vi.mock("../../study/activity", () => ({ markActivity: () => {} }));

import { SummaryEditor } from "../SummaryEditor";
import { SlidesEditor } from "../SlidesEditor";
import { useEdit } from "../useEdit";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** A tiny in-memory copy of the server for one edit. */
function server(initial: unknown = null) {
  const state = { content: initial as unknown, updatedAt: initial ? "t0" : (null as string | null), versions: [] as Array<{ id: string; created_at: string; content: unknown }>, puts: [] as unknown[], conflict: false };
  let n = 0;
  apiFetch.mockImplementation(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (url.includes("/versions/") && url.endsWith("/restore")) {
      const v = state.versions.find((x) => url.includes(x.id))!;
      if (state.content) state.versions.unshift({ id: `v${++n}`, created_at: "2026-11-10T10:00:00Z", content: state.content });
      state.content = v.content; state.updatedAt = `t${++n}`;
      return json({ content: state.content, updated_at: state.updatedAt });
    }
    if (method === "PUT") {
      if (state.conflict) return json({ code: "edit_conflict", message: "changed" }, 409);
      const body = JSON.parse(init!.body as string);
      state.puts.push(body);
      if (state.content) state.versions.unshift({ id: `v${++n}`, created_at: "2026-11-10T10:00:00Z", content: state.content });
      state.content = body.content; state.updatedAt = `t${++n}`;
      return json({ updated_at: state.updatedAt, changed: true });
    }
    if (method === "DELETE") {
      if (state.content) state.versions.unshift({ id: `v${++n}`, created_at: "2026-11-10T10:00:00Z", content: state.content });
      state.content = null; state.updatedAt = null;
      return new Response(null, { status: 204 });
    }
    return json({ content: state.content, updated_at: state.updatedAt, versions: state.versions.map(({ id, created_at }) => ({ id, created_at })) });
  });
  return state;
}

let container: HTMLDivElement;
let root: Root;
const toast = vi.fn();
const flush = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(2000); }); };
const settle = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(50); }); };

function type(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}
const q = <T extends Element>(sel: string) => container.querySelector(sel) as T;
const buttonByText = (text: string) => [...container.querySelectorAll("button")].find((b) => b.textContent?.includes(text)) as HTMLButtonElement;

beforeEach(() => {
  vi.useFakeTimers();
  apiFetch.mockReset();
  toast.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

function SummaryHarness() {
  const state = useEdit<{ markdown: string }>("v1", "summary", { markdown: "AI text" });
  const [done, setDone] = useState(false);
  return done ? <p>closed</p> : <SummaryEditor aiText="AI text" state={state} onDone={() => setDone(true)} onToast={toast} />;
}

describe("SummaryEditor", () => {
  it("starts from the AI text and saves nothing until you change it", async () => {
    const s = server();
    await act(async () => root.render(<SummaryHarness />));
    await settle();
    expect(q<HTMLTextAreaElement>("#summary-editor").value).toBe("AI text");
    await flush();
    expect(s.puts).toHaveLength(0);
  });

  it("autosaves after you stop typing, with the version it was based on", async () => {
    const s = server({ markdown: "mine" });
    await act(async () => root.render(<SummaryHarness />));
    await settle();
    expect(q<HTMLTextAreaElement>("#summary-editor").value).toBe("mine");
    await act(async () => type(q("#summary-editor"), "mine, edited"));
    expect(container.textContent).toContain("Unsaved changes");
    await flush();
    expect(s.puts).toEqual([{ content: { markdown: "mine, edited" }, base_updated_at: "t0" }]);
    expect(container.textContent).toContain("Saved");
    expect(buttonByText("History (1)")).toBeTruthy();
  });

  it("shows a live preview of the Markdown", async () => {
    server();
    await act(async () => root.render(<SummaryHarness />));
    await settle();
    await act(async () => type(q("#summary-editor"), "## Heading"));
    expect(q("[aria-label=Preview]").innerHTML).toContain("<h2");
  });

  it("restores an earlier version and can go back to the AI version", async () => {
    const s = server({ markdown: "second" });
    s.versions.push({ id: "old", created_at: "2026-11-09T10:00:00Z", content: { markdown: "first" } });
    await act(async () => root.render(<SummaryHarness />));
    await settle();
    await act(async () => buttonByText("History").click());
    await act(async () => buttonByText("Restore").click());
    await settle();
    expect(q<HTMLTextAreaElement>("#summary-editor").value).toBe("first");
    expect(toast).toHaveBeenCalledWith("Version restored.", "success");

    await act(async () => buttonByText("History").click());
    await act(async () => buttonByText("Back to the AI version").click());
    await settle();
    expect(q<HTMLTextAreaElement>("#summary-editor").value).toBe("AI text");
    expect(s.content).toBeNull();
  });

  it("stops saving and says so when another tab saved newer text", async () => {
    const s = server({ markdown: "mine" });
    await act(async () => root.render(<SummaryHarness />));
    await settle();
    s.conflict = true;
    await act(async () => type(q("#summary-editor"), "mine!"));
    await flush();
    expect(container.textContent).toContain("Changed in another tab");
    expect(q<HTMLTextAreaElement>("#summary-editor").disabled).toBe(true);
  });

  it("Done saves pending text first", async () => {
    const s = server({ markdown: "mine" });
    await act(async () => root.render(<SummaryHarness />));
    await settle();
    await act(async () => type(q("#summary-editor"), "last words"));
    await act(async () => buttonByText("Done").click());
    await settle();
    expect(s.puts).toHaveLength(1);
    expect(container.textContent).toContain("closed");
  });
});

const AI: PresentationData = {
  title: "Deck",
  slides: [
    { title: "One", bullets: ["a", "b"], layout: "split_left_image", notes: "" },
    { title: "Two", bullets: ["c"], layout: "cards_right", notes: "" },
  ],
};

function SlidesHarness() {
  const state = useEdit<PresentationData>("v1", "slides", AI);
  return <SlidesEditor ai={AI} state={state} onDone={() => {}} onToast={toast} />;
}

describe("SlidesEditor", () => {
  it("edits a title and saves the whole deck", async () => {
    const s = server();
    await act(async () => root.render(<SlidesHarness />));
    await settle();
    await act(async () => type(q("input[maxlength='200']"), "Intro"));
    await flush();
    const saved = s.content as PresentationData;
    expect(saved.slides.map((x) => x.title)).toEqual(["Intro", "Two"]);
    expect(saved.slides[0].bullets).toEqual(["a", "b"]);
  });

  it("adds, reorders and deletes slides", async () => {
    const s = server();
    await act(async () => root.render(<SlidesHarness />));
    await settle();
    await act(async () => buttonByText("Add slide").click());
    await flush();
    expect((s.content as PresentationData).slides.map((x) => x.title)).toEqual(["One", "New slide", "Two"]);
    await act(async () => (q("[aria-label='Move slide up']") as HTMLButtonElement).click());
    await flush();
    expect((s.content as PresentationData).slides.map((x) => x.title)).toEqual(["New slide", "One", "Two"]);
    await act(async () => (q("[aria-label='Delete slide']") as HTMLButtonElement).click());
    await flush();
    expect((s.content as PresentationData).slides.map((x) => x.title)).toEqual(["One", "Two"]);
  });

  it("does not save a slide without a title, and says why", async () => {
    const s = server();
    await act(async () => root.render(<SlidesHarness />));
    await settle();
    await act(async () => type(q("input[maxlength='200']"), ""));
    await flush();
    expect(s.puts).toHaveLength(0);
    expect(container.textContent).toContain("Slide 1 needs a title.");
    expect(q<HTMLInputElement>("input[maxlength='200']").value).toBe(""); // what you typed stays
    await act(async () => type(q("input[maxlength='200']"), "Fixed"));
    await flush();
    expect(s.puts).toHaveLength(1);
  });

  it("edits bullets", async () => {
    const s = server();
    await act(async () => root.render(<SlidesHarness />));
    await settle();
    await act(async () => type(q("[aria-label='Bullet 2']"), "bee"));
    await act(async () => (q("[aria-label='Remove bullet 1']") as HTMLButtonElement).click());
    await flush();
    expect((s.content as PresentationData).slides[0].bullets).toEqual(["bee"]);
  });
});
