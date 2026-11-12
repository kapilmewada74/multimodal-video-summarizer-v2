// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { WorkspaceLayout } from "../WorkspaceLayout";
import { VideoPane } from "../../workspace/VideoPane";

let container: HTMLDivElement;
let root: Root;
let width = 375;

beforeEach(() => {
  // jsdom has no layout: report the width we want for every element.
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(() => width);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(() => 600);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

const render = () =>
  act(() =>
    root.render(
      <WorkspaceLayout video={<VideoPane player={<i>player</i>} footer={<b>badge</b>} />} panel={<p>notes panel</p>} storageKey="t" />,
    ),
  );

describe("workspace on a phone", () => {
  it("is one scrolling page: no divider, no toolbar of layout choices", () => {
    width = 375;
    render();
    expect(container.querySelector("[data-testid=phone-workspace]")).not.toBeNull();
    expect(container.querySelector("[role=separator]")).toBeNull();
    expect(container.textContent).toContain("player");
    expect(container.textContent).toContain("notes panel");
    expect(container.textContent).toContain("badge");
  });

  it("pins the video under the navigation bar, and lets you unpin it", () => {
    width = 375;
    render();
    const box = () => container.querySelector("[data-testid=player-box]") as HTMLElement;
    expect(box().className).toContain("sticky");
    const toggle = [...container.querySelectorAll("button")].find((b) => b.getAttribute("aria-pressed") !== null)!;
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    act(() => toggle.click());
    expect(box().className).not.toContain("sticky");
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
  });

  it("keeps the resizable split on wider screens", () => {
    width = 900;
    render();
    expect(container.querySelector("[data-testid=phone-workspace]")).toBeNull();
    expect(container.querySelector("[role=separator]")).not.toBeNull();
  });
});
