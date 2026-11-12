import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** Runs public/sw.js against a fake service-worker scope. */
function loadWorker() {
  const handlers: Record<string, (e: unknown) => void> = {};
  const shown: { title: string; options: { body: string; data: { url: string } } }[] = [];
  const opened: string[] = [];
  const navigated: string[] = [];
  const self = {
    location: { origin: "https://app.example.com" },
    addEventListener: (name: string, fn: (e: unknown) => void) => { handlers[name] = fn; },
    registration: { showNotification: (title: string, options: { body: string; data: { url: string } }) => { shown.push({ title, options }); return Promise.resolve(); } },
    clients: {
      matchAll: () => Promise.resolve(self.windows),
      openWindow: (url: string) => { opened.push(url); return Promise.resolve(); },
    },
    windows: [] as unknown[],
  };
  const code = readFileSync(join(__dirname, "../../../../public/sw.js"), "utf8");
  new Function("self", "URL", code)(self, URL);
  const push = async (payload: unknown, raw = false) => {
    const waits: Promise<unknown>[] = [];
    handlers.push({
      data: { json: () => { if (raw) throw new Error("not json"); return payload; }, text: () => String(payload) },
      waitUntil: (p: Promise<unknown>) => waits.push(p),
    });
    await Promise.all(waits);
  };
  const click = async (url?: string) => {
    const waits: Promise<unknown>[] = [];
    let closed = false;
    handlers.notificationclick({
      notification: { close: () => { closed = true; }, data: url === undefined ? undefined : { url } },
      waitUntil: (p: Promise<unknown>) => waits.push(p),
    });
    await Promise.all(waits);
    return closed;
  };
  return { self, shown, opened, navigated, push, click };
}

describe("push service worker", () => {
  it("shows the title and text it is sent", async () => {
    const w = loadWorker();
    await w.push({ title: "Goal reached", body: "You studied 30 minutes", url: "/study" });
    expect(w.shown[0].title).toBe("Goal reached");
    expect(w.shown[0].options.body).toBe("You studied 30 minutes");
    expect(w.shown[0].options.data.url).toBe("/study");
  });

  it.each(["https://evil.example/phish", "//evil.example", "javascript:alert(1)", "study", "", 42, null])(
    "never links to a non-local address: %s",
    async (url) => {
      const w = loadWorker();
      await w.push({ title: "T", url });
      expect(w.shown[0].options.data.url).toBe("/");
    },
  );

  it("copes with a plain-text or empty message", async () => {
    const w = loadWorker();
    await w.push("Plain words", true);
    expect(w.shown[0].title).toBe("Summarize");
    expect(w.shown[0].options.body).toBe("Plain words");
    await w.push({});
    expect(w.shown[1].title).toBe("Summarize");
  });

  it("opens the link when clicked, reusing an open window if there is one", async () => {
    const w = loadWorker();
    expect(await w.click("/video/123")).toBe(true);
    expect(w.opened).toEqual(["https://app.example.com/video/123"]);

    const focused: string[] = [];
    w.self.windows = [{ focus: () => { focused.push("focused"); return Promise.resolve(); }, navigate: (u: string) => w.navigated.push(u) }];
    await w.click("/study");
    expect(w.navigated).toEqual(["https://app.example.com/study"]);
    expect(focused).toEqual(["focused"]);
    expect(w.opened).toHaveLength(1);
  });

  it("falls back to the home page when a click has no link", async () => {
    const w = loadWorker();
    await w.click(undefined);
    expect(w.opened).toEqual(["https://app.example.com/"]);
  });

  it("does not cache anything (it is not an offline app)", () => {
    const code = readFileSync(join(__dirname, "../../../../public/sw.js"), "utf8");
    expect(code).not.toMatch(/caches\.|fetch\(|addEventListener\("fetch"/);
  });
});
