// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const apiFetch = vi.fn();
vi.mock("../../../lib/api", () => ({
  apiFetch: (...a: unknown[]) => apiFetch(...a),
  readError: async (res: Response, fallback = "Something went wrong.") => {
    try { return (await res.clone().json()).message ?? fallback; } catch { return fallback; }
  },
}));

import { DocumentViewer } from "../DocumentViewer";
import { FileBadge } from "../FileBadge";
import { KIND_STYLE, canShowInline, documentKind } from "../files";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
let container: HTMLDivElement;
let root: Root;
const onClose = vi.fn();

beforeEach(() => {
  apiFetch.mockReset();
  onClose.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.style.overflow = "";
});

const file = (name: string, ext: string) => ({ id: "d1", filename: name, extension: ext, size_bytes: 2048 });
const open = async (f: ReturnType<typeof file>) => {
  await act(async () => root.render(<DocumentViewer file={f} onClose={onClose} />));
  await act(async () => {});
};

describe("DocumentViewer", () => {
  it("shows a PDF in the page with the signed address, and offers a new tab and the original", async () => {
    apiFetch.mockResolvedValue(json({ url: "/api/documents/d1/view?token=t", kind: "pdf" }));
    await open(file("Chapter 1.pdf", "pdf"));
    const frame = container.querySelector("iframe")!;
    expect(frame.getAttribute("src")).toBe("/api/documents/d1/view?token=t");
    expect(frame.getAttribute("title")).toBe("Chapter 1.pdf");
    expect(container.querySelector("[aria-label='Open in a new tab']")).not.toBeNull();
    expect(container.querySelector("[aria-label='Download the original']")).not.toBeNull();
    expect(container.textContent).toContain("2 KB");
  });

  it("offers a way out when the browser cannot show a PDF inside the page: a new tab, or the text", async () => {
    apiFetch.mockImplementation(async (url: string) =>
      url.endsWith("/view-url") ? json({ url: "/api/documents/d1/view?token=t", kind: "pdf" }) : json({ text: "pdf words" }));
    await open(file("a.pdf", "pdf"));
    const link = [...container.querySelectorAll("a")].find((a) => a.textContent?.includes("new tab"))!;
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    await act(async () => ([...container.querySelectorAll("button")].find((b) => b.textContent === "Show its text") as HTMLButtonElement).click());
    expect(container.querySelector("pre")!.textContent).toBe("pdf words");
    expect(container.querySelector("iframe")).toBeNull();
  });

  it("shows a picture with its name as the alt text", async () => {
    apiFetch.mockResolvedValue(json({ url: "/api/documents/d1/view?token=t", kind: "image" }));
    await open(file("diagram.png", "png"));
    const img = container.querySelector("img")!;
    expect(img.getAttribute("alt")).toBe("diagram.png");
    expect(img.getAttribute("src")).toContain("/view?token=");
  });

  it("shows the text of Word, slides and sheets with an honest note about the layout", async () => {
    for (const [name, ext, note] of [["essay.docx", "docx", "Word"], ["deck.pptx", "pptx", "Slides"], ["data.xlsx", "xlsx", "Spreadsheets"]] as const) {
      apiFetch.mockReset();
      apiFetch.mockResolvedValue(json({ text: `Words from ${name}` }));
      await open(file(name, ext));
      expect(container.querySelector("pre")!.textContent).toBe(`Words from ${name}`);
      expect(container.textContent).toContain(note);
      expect(apiFetch.mock.calls[0][0]).toBe("/api/documents/d1/text"); // never asks for an inline link for these
    }
  });

  it("falls back to the text when the server says a file cannot be shown inline", async () => {
    apiFetch.mockImplementation(async (url: string) =>
      url.endsWith("/view-url") ? json({ code: "not_viewable", message: "no" }, 415) : json({ text: "fallback words" }));
    await open(file("odd.pdf", "pdf"));
    expect(container.querySelector("pre")!.textContent).toBe("fallback words");
  });

  it("says plainly when there is nothing to show, and still offers the download", async () => {
    apiFetch.mockResolvedValue(json({ text: "   " }));
    await open(file("old.doc", "doc"));
    expect(container.textContent).toContain("cannot be shown here");
    expect(container.querySelector("pre")).toBeNull();
    expect([...container.querySelectorAll("button")].some((b) => b.textContent?.includes("Download"))).toBe(true);
  });

  it("shows an error message if the file cannot be opened", async () => {
    apiFetch.mockResolvedValue(json({ message: "Document not found." }, 404));
    await open(file("gone.pdf", "pdf"));
    expect(container.querySelector("[role=alert]")!.textContent).toBe("Document not found.");
  });

  it("closes with Escape, the close button and a click outside; and keeps the page from scrolling behind it", async () => {
    apiFetch.mockResolvedValue(json({ text: "x" }));
    await open(file("a.txt", "txt"));
    expect(document.body.style.overflow).toBe("hidden");
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(onClose).toHaveBeenCalledTimes(1);
    act(() => (container.querySelector("[aria-label='Close']") as HTMLButtonElement).click());
    expect(onClose).toHaveBeenCalledTimes(2);
    const backdrop = container.querySelector("[role=dialog]")!.parentElement!;
    act(() => backdrop.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
    expect(onClose).toHaveBeenCalledTimes(3);
    act(() => root.unmount());
    expect(document.body.style.overflow).toBe("");
    root = createRoot(container);
  });

  it("is a labelled modal dialog", async () => {
    apiFetch.mockResolvedValue(json({ text: "x" }));
    await open(file("a.txt", "txt"));
    const dialog = container.querySelector("[role=dialog]")!;
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-label")).toBe("Viewing a.txt");
  });
});

describe("file kinds", () => {
  it("recognises every supported extension and tells what a browser can show itself", () => {
    expect(documentKind("PDF")).toBe("pdf");
    expect(["doc", "docx", "odt", "rtf"].map(documentKind)).toEqual(["word", "word", "word", "word"]);
    expect(["ppt", "pptx", "odp"].map(documentKind)).toEqual(["slides", "slides", "slides"]);
    expect(["xls", "xlsx", "ods", "csv"].map(documentKind)).toEqual(["sheet", "sheet", "sheet", "sheet"]);
    expect(["pdf", "png", "jpg", "jpeg", "gif", "webp", ".PNG"].every(canShowInline)).toBe(true);
    expect(["docx", "txt", "svg", "html", "exe"].some(canShowInline)).toBe(false);
  });

  it("gives each kind its own colour and label", () => {
    const labels = Object.values(KIND_STYLE).map((k) => k.label);
    expect(new Set(["PDF", "DOC", "PPT", "XLS", "IMG"]).size).toBe(5);
    expect(labels).toEqual(expect.arrayContaining(["PDF", "DOC", "PPT", "XLS", "IMG"]));
    act(() => root.render(<FileBadge extension="pdf" />));
    expect(container.querySelector("[data-testid=file-badge]")!.textContent).toBe("PDF");
  });
});
