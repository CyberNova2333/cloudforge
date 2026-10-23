// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSE).
import { expect, it } from 'vitest';
import { buildTree, type EdgeInput } from '../stack/tree';
import { gateFor } from '../stack/gate';
import {
  holdsWhole,
  lineageOwnership,
  ownBase,
  type Lineage,
} from '../stack/lineage';
import type { GitService } from '../git/service';

it('blocks every member of a dependency cycle even though the tree removes its ordinary parent/waits edges', () => {
  const edge = (a: number, b: number): EdgeInput => ({
    a,
    b,
    stage: 'done',
    kind: 'conflicts',
    prerequisite: 'a',
    reason: 'dependency',
    instructions: null,
    files: [],
  });
  const tree = buildTree([1, 2, 3], [edge(1, 2), edge(2, 3), edge(3, 1)]);
  for (const node of tree.values()) {
    expect(node.parent).toBeNull();
    expect(node.waitsOn).toEqual([]);
    expect(gateFor(node).blocks).toEqual(
      node.cycleWith.map((pr) => expect.objectContaining({ kind: 'cycle', pr }))
    );
    expect(gateFor(node).blocks.length).toBeGreaterThan(0);
  }
});

it('indexed ownership matches exhaustive containment and retains shared-parent trimming', async () => {
  const line = (...ids: string[]): Lineage => ({
    ids,
    shas: ids.map((id) => `sha-${id}`),
    truncated: false,
  });
  const parent = line('p');
  const child = line('p', 'c');
  const sibling = line('p', 's');
  const truncated = { ...line('p', 't'), truncated: true };
  const all = [
    parent,
    child,
    sibling,
    truncated,
    line(),
    ...Array.from({ length: 100 }, (_, i) => line(`unrelated-${i}`)),
  ];
  // Equal SHAs establish containment; attempting a patch read here would be a regression.
  const git = {
    commit: async () => {
      throw new Error('unexpected patch read');
    },
  } as unknown as GitService;
  const indexed = await lineageOwnership(git, all);
  for (const outer of all) {
    const expected: Lineage[] = [];
    for (const inner of all)
      if (outer !== inner && (await holdsWhole(git, outer, inner)))
        expected.push(inner);
    expect(indexed.get(outer)).toEqual(new Set(expected));
  }
  expect(
    ownBase(child, new Set([...indexed.get(child)!].flatMap((p) => p.ids)))
  ).toBe('sha-p');
  expect(indexed.get(child)!.has(sibling)).toBe(false);
  expect(indexed.get(truncated)!.size).toBe(0);
});
