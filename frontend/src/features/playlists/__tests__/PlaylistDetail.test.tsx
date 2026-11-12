// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const apiFetch = vi.fn();
const uploadWithProgress = vi.fn();
vi.mock("../../../lib/api", () => ({
  apiFetch: (...a: unknown[]) => apiFetch(...a),
  readError: async (res: Response, fallback = "Something went wrong.") => {
    try { return (await res.clone().json()).message ?? fallback; } catch { return fallback; }
  },
}));
vi.mock("../../../lib/upload", () => ({
  uploadWithProgress: (...a: unknown[]) => uploadWithProgress(...a),
  uploadErrorMessage: (r: { body?: { message?: string } }) => r.body?.message ?? "The upload failed.",
}));
vi.mock("../../auth/AuthProvider", () => ({ useAuth: () => ({ ready: true, signedIn: true, configured: true }) }));
vi.mock("../../player/UploadedVideoPlayer", () => ({ UploadedVideoPlayer: () => <div>player</div> }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

import { PlaylistDetail } from "../PlaylistDetail";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const doc = (over = {}) => ({ id: "d1", video_id: null, playlist_item_id: "i1", filename: "Slides.pdf", extension: "pdf", mime: "application/pdf", size_bytes: 4096, has_text: true, text_status: "extracted", created_at: "2026-11-10T10:00:00Z", ...over });
const video = (over = {}) => ({ id: "i1", kind: "youtube", youtube_id: "abcdefghijk", upload_id: null, video_id: null, title: "Lecture 1", duration: 600, status: null, progress_seconds: 0, percent: 0, completed: false, document: null, documents: [], ...over });
const fileRow = (over = {}) => ({ id: "i2", kind: "document", youtube_id: null, upload_id: null, video_id: null, title: "Syllabus.docx", duration: 0, status: null, progress_seconds: 0, percent: 0, completed: false,
  document: { id: "d2", filename: "Syllabus.docx", extension: "docx", mime: "x", size_bytes: 8192, has_text: true }, documents: [], ...over });

let detail: { items: unknown[] };
let container: HTMLDivElement;
let root: Root;
const toast = vi.fn();

beforeEach(() => {
  apiFetch.mockReset();
  uploadWithProgress.mockReset();
  toast.mockReset();
  detail = { items: [video({ documents: [doc()] }), fileRow()] };
  apiFetch.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === "/api/playlists/p1" && !init?.method) return json({ id: "p1", title: "Course", source: "custom", updated_at: "x", item_count: detail.items.length, completed_count: 0, items: detail.items });
    if (url.startsWith("/api/videos")) return json({ items: [], total: 0 });
    if (url.endsWith("/view-url")) return json({ url: "/api/documents/d1/view?token=t", kind: "pdf" });
    if (url.endsWith("/text")) return json({ text: "Syllabus words" });
    if (init?.method === "DELETE") return new Response(null, { status: 204 });
    return json({});
  });
  uploadWithProgress.mockResolvedValue({ status: 201, body: {} });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

const mount = async () => {
  await act(async () => root.render(<PlaylistDetail playlistId="p1" onToast={toast} />));
  await act(async () => {});
};
const q = <T extends Element>(sel: string) => container.querySelector(sel) as T;
const byLabel = (label: string) => container.querySelector(`[aria-label="${label}"]`) as HTMLElement;
const file = (name: string, type = "application/pdf") => new File(["x"], name, { type });

function dropFiles(target: Element, files: File[]) {
  const dataTransfer = { types: ["Files"], files };
  for (const type of ["dragover", "drop"]) {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
    act(() => { target.dispatchEvent(event); });
  }
}

describe("files beside the videos", () => {
  it("shows a paperclip with the number of files on the right of each video, and file rows in the list", async () => {
    await mount();
    expect(byLabel("1 file for Lecture 1")).not.toBeNull();
    expect(container.textContent).toContain("Syllabus.docx");
    expect(container.querySelector("[aria-label='Drag to reorder Syllabus.docx']")).not.toBeNull(); // sorted like a video
    expect(container.textContent).toContain("2 items");
  });

  it("a video without files offers to add some", async () => {
    detail = { items: [video()] };
    await mount();
    expect(byLabel("Add files to Lecture 1")).not.toBeNull();
  });

  it("lists a lesson's files in a panel and opens one in the viewer", async () => {
    await mount();
    act(() => byLabel("1 file for Lecture 1").click());
    const panel = q("[role=dialog][aria-label='Files for Lecture 1']");
    expect(panel.textContent).toContain("Slides.pdf");
    expect(panel.textContent).toContain("4 KB");
    await act(async () => (byLabel("Open Slides.pdf") as HTMLButtonElement).click());
    await act(async () => {});
    expect(container.querySelector("iframe")!.getAttribute("src")).toContain("/view?token=");
    expect(container.querySelector("[role=dialog][aria-label='Viewing Slides.pdf']")).not.toBeNull();
  });

  it("opens a file row in the viewer (Word shows its text)", async () => {
    await mount();
    await act(async () => (byLabel("Open Syllabus.docx") as HTMLButtonElement).click());
    await act(async () => {});
    expect(container.querySelector("pre")!.textContent).toBe("Syllabus words");
  });

  it("adds files to a lesson through the panel, sending the lesson id", async () => {
    await mount();
    act(() => byLabel("1 file for Lecture 1").click());
    const input = byLabel("Choose files for Lecture 1") as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [file("Homework.pdf")], configurable: true });
    await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(uploadWithProgress).toHaveBeenCalledTimes(1);
    const [endpoint, form] = uploadWithProgress.mock.calls[0];
    expect(endpoint).toBe("/api/documents");
    expect((form as FormData).get("playlist_item_id")).toBe("i1");
    expect(((form as FormData).get("file") as File).name).toBe("Homework.pdf");
    expect(toast).toHaveBeenCalledWith("File added.", "success");
  });

  it("dropping files on a video row attaches them to that video", async () => {
    await mount();
    const row = byLabel("Drag to reorder Lecture 1").closest("li")!;
    dropFiles(row, [file("a.pdf"), file("b.docx", "application/msword")]);
    await act(async () => {});
    expect(uploadWithProgress).toHaveBeenCalledTimes(2);
    for (const [endpoint, form] of uploadWithProgress.mock.calls) {
      expect(endpoint).toBe("/api/documents");
      expect((form as FormData).get("playlist_item_id")).toBe("i1");
    }
  });

  it("dropping files on the list (not on a video) adds them as rows of their own", async () => {
    await mount();
    const list = container.querySelector("ul")!.parentElement!; // the drop area around the list
    dropFiles(list, [file("Reading list.pdf")]);
    await act(async () => {});
    expect(uploadWithProgress).toHaveBeenCalledTimes(1);
    expect(uploadWithProgress.mock.calls[0][0]).toBe("/api/playlists/p1/documents");
    expect(toast).toHaveBeenCalledWith("File added to the list.", "success");
  });

  it("the Add a document button adds rows of their own, and unsupported files are refused before upload", async () => {
    await mount();
    const input = byLabel("Choose documents to add to the list") as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [file("virus.exe"), file("ok.pdf")], configurable: true });
    await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(uploadWithProgress).toHaveBeenCalledTimes(1);
    expect(uploadWithProgress.mock.calls[0][0]).toBe("/api/playlists/p1/documents");
    expect(toast.mock.calls.some(([m, t]) => String(m).includes("virus.exe") && t === "error")).toBe(true);
  });

  it("shows the server's reason when an upload is refused", async () => {
    uploadWithProgress.mockResolvedValue({ status: 409, body: { message: "This file is already in the playlist." } });
    await mount();
    const input = byLabel("Choose documents to add to the list") as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [file("dup.pdf")], configurable: true });
    await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(toast).toHaveBeenCalledWith("This file is already in the playlist.", "error");
    expect(container.textContent).toContain("This file is already in the playlist.");
  });

  it("removing a file row asks first, because the file is deleted too", async () => {
    await mount();
    vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    await act(async () => (byLabel("Remove Syllabus.docx") as HTMLButtonElement).click());
    expect(apiFetch.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
    await act(async () => (byLabel("Remove Syllabus.docx") as HTMLButtonElement).click());
    expect(apiFetch.mock.calls.some(([u, init]) => u === "/api/playlists/p1/items/i2" && init?.method === "DELETE")).toBe(true);
    expect(container.textContent).not.toContain("Syllabus.docx");
  });

  it("deleting a lesson's file asks first and refreshes the list", async () => {
    await mount();
    act(() => byLabel("1 file for Lecture 1").click());
    vi.spyOn(window, "confirm").mockReturnValue(true);
    await act(async () => (byLabel("Delete Slides.pdf") as HTMLButtonElement).click());
    expect(apiFetch.mock.calls.some(([u, init]) => u === "/api/documents/d1" && init?.method === "DELETE")).toBe(true);
  });
});
