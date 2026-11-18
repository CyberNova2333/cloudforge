// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
// Modifications by CyberNova are licensed under AGPL-3.0-only with Additional Terms (see ADDITIONAL_TERMS.zh-CN.md; ref: ADDITIONAL_TERMS.en.md).
/**
 * The rail's classes (see `src/styles/shell.css`). On a desktop it is `shut` (64px in the layout) unless pinned;
 * a peek adds `peeking`, which lays its 236px panel over the page (`position: absolute`) while the rail keeps its
 * 64px in the layout, so the page never moves. Below 900px it is a drawer: never shut, so its labels show.
 */
export function railClasses({
  pinned,
  peek,
  narrow,
}: {
  pinned: boolean;
  peek: boolean;
  narrow: boolean;
}): string {
  if (narrow) return 'snav';
  if (pinned) return 'snav pinned';
  return peek ? 'snav shut peeking' : 'snav shut';
}
