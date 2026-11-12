import type { MindMapNode } from "../../lib/types";

/** The map as an indented Markdown list (for copying or exporting). */
export function mindmapToMarkdown(node: MindMapNode, depth = 0): string {
  const line = `${"  ".repeat(depth)}- ${node.title}`;
  const children = (node.children ?? []).map((child) => mindmapToMarkdown(child, depth + 1));
  return [line, ...children].join("\n");
}

export function countNodes(node: MindMapNode): number {
  return 1 + (node.children ?? []).reduce((total, child) => total + countNodes(child), 0);
}

export function maxDepth(node: MindMapNode): number {
  return 1 + Math.max(0, ...(node.children ?? []).map(maxDepth));
}

/** Ids of the nodes that start collapsed: everything deeper than `openLevels`. */
export function initialCollapsed(node: MindMapNode, openLevels = 2, path = "0", depth = 0): Set<string> {
  const collapsed = new Set<string>();
  if (depth >= openLevels && (node.children ?? []).length > 0) collapsed.add(path);
  (node.children ?? []).forEach((child, index) => {
    initialCollapsed(child, openLevels, `${path}.${index}`, depth + 1).forEach((id) => collapsed.add(id));
  });
  return collapsed;
}
