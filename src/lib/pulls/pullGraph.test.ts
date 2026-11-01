// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { describe, expect, it } from 'vitest';
import {
  decodeEntities,
  ICON_SLOT,
  mermaidText,
  nodeTooltip,
  pullGraph,
} from './pullGraph';
import type { StackDependency, StackTree } from '../api/uiApi';

type Node = StackTree['targets'][number]['nodes'][number];

const dep = (
  number: number,
  kind: StackDependency['kind'],
  extra: Partial<StackDependency> = {}
): StackDependency => ({
  number,
  kind,
  reason: '',
  instructions: null,
  landed: false,
  files: [],
  accounted: false,
  forPr: null,
  ...extra,
});

const node = (number: number, extra: Partial<Node> = {}): Node => ({
  number,
  parent: null,
  children: [],
  waitsOn: [],
  mustAccountFor: [],
  landedRelations: [],
  cycleWith: [],
  unchecked: [],
  pending: [],
  checking: false,
  title: `PR ${number}`,
  headRef: `branch-${number}`,
  author: { id: 'u', username: 'u', name: 'U', image: null },
  pullState: { state: 'ready', reasons: [] },
  ...extra,
});

const tree = (
  ...targets: {
    branch: string;
    nodes: Node[];
    landed?: { number: number; title: string }[];
  }[]
): StackTree => ({
  targets: targets.map((t) => ({ landed: [], ...t })),
});

/** Edge statements, in order (their index is what linkStyle refers to). */
const edges = (source: string) =>
  source
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^\w+ (-->|-\.->)/.test(l));
const styleOf = (source: string, i: number) =>
  source
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.startsWith(`linkStyle ${i} `)) ?? '';

