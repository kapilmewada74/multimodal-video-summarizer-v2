// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

import { WorkspaceCard } from "../WorkspaceCard";

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("the open-workspace card", () => {
  it("takes a signed-in person straight to the workspace", () => {
    const onLockedClick = vi.fn();
    act(() => root.render(<WorkspaceCard href="/video/abc" locked={false} onLockedClick={onLockedClick} />));
    const link = container.querySelector("a")!;
    expect(link.getAttribute("href")).toBe("/video/abc");
    expect(link.textContent).toContain("Open full workspace");
    expect(container.textContent).not.toContain("Free account");
    link.addEventListener("click", (event) => event.preventDefault());   // jsdom cannot navigate
    act(() => link.click());
    expect(onLockedClick).not.toHaveBeenCalled();
  });

  it("asks someone without an account to sign in instead of navigating", () => {
    const onLockedClick = vi.fn();
    act(() => root.render(<WorkspaceCard href="/video/abc" locked onLockedClick={onLockedClick} />));
    expect(container.querySelector("a")).toBeNull();
    const button = container.querySelector("button")!;
    expect(container.textContent).toContain("Free account");
    expect(button.getAttribute("aria-label")).toMatch(/sign in required/i);
    act(() => button.click());
    expect(onLockedClick).toHaveBeenCalledTimes(1);
  });
});
