// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setTokenProvider } from "../api";
import { uploadErrorMessage, uploadWithProgress } from "../upload";

class FakeXhr {
  static last: FakeXhr;
  headers: Record<string, string> = {};
  upload: { onprogress?: (e: { lengthComputable: boolean; loaded: number; total: number }) => void } = {};
  onload?: () => void; onerror?: () => void; onabort?: () => void;
  responseText = ""; status = 200; method = ""; url = ""; sent: unknown = null; aborted = false;
  open(method: string, url: string) { this.method = method; this.url = url; FakeXhr.last = this; }
  setRequestHeader(name: string, value: string) { this.headers[name] = value; }
  send(body: unknown) { this.sent = body; }
  abort() { this.aborted = true; this.onabort?.(); }
}

beforeEach(() => {
  vi.stubGlobal("XMLHttpRequest", FakeXhr);
  setTokenProvider({ getToken: async () => "tok123" });
});
afterEach(() => {
  vi.unstubAllGlobals();
  setTokenProvider({ getToken: async () => null });
});

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("uploadWithProgress", () => {
  it("sends the file with the sign-in token and reports progress", async () => {
    const progress: number[] = [];
    const form = new FormData();
    form.append("file", new Blob(["x"]), "a.txt");
    const promise = uploadWithProgress("/api/documents", form, (f) => progress.push(f));
    await flush();
    const xhr = FakeXhr.last;
    expect(xhr.method).toBe("POST");
    expect(xhr.url).toBe("/api/documents");
    expect(xhr.headers.Authorization).toBe("Bearer tok123");
    expect(xhr.sent).toBe(form);
    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 25, total: 100 });
    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 500, total: 100 }); // never above 100%
    xhr.upload.onprogress?.({ lengthComputable: false, loaded: 1, total: 0 });    // ignored
    xhr.responseText = '{"id":"d1"}';
    xhr.status = 201;
    xhr.onload?.();
    expect(await promise).toEqual({ status: 201, body: { id: "d1" } });
    expect(progress).toEqual([0.25, 1, 1]);
  });

  it("works without a token", async () => {
    setTokenProvider({ getToken: async () => null });
    const promise = uploadWithProgress("/x", new FormData(), () => undefined);
    await flush();
    expect(FakeXhr.last.headers.Authorization).toBeUndefined();
    FakeXhr.last.onload?.();
    await promise;
  });

  it("hands back error responses so their message can be shown", async () => {
    const promise = uploadWithProgress("/x", new FormData(), () => undefined);
    await flush();
    FakeXhr.last.status = 400;
    FakeXhr.last.responseText = '{"code":"unsupported_format","message":"This file type is not supported."}';
    FakeXhr.last.onload?.();
    const result = await promise;
    expect(result.status).toBe(400);
    expect(uploadErrorMessage(result)).toBe("This file type is not supported.");
  });

  it("copes with a response that is not JSON", async () => {
    const promise = uploadWithProgress("/x", new FormData(), () => undefined);
    await flush();
    FakeXhr.last.status = 502;
    FakeXhr.last.responseText = "<html>Bad gateway</html>";
    FakeXhr.last.onload?.();
    const result = await promise;
    expect(result.body).toBeNull();
    expect(uploadErrorMessage(result, "Custom")).toBe("Custom");
  });

  it("rejects on a network failure", async () => {
    const promise = uploadWithProgress("/x", new FormData(), () => undefined);
    await flush();
    FakeXhr.last.onerror?.();
    await expect(promise).rejects.toThrow(/could not be completed/);
  });

  it("can be cancelled", async () => {
    const controller = new AbortController();
    const promise = uploadWithProgress("/x", new FormData(), () => undefined, controller.signal);
    await flush();
    controller.abort();
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    expect(FakeXhr.last.aborted).toBe(true);
  });

  it("does not even start if already cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    const promise = uploadWithProgress("/x", new FormData(), () => undefined, controller.signal);
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
  });

  it("explains common failures", () => {
    expect(uploadErrorMessage({ status: 413, body: null })).toBe("That file is too large.");
    expect(uploadErrorMessage({ status: 401, body: null })).toMatch(/sign in/i);
    expect(uploadErrorMessage({ status: 500, body: { detail: "Something broke" } })).toBe("Something broke");
    expect(uploadErrorMessage({ status: 500, body: null })).toMatch(/failed/);
  });
});
