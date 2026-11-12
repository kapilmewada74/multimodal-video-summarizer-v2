// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentItem } from "../../../lib/types";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const apiFetch = vi.fn();
const uploadWithProgress = vi.fn();
vi.mock("../../../lib/api", () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  readError: async (res: Response, fallback = "Something went wrong.") => {
    try { return (await res.clone().json()).message ?? fallback; } catch { return fallback; }
  },
}));
vi.mock("../../../lib/upload", () => ({
  uploadWithProgress: (...args: unknown[]) => uploadWithProgress(...args),
  uploadErrorMessage: (r: { body?: { message?: string } }) => r.body?.message ?? "The upload failed.",
}));
vi.mock("../../auth/AuthProvider", () => ({ useAuth: () => ({ ready: true, signedIn: true, configured: true }) }));

import { DocumentRow, DocumentsManager } from "../DocumentsManager";

const doc = (over: Partial<DocumentItem> = {}): DocumentItem => ({
  id: "d1", video_id: null, filename: "Chapter 1.pdf", extension: "pdf", mime: "application/pdf", size_bytes: 2048,
  has_text: true, text_status: "extracted", created_at: "2026-11-10T10:00:00Z", ...over,
});
const storage = { used_bytes: 4096, quota_bytes: 1024 * 1024, max_document_bytes: 25 * 1024 * 1024 };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

let container: HTMLDivElement;
let root: Root;
const toast = vi.fn();

beforeEach(() => {
  apiFetch.mockReset();
  uploadWithProgress.mockReset();
  toast.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

function routes(docs: DocumentItem[]) {
  apiFetch.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.startsWith("/api/documents?")) return json({ items: docs, total: docs.length, storage });
    if (url.startsWith("/api/videos")) return json({ items: [{ id: "v1", title: "Gradient Descent", status: "ready" }], total: 1 });
    if (url.endsWith("/download-url")) return json({ url: "/api/documents/d1/file?token=t", expires_in: 600 });
    if (init?.method === "PATCH" || init?.method === "DELETE") return init.method === "DELETE" ? new Response(null, { status: 204 }) : json(docs[0]);
    return json({});
  });
}
const mount = async (props: { videoId?: string } = {}) => {
  await act(async () => { root.render(<DocumentsManager onToast={toast} {...props} />); });
  await act(async () => { await Promise.resolve(); });
};
const fileInput = () => container.querySelector('input[type="file"]') as HTMLInputElement;
async function choose(files: File[]) {
  Object.defineProperty(fileInput(), "files", { configurable: true, value: files });
  await act(async () => { fileInput().dispatchEvent(new Event("change", { bubbles: true })); });
  await act(async () => { await Promise.resolve(); });
}
const file = (name: string, size = 10) => new File([new Uint8Array(size)], name);

