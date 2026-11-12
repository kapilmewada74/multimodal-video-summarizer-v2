import React from "react";
import { KIND_STYLE, documentKind } from "./files";

/** A small coloured tile that shows what kind of file this is (PDF, Word, slides, ...). */
export function FileBadge({ extension, size = 40 }: { extension: string; size?: number }) {
  const style = KIND_STYLE[documentKind(extension)];
  return (
    <span
      aria-hidden
      data-testid="file-badge"
      className="flex shrink-0 items-center justify-center rounded-xl text-[10px] font-black tracking-wide"
      style={{ width: size, height: size, background: style.bg, color: style.fg }}
    >
      {style.label}
    </span>
  );
}
