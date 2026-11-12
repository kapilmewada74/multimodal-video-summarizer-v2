"use client";

import React, { useRef } from "react";
import { useElementSize } from "../layout/hooks";
import { usePhoneMode } from "../layout/phone";
import { fitAspect } from "../layout/split";

/**
 * The video area. The player is always the biggest 16:9 rectangle that fits the pane, so it is never
 * stretched or cropped as the divider moves. Whatever does not fit (the study badge) scrolls below it.
 */
export function VideoPane({ player, footer }: { player: React.ReactNode; footer?: React.ReactNode }) {
  const { phone, pinned } = usePhoneMode();
  const root = useRef<HTMLDivElement>(null);
  const { width, height } = useElementSize(root);
  const room = Math.max(120, height - 24 - (footer ? 120 : 0));
  const fit = width > 0 ? fitAspect(Math.max(0, width - 16), room) : null;

  if (phone) {
    // Full width, 16:9; pinned under the navigation bar (h-16) so it stays in view while the notes scroll.
    // No wrapper element: "sticky" only holds inside its parent, which must be the whole page column.
    return (
      <>
        <div
          className={`w-full bg-[var(--bg-app)] pb-1 ${pinned ? "sticky top-16 z-30 shadow-sm" : ""}`}
          data-testid="player-box"
        >
          {/* Pinned: never taller than about a third of the screen, so there is room left to read. */}
          <div className="mx-auto" style={pinned ? { maxWidth: "min(100%, calc(34dvh * 1.7778))" } : undefined}>
            {player}
          </div>
        </div>
        {footer && <div className="mt-2 w-full">{footer}</div>}
      </>
    );
  }

  return (
    <div ref={root} className="flex h-full min-h-full w-full flex-col items-center p-2">
      <div style={fit ? { width: fit.width } : { width: "100%" }} className="max-w-full shrink-0" data-testid="player-box">
        {player}
      </div>
      {footer && <div className="mt-2 w-full">{footer}</div>}
    </div>
  );
}