describe("DocumentsManager", () => {
  it("lists the documents of a video and attaches new ones to it", async () => {
    routes([doc()]);
    await mount({ videoId: "v1" });
    expect(apiFetch.mock.calls[0][0]).toContain("video_id=v1");
    expect(container.textContent).toContain("Chapter 1.pdf");
    expect(container.textContent).toContain("2 KB");
    expect(container.textContent).toContain("Text read");
    expect(container.textContent).toContain("Documents for this video");
    expect(container.textContent).toContain("They will be attached to this video");
  });

  it("shows an empty state and the storage meter", async () => {
    routes([]);
    await mount({ videoId: "v1" });
    expect(container.textContent).toContain("No documents yet");
    expect(container.querySelector('[aria-label="Storage used"]')?.textContent).toContain("4 KB of 1 MB");
  });

  it("refuses unsupported, empty and oversized files before sending anything", async () => {
    routes([]);
    await mount({ videoId: "v1" });
    const huge = { name: "huge.pdf", size: 26 * 1024 * 1024 } as unknown as File; // rejected before anything is read or sent
    await choose([file("virus.exe"), file("empty.pdf", 0), huge]);
    expect(uploadWithProgress).not.toHaveBeenCalled();
    const messages = toast.mock.calls.map((c) => c[0]).join("|");
    expect(messages).toMatch(/not a supported file type/);
    expect(messages).toMatch(/empty/);
    expect(messages).toMatch(/limit is 25 MB/);
  });

  it("uploads a file with the video it belongs to and refreshes the list", async () => {
    routes([]);
    uploadWithProgress.mockImplementation(async (_url: string, _form: FormData, onProgress: (n: number) => void) => {
      onProgress(0.5);
      return { status: 201, body: { id: "new" } };
    });
    await mount({ videoId: "v1" });
    await choose([file("notes.pdf", 50)]);
    expect(uploadWithProgress).toHaveBeenCalledOnce();
    const [url, form] = uploadWithProgress.mock.calls[0] as [string, FormData];
    expect(url).toBe("/api/documents");
    expect((form.get("file") as File).name).toBe("notes.pdf");
    expect(form.get("video_id")).toBe("v1");
    expect(toast).toHaveBeenCalledWith("Uploaded notes.pdf.", "success");
    expect(apiFetch.mock.calls.filter((c) => String(c[0]).startsWith("/api/documents?")).length).toBeGreaterThanOrEqual(2);
  });

  it("does not send a video id when uploading a standalone document", async () => {
    routes([]);
    uploadWithProgress.mockResolvedValue({ status: 201, body: {} });
    await mount();
    await choose([file("loose.txt")]);
    expect((uploadWithProgress.mock.calls[0][1] as FormData).has("video_id")).toBe(false);
  });

  it("shows the server's reason when an upload is rejected, and lets you dismiss it", async () => {
    routes([]);
    uploadWithProgress.mockResolvedValue({ status: 400, body: { message: "This file does not look like a real PDF file." } });
    await mount({ videoId: "v1" });
    await choose([file("fake.pdf")]);
    expect(container.querySelector('[aria-label="Uploads in progress"]')?.textContent).toContain("does not look like a real PDF");
    expect(toast).toHaveBeenCalledWith("This file does not look like a real PDF file.", "error");
    await act(async () => { (container.querySelector('button[aria-label="Dismiss fake.pdf"]') as HTMLButtonElement).click(); });
    expect(container.querySelector('[aria-label="Uploads in progress"]')).toBeNull();
  });

  it("reports a network failure", async () => {
    routes([]);
    uploadWithProgress.mockRejectedValue(new Error("The upload could not be completed."));
    await mount({ videoId: "v1" });
    await choose([file("a.pdf")]);
    expect(toast).toHaveBeenCalledWith("The upload could not be completed.", "error");
  });

  it("downloads through a temporary link", async () => {
    routes([doc()]);
    const clicked: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { clicked.push(this.getAttribute("href") ?? ""); });
    await mount({ videoId: "v1" });
    await act(async () => { (container.querySelector('button[aria-label="Download Chapter 1.pdf"]') as HTMLButtonElement).click(); });
    await act(async () => { await Promise.resolve(); });
    expect(apiFetch.mock.calls.some((c) => c[0] === "/api/documents/d1/download-url")).toBe(true);
    expect(clicked).toEqual(["/api/documents/d1/file?token=t"]);
  });

  it("asks before deleting, then deletes", async () => {
    routes([doc()]);
    const confirm = vi.spyOn(window, "confirm");
    await mount({ videoId: "v1" });
    confirm.mockReturnValueOnce(false);
    await act(async () => { (container.querySelector('button[aria-label="Delete Chapter 1.pdf"]') as HTMLButtonElement).click(); });
    expect(apiFetch.mock.calls.some((c) => (c[1] as RequestInit | undefined)?.method === "DELETE")).toBe(false);
    confirm.mockReturnValueOnce(true);
    await act(async () => { (container.querySelector('button[aria-label="Delete Chapter 1.pdf"]') as HTMLButtonElement).click(); });
    expect(apiFetch.mock.calls.some((c) => c[0] === "/api/documents/d1" && (c[1] as RequestInit).method === "DELETE")).toBe(true);
  });

  it("renames a document", async () => {
    routes([doc()]);
    vi.spyOn(window, "prompt").mockReturnValue("  Final notes ");
    await mount({ videoId: "v1" });
    await act(async () => { (container.querySelector('button[aria-label="Rename Chapter 1.pdf"]') as HTMLButtonElement).click(); });
    const patch = apiFetch.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === "PATCH")!;
    expect(JSON.parse((patch[1] as RequestInit).body as string)).toEqual({ filename: "Final notes" });
  });

  it("detaches a document from the video it is shown on", async () => {
    routes([doc({ video_id: "v1" })]);
    await mount({ videoId: "v1" });
    await act(async () => { (container.querySelector('button[aria-label="Detach Chapter 1.pdf from this video"]') as HTMLButtonElement).click(); });
    const patch = apiFetch.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === "PATCH")!;
    expect(JSON.parse((patch[1] as RequestInit).body as string)).toEqual({ video_id: null });
  });

  it("on the documents page, attaches a standalone document to a video and filters the list", async () => {
    routes([doc()]);
    await mount();
    expect(container.textContent).toContain("Your documents");
    const select = container.querySelector("li select") as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(["Not attached to a video", "Gradient Descent"]);
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(select, "v1");
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const patch = apiFetch.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === "PATCH")!;
    expect(JSON.parse((patch[1] as RequestInit).body as string)).toEqual({ video_id: "v1" });
    await act(async () => { (Array.from(container.querySelectorAll('[role="tab"]')).find((t) => /Not attached/.test(t.textContent ?? "")) as HTMLElement).click(); });
    expect(apiFetch.mock.calls.some((c) => String(c[0]).includes("standalone=true"))).toBe(true);
  });
});

describe("DocumentRow", () => {
  const noop = () => undefined;
  const html = (d: DocumentItem) => renderToStaticMarkup(<ul><DocumentRow doc={d} videos={[]} onDownload={noop} onRename={noop} onDelete={noop} onAttach={noop} showAttach={false} /></ul>);

  it("shows the name, size and type", () => {
    const out = html(doc());
    expect(out).toContain("Chapter 1.pdf");
    expect(out).toContain("2 KB");
    expect(out).toContain("pdf");
  });
  it("tells when the text could not be read", () => {
    expect(html(doc({ has_text: false, text_status: "failed" }))).toContain("Could not read the text");
    expect(html(doc({ has_text: false, text_status: "none" }))).not.toContain("Text read");
  });
  it("never puts a filename into markup unescaped", () => {
    const out = html(doc({ filename: '"><img src=x onerror=alert(1)>.pdf' }));
    expect(out).not.toContain("<img");
  });
});
