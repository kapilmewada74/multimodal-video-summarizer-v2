import { describe, expect, it } from "vitest";
import {
  DOCUMENT_ACCEPT, DOCUMENT_EXTENSIONS, documentKind, extensionOf, formatBytes, storagePercent, validateFile, VIDEO_ACCEPT, VIDEO_EXTENSIONS,
} from "../files";

describe("file helpers", () => {
  it.each([["report.PDF", "pdf"], ["a.b.docx", "docx"], ["noext", ""], [".hidden", ""], ["trailing.", ""], ["x.tar.gz", "gz"]])(
    "extension of %s", (name, ext) => expect(extensionOf(name)).toBe(ext));

  it.each([
    ["pdf", "pdf"], [".PDF", "pdf"], ["docx", "word"], ["rtf", "word"], ["pptx", "slides"], ["odp", "slides"], ["xlsx", "sheet"], ["csv", "sheet"],
    ["txt", "text"], ["md", "text"], ["png", "image"], ["webp", "image"], ["exe", "other"], ["", "other"],
  ])("kind of %s", (ext, kind) => expect(documentKind(ext)).toBe(kind));

  it.each([[0, "0 B"], [999, "999 B"], [1024, "1 KB"], [1536, "1.5 KB"], [20 * 1024, "20 KB"], [5 * 1024 * 1024, "5 MB"], [2.5 * 1024 ** 3, "2.5 GB"], [-1, ""], [NaN, ""]])(
    "formats %s bytes", (n, text) => expect(formatBytes(n)).toBe(text));

  it("checks a file before uploading", () => {
    const max = 25 * 1024 * 1024;
    expect(validateFile({ name: "notes.pdf", size: 1000 }, DOCUMENT_EXTENSIONS, max)).toBeNull();
    expect(validateFile({ name: "Notes.DOCX", size: 1000 }, DOCUMENT_EXTENSIONS, max)).toBeNull();
    expect(validateFile({ name: "virus.exe", size: 1000 }, DOCUMENT_EXTENSIONS, max)).toMatch(/not a supported/);
    expect(validateFile({ name: "noext", size: 1000 }, DOCUMENT_EXTENSIONS, max)).toMatch(/not a supported/);
    expect(validateFile({ name: "movie.mp4", size: 1000 }, DOCUMENT_EXTENSIONS, max)).toMatch(/not a supported/);
    expect(validateFile({ name: "empty.pdf", size: 0 }, DOCUMENT_EXTENSIONS, max)).toMatch(/empty/);
    expect(validateFile({ name: "big.pdf", size: max + 1 }, DOCUMENT_EXTENSIONS, max)).toMatch(/limit is 25 MB/);
    expect(validateFile({ name: "clip.mp4", size: 10 }, VIDEO_EXTENSIONS, max)).toBeNull();
    expect(validateFile({ name: "doc.pdf", size: 10 }, VIDEO_EXTENSIONS, max)).toMatch(/not a supported/);
  });

  it("offers the same types to the file picker", () => {
    expect(DOCUMENT_ACCEPT.split(",")).toHaveLength(DOCUMENT_EXTENSIONS.length);
    expect(DOCUMENT_ACCEPT).toContain(".pptx");
    expect(VIDEO_ACCEPT).toContain(".mp4");
    expect(VIDEO_ACCEPT).toContain("video/*");
  });

  it("never lists dangerous types", () => {
    for (const bad of ["exe", "html", "htm", "svg", "js", "sh", "bat", "zip", "php", "jar", "docm", "xlsm"]) {
      expect(DOCUMENT_EXTENSIONS).not.toContain(bad);
      expect(VIDEO_EXTENSIONS).not.toContain(bad);
    }
  });

  it("describes how full the storage is", () => {
    expect(storagePercent(512, 1024)).toBe(50);
    expect(storagePercent(5000, 1024)).toBe(100);
    expect(storagePercent(0, 0)).toBe(0);
  });
});
