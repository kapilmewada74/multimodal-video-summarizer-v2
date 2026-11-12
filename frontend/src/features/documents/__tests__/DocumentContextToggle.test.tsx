// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const apiFetch = vi.fn();
vi.mock("../../../lib/api", () => ({ apiFetch: (...a: unknown[]) => apiFetch(...a) }));

import { DocumentContextToggle, useUsableDocumentCount } from "../DocumentContextToggle";

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  apiFetch.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("DocumentContextToggle", () => {
  it("shows nothing when there is no usable document", () => {
    act(() => root.render(<DocumentContextToggle count={0} checked={false} onChange={() => {}} />));
    expect(container.innerHTML).toBe("");
  });

  it("explains each state and reports changes", () => {
    const onChange = vi.fn();
    act(() => root.render(<DocumentContextToggle count={2} checked={false} onChange={onChange} />));
    expect(container.textContent).toContain("Also use my documents (2)");
    expect(container.textContent).toContain("shared with everyone");
    act(() => (container.querySelector("input") as HTMLInputElement).click());
    expect(onChange).toHaveBeenCalledWith(true);
    act(() => root.render(<DocumentContextToggle count={2} checked used={["a.pdf", "b.docx"]} onChange={onChange} />));
    expect(container.textContent).toContain("Made using: a.pdf, b.docx");
    expect(container.textContent).toContain("Only you can see this version");
  });
});

function Count({ id, k }: { id: string | null; k: unknown }) {
  return <p>{useUsableDocumentCount(id, k)}</p>;
}

describe("useUsableDocumentCount", () => {
  it("counts only documents that have readable text", async () => {
    apiFetch.mockResolvedValue(new Response(JSON.stringify({ items: [{ has_text: true }, { has_text: false }, { has_text: true }] })));
    await act(async () => root.render(<Count id="v1" k="a" />));
    expect(container.textContent).toBe("2");
    expect(apiFetch.mock.calls[0][0]).toBe("/api/documents?video_id=v1&limit=100");
  });

  it("does nothing without a video, and survives a failed request", async () => {
    await act(async () => root.render(<Count id={null} k="a" />));
    expect(apiFetch).not.toHaveBeenCalled();
    apiFetch.mockResolvedValue(new Response("no", { status: 500 }));
    await act(async () => root.render(<Count id="v1" k="b" />));
    expect(container.textContent).toBe("0");
  });
});