describe('pullGraph：拉取请求关系图', () => {
  it('没有开放请求时为空', () => {
    expect(pullGraph({ targets: [] })).toEqual([]);
  });

  it('绘制流程图，无前置请求的节点指向合入目标', () => {
    const [g] = pullGraph(tree({ branch: 'main', nodes: [node(1), node(2)] }));
    expect(g.target).toBe('main');
    expect(g.source).toMatch(/flowchart TD/);
    expect(g.source).toContain('land["main"]');
    expect(edges(g.source)).toEqual(['pr1 --> land', 'pr2 --> land']);
    expect(g.source).toContain('pr1["#35;1 PR 1<br/>by @u"]');
  });

  it('禁用 HTML 标签', () => {
    const [g] = pullGraph(tree({ branch: 'main', nodes: [node(1)] }));
    expect(g.source).toMatch(/htmlLabels: false/);
  });

  it('为各种关系应用样式，箭头从请求指向先合入的请求', () => {
    const [g] = pullGraph(
      tree({
        branch: 'main',
        nodes: [
          node(1),
          node(2, { parent: dep(1, 'builds_on') }),
          node(3, {
            parent: dep(1, 'builds_on'),
            waitsOn: [dep(2, 'conflicts')],
          }),
          node(4, { parent: dep(2, 'ordered_after', { forPr: 5 }) }),
          node(5, {
            mustAccountFor: [dep(9, 'must_account_for', { landed: true })],
          }),
        ],
        landed: [{ number: 9, title: 'Merged thing' }],
      })
    );
    const es = edges(g.source);
    const at = (line: string) => {
      const i = es.indexOf(line);
      expect(es).toContain(line);
      return i;
    };
    // stacked on: solid
    const stacked = at('pr2 -->|stacked on| pr1');
    expect(styleOf(g.source, stacked)).toBe('');
    // waits on: dashed
    expect(styleOf(g.source, at('pr3 -.->|waits on| pr2'))).toMatch(
      /stroke-dasharray:\s*6 4/
    );
    // ordered after: dotted, its own label
    expect(styleOf(g.source, at('pr4 -.->|lands after| pr2'))).toMatch(
      /stroke-dasharray:\s*2 3/
    );
    // must account for a merged PR: red, into a node for the merged PR
    expect(styleOf(g.source, at('pr5 -->|must change for| m9'))).toMatch(
      /stroke:#ef4444/
    );
    expect(g.source).toContain('m9["#35;9 Merged thing (merged)"]');
    // Only PRs with nothing ahead point into main (#5's prerequisite already landed).
    expect(es.filter((e) => e.endsWith('land'))).toEqual([
      'pr1 --> land',
      'pr5 --> land',
    ]);
  });

  it('按状态为节点着色，图本身不添加链接', () => {
    const [g] = pullGraph(
      tree({
        branch: 'main',
        nodes: [
          node(1, { pullState: { state: 'ready', reasons: [] } }),
          node(2, { pullState: { state: 'waiting', reasons: [] } }),
          node(3, { pullState: { state: 'agent_followup', reasons: [] } }),
          node(4, { pullState: { state: 'human_review', reasons: [] } }),
          node(5, { pullState: null }),
        ],
      })
    );
    expect(g.source).toContain('class pr1 ready');
    expect(g.source).toContain('class pr2 waiting');
    expect(g.source).toContain('class pr3 agent');
    expect(g.source).toContain('class pr4 person');
    expect(g.source).not.toContain('class pr5 ');
    for (const c of ['ready', 'waiting', 'agent', 'person'])
      expect(g.source).toMatch(new RegExp(`classDef ${c} `));
    // Navigation is attached after render, from node ids; the source has no links.
    expect(g.source).not.toMatch(/\bclick\b|href|javascript/i);
  });

  it('每个合入目标绘制独立图，并终止于对应分支', () => {
    const gs = pullGraph(
      tree(
        { branch: 'main', nodes: [node(1)] },
        {
          branch: 'release',
          nodes: [node(2), node(3, { parent: dep(2, 'builds_on') })],
        }
      )
    );
    expect(gs.map((g) => g.target)).toEqual(['main', 'release']);
    expect(gs[1].source).toContain('land["release"]');
    expect(edges(gs[1].source)).toEqual([
      'pr2 --> land',
      'pr3 -->|stacked on| pr2',
    ]);
    expect(gs[0].source).not.toContain('pr2');
  });

  it('标出循环中的拉取请求并报告', () => {
    const [g] = pullGraph(
      tree({
        branch: 'main',
        nodes: [
          node(1, { cycleWith: [2] }),
          node(2, { cycleWith: [1] }),
          node(3),
        ],
      })
    );
    expect(g.cycles).toEqual([1, 2]);
    expect(g.source).toMatch(/style pr1 [^\n]*stroke:#ef4444/);
    expect(g.source).toMatch(/style pr2 [^\n]*stroke:#ef4444/);
    expect(g.source).not.toMatch(/style pr3 /);
  });

  it('恶意标题或分支名无法操纵图结构', () => {
    const evil = '"]-->x; click x "javascript:alert(1)"';
    const [g] = pullGraph(
      tree({
        branch: 'main"]\nclick land "javascript:alert(2)"',
        nodes: [
          node(1, { title: evil }),
          node(2, { title: '%%{init: {"securityLevel": "loose"}}%%' }),
          node(3, {
            title: 'a\n  classDef ready fill:#f00\n  style pr1 fill:red',
          }),
          node(4, {
            title: 'x`**bold**` <img src=x onerror=alert(1)> [a]{b}|c|',
          }),
        ],
      })
    );
    const lines = g.source.split('\n');
    // Every label is one quoted string with no quote, bracket, pipe, angle, backtick or percent inside.
    for (const l of lines.filter((l) => /^\s*(pr\d+|land|m\d+)\[/.test(l)))
      // The only markup is the line break between title and status that pullGraph adds itself.
      expect(l.trim().split('<br/>').join(' ')).toMatch(
        /^\w+\["[^"[\]{}|<>`%\n]*"\]$/
      );
    expect(g.source).not.toContain('%%');
    expect(g.source).not.toMatch(/\bclick\b|javascript:|securityLevel/i);
    expect(lines.filter((l) => /^\s*classDef ready/.test(l))).toHaveLength(1);
    expect(lines.some((l) => /^\s*style pr1/.test(l))).toBe(false);
    // The injected text never adds edges or nodes of its own.
    expect(edges(g.source)).toEqual([
      'pr1 --> land',
      'pr2 --> land',
      'pr3 --> land',
      'pr4 --> land',
    ]);
  });

  it('完整保留长标题', () => {
    const [g] = pullGraph(
      tree({ branch: 'main', nodes: [node(1, { title: 'a'.repeat(100) })] })
    );
    const label = g.source.match(/pr1\["([^"]*)"\]/)![1];
    expect(label.split('<br/>')[0]).toBe(`#35;1 ${'a'.repeat(100)}`);
  });

  it('节点不显示状态，仅保留标题、作者及页面图标的空间', () => {
    const [g] = pullGraph(
      tree({
        branch: 'main',
        nodes: [
          node(1, {
            pullState: {
              state: 'human_review',
              reasons: [
                { kind: 'agent_flagged', agent: 'secagent', flags: [{}, {}] },
              ],
            },
          }),
          node(2, { pullState: { state: 'waiting', reasons: [] } }),
        ],
      }),
      (n) => (n === 1 ? 3 : 0)
    );
    const lines = (n: number) =>
      decodeEntities(
        g.source
          .match(new RegExp(`pr${n}\\["([^"]*)"\\]`))![1]
          .replace(/#(\d+);/g, '&#$1;')
      ).split('<br/>');
    expect(lines(1)).toEqual(['#1 PR 1', 'by @u', ICON_SLOT.repeat(3)]);
    expect(lines(2)).toEqual(['#2 PR 2', 'by @u']);
    // The state and its reasons are still in the hover text.
    expect(g.tips.pr1).toContain('@secagent flagged 2 findings for a person');
  });
});

describe('mermaidText：Mermaid 文本', () => {
  it('保留字母、数字和普通标点，编码其余字符', () => {
    expect(mermaidText('Fix: café (v2), done!')).toBe('Fix: café (v2), done!');
    expect(mermaidText('a"b<c>`d')).toBe('a#34;b#60;c#62;#96;d');
    expect(mermaidText('50% #1;')).toBe('50#37; #35;1#59;');
    expect(mermaidText('line\nbreak\ttab')).toBe('line break tab');
  });
});

describe('decodeEntities：解码实体', () => {
  it('将标签恢复为原始标题', () => {
    expect(decodeEntities('&#35;12 a &#60;b&#62; &#34;c&#34; t&#8230;')).toBe(
      '#12 a <b> "c" t…'
    );
  });
  it('仅解码一次，使编码后的实体文本保持字面含义', () => {
    // A title of `&#35;` is encoded as `#38;#35;`, which Mermaid draws as `&#38;#35;`.
    expect(decodeEntities('&#38;#35;')).toBe('&#35;');
  });
  it('保留超出范围的编码', () => {
    expect(decodeEntities('&#99999999;')).toBe('&#99999999;');
  });
});

describe('nodeTooltip：节点提示', () => {
  it('列出基本信息、状态及其原因', () => {
    const t = nodeTooltip(
      node(3, {
        pullState: {
          state: 'human_review',
          reasons: [{ kind: 'changes_requested', flags: 2 }],
        },
      })
    ).split('\n');
    expect(t[0]).toBe('#3 PR 3');
    expect(t[1]).toBe('branch-3 · @u');
    expect(t[2]).toMatch(/changes requested on 2 flags/);
  });

  it('与列表一致，将等待恢复合并的拉取请求显示为已暂停', () => {
    const t = nodeTooltip(
      node(3, {
        pullState: {
          state: 'waiting',
          reasons: [{ kind: 'merging_paused' }],
        },
      })
    ).split('\n');
    expect(t[2]).toBe('Paused: merging is paused');
  });

  it('描述各种依赖类型以及待处理、未检查和检查中状态', () => {
    const t = nodeTooltip(
      node(3, {
        parent: dep(1, 'builds_on', { reason: 'adds the helper' }),
        waitsOn: [
          dep(2, 'conflicts', { reason: 'same lines' }),
          dep(4, 'ordered_after'),
        ],
        mustAccountFor: [
          dep(5, 'must_account_for', { reason: 'renames it' }),
          dep(6, 'must_account_for', { reason: 'moves it', accounted: true }),
        ],
        pending: [7],
        unchecked: [8],
        checking: true,
      })
    ).split('\n');
    expect(t).toEqual(
      expect.arrayContaining([
        'stacked on #1: adds the helper',
        'waits on #2: same lines',
        'lands after #4',
        'must change for #5: renames it',
        'must change for #6: moves it (accounted for)',
        'checking #7…',
        "couldn't check against #8",
        'checking…',
      ])
    );
  });

  it('原样返回类似标记语言的标题', () => {
    expect(
      nodeTooltip(node(1, { title: '<script>alert(1)</script>' }))
    ).toMatch(/^#1 <script>alert\(1\)<\/script>\n/);
  });

  it('将已合入的 builds_on、conflicts 和 ordered_after 关系绘制到已合并节点', () => {
    const [g] = pullGraph(
      tree({
        branch: 'main',
        nodes: [
          node(4, { landedRelations: [dep(1, 'builds_on', { landed: true })] }),
          node(5, { landedRelations: [dep(2, 'conflicts', { landed: true })] }),
          node(6, {
            landedRelations: [dep(3, 'ordered_after', { landed: true })],
          }),
        ],
        landed: [
          { number: 1, title: 'One' },
          { number: 2, title: 'Two' },
          { number: 3, title: 'Three' },
        ],
      })
    );
    const es = edges(g.source);
    expect(es).toContain('pr4 -.->|waits on| m1');
    expect(es).toContain('pr5 -.->|waits on| m2');
    expect(es).toContain('pr6 -.->|lands after| m3');
    expect(g.source).toContain('m1["#35;1 One (merged)"]');
    expect(g.tips.m2).toBe('#2 Two (merged)');
    expect(g.tips.pr4).toContain('waits on #1');
  });

  it('以节点 ID 暴露提示，并标记已合并节点', () => {
    const g = pullGraph(
      tree({
        branch: 'main',
        nodes: [node(2, { parent: dep(1, 'builds_on', { landed: true }) })],
      })
    )[0];
    expect(g.tips.pr2).toContain('#2 PR 2');
    expect(g.tips.m1).toBe('#1 (merged)');
  });
});
