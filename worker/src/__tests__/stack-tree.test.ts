// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSE).
import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import type { ClassifierAnswer } from '../db/app.schema';
import {
  parseRecheck,
  parseRelation,
  readDecision,
  readOrder,
  routeDecision,
  workersAiStackModels,
  type Decision,
} from '../stack/models';
import { buildTree, type EdgeInput } from '../stack/tree';
import { linearize, type Choose } from '../stack/linearize';

const answers = (
  related: number,
  kind: string,
  kindConfidence: number,
  prerequisite: string,
  prerequisiteConfidence: number
): Record<string, ClassifierAnswer> => ({
  related: { type: 'noul', value: related },
  kind: {
    type: 'choice',
    value: kind,
    confidence: kindConfidence,
    probabilities: { [kind]: kindConfidence },
  },
  prerequisite: {
    type: 'choice',
    value: prerequisite,
    confidence: prerequisiteConfidence,
    probabilities: { [prerequisite]: prerequisiteConfidence },
  },
});

describe('Clef 决策', () => {
  it('读取 Clef 的三项回答', () => {
    expect(readDecision(answers(0.8, 'builds_on', 0.7, 'a', 0.9))).toEqual({
      related: 0.8,
      kind: 'builds_on',
      kindConfidence: 0.7,
      prerequisite: 'a',
      prerequisiteConfidence: 0.9,
    });
  });

  it('拒绝缺失或格式错误的回答', () => {
    expect(() => readDecision({})).toThrow();
    expect(() => readDecision(answers(0.8, 'blocks', 0.7, 'a', 0.9))).toThrow();
    expect(() =>
      readDecision(answers(0.8, 'builds_on', 0.7, 'c', 0.9))
    ).toThrow();
  });

  const o = {
    relatedAbove: 0.3,
    confidentAbove: 0.6,
    conflicts: false,
    aLanded: false,
  };
  const d = (over: Partial<Decision>): Decision => ({
    related: 0.9,
    kind: 'builds_on',
    kindConfidence: 0.9,
    prerequisite: 'a',
    prerequisiteConfidence: 0.9,
    ...over,
  });

  it('遇到无关请求对时停止', () => {
    expect(routeDecision(d({ related: 0.2 }), o)).toEqual({
      action: 'independent',
    });
  });

  it('保留高置信度决策，仅请求文字说明', () => {
    expect(routeDecision(d({}), o)).toEqual({
      action: 'explain',
      kind: 'builds_on',
      prerequisite: 'a',
    });
    expect(routeDecision(d({ kind: 'independent' }), o)).toEqual({
      action: 'independent',
    });
  });

  it('仅按关系类型判定独立回答', () => {
    expect(
      routeDecision(d({ kind: 'independent', prerequisiteConfidence: 0.1 }), o)
    ).toEqual({ action: 'independent' });
    expect(
      routeDecision(d({ kind: 'independent', kindConfidence: 0.5 }), o)
    ).toEqual({ action: 'decide' });
  });

  it('Clef 不确定时交由推理模型决策', () => {
    expect(routeDecision(d({ kindConfidence: 0.5 }), o)).toEqual({
      action: 'decide',
    });
    expect(routeDecision(d({ prerequisiteConfidence: 0.5 }), o)).toEqual({
      action: 'decide',
    });
  });

  it('将文本冲突视为相关，绝不视为独立', () => {
    expect(
      routeDecision(d({ related: 0.1, kind: 'independent' }), {
        ...o,
        conflicts: true,
      })
    ).toEqual({ action: 'explain', kind: 'conflicts', prerequisite: 'a' });
  });

  it('不允许已合入的拉取请求依赖打开的请求', () => {
    expect(
      routeDecision(d({ prerequisite: 'b' }), { ...o, aLanded: true })
    ).toEqual({ action: 'decide' });
  });
});

describe('推理模型回答', () => {
  it('读取带或不带代码围栏的关系回答', () => {
    const text =
      '{"kind":"must_account_for","prerequisite":"a","reason":"#1 adds a registry.","instructions":"Add checks."}';
    for (const t of [text, '```json\n' + text + '\n```'])
      expect(parseRelation(t, { aLanded: false })).toEqual({
        kind: 'must_account_for',
        prerequisite: 'a',
        reason: '#1 adds a registry.',
        instructions: 'Add checks.',
      });
  });

  it('规范化独立关系并丢弃多余指令', () => {
    expect(
      parseRelation(
        '{"kind":"independent","prerequisite":"b","reason":"Unrelated.","instructions":"x"}',
        { aLanded: false }
      )
    ).toEqual({
      kind: 'independent',
      prerequisite: null,
      reason: 'Unrelated.',
      instructions: null,
    });
  });

  it('无论说明内容如何，保留已决定的类型及前置依赖', async () => {
    const AI = {
      run: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                kind: 'builds_on',
                prerequisite: 'b',
                reason: 'Uses the registry.',
                instructions: 'Register the new setting.',
              }),
            },
          },
        ],
      }),
    };
    const models = workersAiStackModels(
      { ...env, AI, AI_GATEWAY: 'off' } as unknown as CloudflareBindings,
      { review: 'model' },
      { repositoryId: 'r', pullRequestId: 'p' }
    );
    const side = {
      number: 1,
      title: 't',
      description: '',
      summaries: '',
      diffs: '',
    };
    expect(
      await models.explain({
        a: { ...side, landed: true },
        b: { ...side, number: 2, landed: false },
        conflicts: [],
        decided: { kind: 'must_account_for', prerequisite: 'a' },
      })
    ).toEqual({
      kind: 'must_account_for',
      prerequisite: 'a',
      reason: 'Uses the registry.',
      instructions: 'Register the new setting.',
    });
  });

  it('将指令限制在 1500 个字符内', () => {
    const r = parseRelation(
      JSON.stringify({
        kind: 'must_account_for',
        prerequisite: 'a',
        reason: 'r',
        instructions: 'x'.repeat(3000),
      }),
      { aLanded: false }
    );
    expect(r.instructions).toHaveLength(1500);
  });

  it('拒绝未知类型、无效前置依赖、空理由及已合入请求依赖打开请求的关系', () => {
    for (const text of [
      '{"kind":"blocks","prerequisite":"a","reason":"r","instructions":null}',
      '{"kind":"builds_on","prerequisite":"c","reason":"r","instructions":null}',
      '{"kind":"builds_on","prerequisite":null,"reason":"r","instructions":null}',
      '{"kind":"builds_on","prerequisite":"a","reason":"","instructions":null}',
      'not json',
    ])
      expect(() => parseRelation(text, { aLanded: false })).toThrow();
    expect(() =>
      parseRelation(
        '{"kind":"builds_on","prerequisite":"b","reason":"r","instructions":null}',
        { aLanded: true }
      )
    ).toThrow();
  });
});

const edge = (
  a: number,
  b: number,
  kind: EdgeInput['kind'],
  prerequisite: EdgeInput['prerequisite'] = 'a',
  stage: EdgeInput['stage'] = 'done'
): EdgeInput => ({
  a,
  b,
  stage,
  kind,
  prerequisite,
  reason: `${a}-${b}`,
  instructions: kind === 'must_account_for' ? 'Do it.' : null,
  files: [],
});

describe('buildTree 构建依赖树', () => {
  it('将依赖请求堆叠到其前置请求上', () => {
    const t = buildTree([1, 2], [edge(1, 2, 'builds_on')]);
    expect(t.get(2)!.parent?.number).toBe(1);
    expect(t.get(1)!.children).toEqual([2]);
    expect(t.get(1)!.parent).toBeNull();
  });

  it('遵循模型选择的依赖方向', () => {
    const t = buildTree([1, 2], [edge(1, 2, 'builds_on', 'b')]);
    expect(t.get(1)!.parent?.number).toBe(2);
  });

  it('前置依赖无法连成一条链时不设父级，并等待全部前置依赖', () => {
    const t = buildTree(
      [1, 2, 3, 4],
      [
        edge(1, 4, 'builds_on'),
        edge(2, 4, 'conflicts'),
        edge(3, 4, 'builds_on'),
      ]
    );
    expect(t.get(4)!.parent).toBeNull();
    expect(
      t
        .get(4)!
        .waitsOn.map((d) => d.number)
        .sort()
    ).toEqual([1, 2, 3]);
  });

  it('选择依赖链包含其他前置依赖的父级，并优先考虑 must_account_for', () => {
    const order = (a: number, b: number, forPr: number): EdgeInput => ({
      ...edge(a, b, 'ordered_after'),
      slot: 'order',
      forPr,
    });
    // #31 needs #28 and #29; #29 was ordered after #28 for it.
    const t = buildTree(
      [28, 29, 31],
      [
        edge(28, 31, 'builds_on'),
        edge(29, 31, 'must_account_for'),
        order(28, 29, 31),
      ]
    );
    expect(t.get(31)!.parent).toMatchObject({
      number: 29,
      kind: 'must_account_for',
    });
    expect(t.get(31)!.waitsOn).toEqual([]); // #28 is on #29's chain
    expect(t.get(29)!.parent).toMatchObject({
      number: 28,
      kind: 'ordered_after',
      forPr: 31,
    });
    expect(t.get(28)!.children).toEqual([29]);
  });

  it('忽略被驳回的依赖边，并标记已处理的依赖', () => {
    const t = buildTree(
      [1, 2, 3],
      [
        { ...edge(1, 3, 'conflicts'), dismissed: true },
        { ...edge(2, 3, 'must_account_for'), accounted: true },
      ]
    );
    expect(t.get(3)!.waitsOn).toEqual([]);
    expect(t.get(3)!.mustAccountFor).toMatchObject([
      { number: 2, accounted: true },
    ]);
    expect(t.get(3)!.parent?.number).toBe(2);
  });

  it('重新检查 must_account_for 时继续阻塞', () => {
    const t = buildTree(
      [1, 2],
      [edge(1, 2, 'must_account_for', 'a', 'recheck')]
    );
    expect(t.get(2)!.mustAccountFor).toMatchObject([
      { number: 1, accounted: false },
    ]);
    expect(t.get(2)!.pending).toEqual([]);
  });

  it('不将仅通过冲突包含前置依赖的链用作堆叠目标', () => {
    const t = buildTree(
      [1, 2, 3],
      [
        edge(1, 3, 'builds_on'),
        edge(2, 3, 'builds_on'),
        edge(1, 2, 'conflicts'), // #2 lands after #1, but isn't stacked on it
      ]
    );
    expect(t.get(3)!.parent).toBeNull();
    expect(t.get(3)!.waitsOn.map((d) => d.number)).toEqual([1, 2]);
    expect(t.get(2)!.waitsOn.map((d) => d.number)).toEqual([1]);
  });

  it('发生冲突后，沿排序边构成的链堆叠', () => {
    const t = buildTree(
      [1, 2, 3],
      [
        edge(1, 3, 'builds_on'),
        edge(2, 3, 'builds_on'),
        edge(1, 2, 'conflicts'),
        { ...edge(1, 2, 'ordered_after'), slot: 'order', forPr: 3 },
      ]
    );
    expect(t.get(2)!.parent?.number).toBe(1);
    expect(t.get(3)!.parent?.number).toBe(2);
    expect(t.get(3)!.waitsOn).toEqual([]);
  });

  it('不单凭冲突关系设置父级', () => {
    const t = buildTree([1, 2], [edge(1, 2, 'conflicts')]);
    expect(t.get(2)!.parent).toBeNull();
    expect(t.get(2)!.waitsOn.map((d) => d.number)).toEqual([1]);
  });

  it('仅在需要处理时列出已合入的前置依赖', () => {
    const t = buildTree(
      [2, 3],
      [edge(1, 2, 'must_account_for'), edge(1, 3, 'builds_on')]
    );
    expect(t.get(2)!.parent).toBeNull();
    expect(t.get(2)!.mustAccountFor).toMatchObject([
      { number: 1, landed: true, instructions: 'Do it.' },
    ]);
    expect(t.get(3)!.mustAccountFor).toEqual([]);
    expect(t.get(3)!.waitsOn).toEqual([]);
  });

  it('已合入的 builds_on、conflicts 和 ordered_after 仅保留用于展示', () => {
    const t = buildTree(
      [4, 5, 6],
      [
        edge(1, 4, 'builds_on'),
        edge(2, 5, 'conflicts'),
        edge(3, 6, 'ordered_after'),
      ]
    );
    expect(t.get(4)!.landedRelations).toMatchObject([
      { number: 1, kind: 'builds_on', landed: true },
    ]);
    expect(t.get(5)!.landedRelations).toMatchObject([
      { number: 2, kind: 'conflicts', landed: true },
    ]);
    expect(t.get(6)!.landedRelations).toMatchObject([
      { number: 3, kind: 'ordered_after', landed: true },
    ]);
    for (const n of [4, 5, 6]) {
      expect(t.get(n)!.parent).toBeNull();
      expect(t.get(n)!.waitsOn).toEqual([]);
      expect(t.get(n)!.mustAccountFor).toEqual([]);
    }
  });

  it('断开依赖环并报告', () => {
    const t = buildTree(
      [1, 2, 3],
      [
        edge(1, 2, 'builds_on', 'a'),
        edge(2, 3, 'builds_on', 'a'),
        edge(1, 3, 'builds_on', 'b'),
      ]
    );
    for (const n of [1, 2, 3]) {
      expect(t.get(n)!.parent).toBeNull();
      expect(t.get(n)!.cycleWith.length).toBe(2);
    }
  });

  it('将复查失败标记为依赖请求尚未检查，并继续阻塞', () => {
    const t = buildTree(
      [1, 2],
      [
        {
          ...edge(1, 2, 'must_account_for'),
          errorMessage: 'Re-check failed: model down',
        },
      ]
    );
    expect(t.get(2)!.unchecked).toEqual([1]);
    expect(t.get(1)!.unchecked).toEqual([]);
    expect(t.get(2)!.mustAccountFor.map((d) => d.number)).toEqual([1]);
    expect(t.get(2)!.parent?.number).toBe(1);
    // Dismissed, or accounted for: nothing to retry.
    for (const extra of [{ dismissed: true }, { accounted: true }])
      expect(
        buildTree(
          [1, 2],
          [
            {
              ...edge(1, 2, 'must_account_for'),
              errorMessage: 'Re-check failed: model down',
              ...extra,
            },
          ]
        ).get(2)!.unchecked
      ).toEqual([]);
  });

  it('关系判定及排序边同时指向同一前置依赖时，在 waitsOn 中只列出一次', () => {
    const t = buildTree(
      [1, 2],
      [
        edge(1, 2, 'conflicts'),
        { ...edge(1, 2, 'conflicts'), slot: 'order', forPr: 2 },
      ]
    );
    expect(t.get(2)!.waitsOn.map((d) => d.number)).toEqual([1]);
  });

  it('未检查请求只列出一次，失败的排序记录不视为未检查', () => {
    const t = buildTree(
      [1, 2],
      [
        edge(1, 2, null, null, 'failed'),
        {
          ...edge(1, 2, 'must_account_for'),
          errorMessage: 'Re-check failed: model down',
        },
      ]
    );
    expect(t.get(2)!.unchecked).toEqual([1]);
    const order = buildTree(
      [1, 2],
      [
        {
          ...edge(1, 2, 'must_account_for'),
          slot: 'order',
          forPr: 2,
          errorMessage: 'Re-check failed: model down',
        },
      ]
    );
    expect(order.get(2)!.unchecked).toEqual([]);
  });

  it('将失败请求对报告为未检查，并忽略独立及尚未完成的请求对', () => {
    const t = buildTree(
      [1, 2, 3],
      [
        edge(1, 2, null, null, 'failed'),
        edge(1, 3, 'independent', null),
        edge(2, 3, null, null, 'triage'),
      ]
    );
    expect(t.get(1)!.unchecked).toEqual([2]);
    expect(t.get(2)!.unchecked).toEqual([1]);
    expect(t.get(3)!.waitsOn).toEqual([]);
    expect(t.get(3)!.parent).toBeNull();
  });

  it('未完成的排序记录不视为未检查或待处理，也不用作堆叠依据', () => {
    const t = buildTree(
      [1, 2],
      [
        {
          ...edge(1, 2, 'ordered_after', 'a', 'failed'),
          slot: 'order',
          forPr: 2,
        },
        {
          ...edge(1, 2, 'ordered_after', 'a', 'triage'),
          slot: 'order',
          forPr: 2,
        },
      ]
    );
    expect(t.get(2)!.unchecked).toEqual([]);
    expect(t.get(2)!.pending).toEqual([]);
    expect(t.get(2)!.parent).toBeNull();
  });

  it('将仍在检查的请求对列为待处理', () => {
    const t = buildTree(
      [2, 3, 4],
      [
        edge(2, 3, null, null, 'triage'),
        edge(1, 4, null, null, 'deep'),
        edge(2, 4, 'builds_on'),
      ]
    );
    expect(t.get(2)!.pending).toEqual([3]);
    expect(t.get(3)!.pending).toEqual([2]);
    // #1 has landed: only the open side waits.
    expect(t.get(4)!.pending).toEqual([1]);
    expect(t.get(4)!.checking).toBe(false);
  });
});

describe('parseRecheck 解析复查结果', () => {
  it('读取回答，确认已处理后丢弃指令', () => {
    expect(
      parseRecheck(
        '```json\n{"accounted":true,"reason":"Adds the check.","instructions":"x"}\n```'
      )
    ).toEqual({
      accounted: true,
      reason: 'Adds the check.',
      instructions: null,
    });
    expect(
      parseRecheck(
        '{"accounted":false,"reason":"Still missing.","instructions":"Add it."}'
      )
    ).toEqual({
      accounted: false,
      reason: 'Still missing.',
      instructions: 'Add it.',
    });
  });

  it('拒绝其他输入', () => {
    for (const text of [
      '{"accounted":"yes","reason":"r","instructions":null}',
      '{"reason":"r","instructions":null}',
      '{"accounted":true,"reason":"","instructions":null}',
      '[]',
      'not json',
    ])
      expect(() => parseRecheck(text)).toThrow();
  });
});

describe('linearize 线性化依赖', () => {
  const firstIs =
    (n: number): Choose =>
    async (x, y) =>
      x === n || y !== n ? x : y;

  it('某前置依赖的链已包含其他前置依赖时不新增关系', async () => {
    const added = await linearize(
      {
        open: [28, 29, 31],
        stackable: new Map([
          [29, [28]],
          [31, [28, 29]],
        ]),
        others: [],
        orders: [],
      },
      async () => {
        throw new Error('此处无需选择排序');
      }
    );
    expect(added).toEqual([]);
  });

  it('按选择结果为共同依赖的两个无关前置请求排序', async () => {
    const asked: number[][] = [];
    const added = await linearize(
      {
        open: [28, 29, 31],
        stackable: new Map([[31, [28, 29]]]),
        others: [],
        orders: [],
      },
      async (x, y, forPr) => {
        asked.push([x, y, forPr]);
        return 29;
      }
    );
    expect(asked).toEqual([[29, 28, 31]]);
    expect(added).toEqual([{ before: 29, after: 28, forPr: 31 }]);
  });

  it('已有关系优先于新选择，仍将请求对排在同一条链上', async () => {
    const added = await linearize(
      {
        open: [28, 29, 31],
        stackable: new Map([[31, [28, 29]]]),
        others: [{ pre: 28, dep: 29 }], // #29 conflicts with #28 and lands after it
        orders: [],
      },
      async () => {
        throw new Error('此处无需选择排序');
      }
    );
    // A conflict sets the direction but isn't a line to stack on: the order edge is still added.
    expect(added).toEqual([{ before: 28, after: 29, forPr: 31 }]);
  });

  it('不为维护者拒绝的请求对排序，依赖方等待二者', async () => {
    const added = await linearize(
      {
        open: [28, 29, 31],
        stackable: new Map([[31, [28, 29]]]),
        others: [],
        orders: [],
        refused: [{ before: 28, after: 29, forPr: 31 }],
      },
      async () => {
        throw new Error('此处无需选择排序');
      }
    );
    expect(added).toEqual([]);
  });

  it('两个依赖方选择相反顺序时只保留一个排序', async () => {
    const asked: number[] = [];
    const added = await linearize(
      {
        open: [1, 2, 8, 9],
        stackable: new Map([
          [8, [1, 2]],
          [9, [1, 2]],
        ]),
        others: [],
        orders: [],
      },
      async (x, y, forPr) => {
        asked.push(forPr);
        // #8 wants #2 first, #9 wants #1 first.
        return forPr === 8 ? (x === 2 ? x : y) : x === 1 ? x : y;
      }
    );
    expect(asked).toEqual([8]);
    expect(added).toEqual([{ before: 2, after: 1, forPr: 8 }]);
  });

  it('回滚会闭合成环的依赖链', async () => {
    const added = await linearize(
      {
        open: [1, 2, 3, 9],
        stackable: new Map([[9, [1, 2, 3]]]),
        others: [{ pre: 1, dep: 3 }], // #3 lands after #1
        orders: [],
      },
      async (x) => x // whichever is asked about goes first: chain 3, 2, 1
    );
    // 2 after 3 is fine alone, but 1 after 2 would close 1 → 2 → 3 → 1: nothing of the chain is kept.
    expect(added).toEqual([]);
  });

  it('连接三个前置依赖，且无论选择结果如何都保持无环', async () => {
    const added = await linearize(
      {
        open: [1, 2, 3, 9],
        stackable: new Map([[9, [1, 2, 3]]]),
        others: [],
        orders: [],
      },
      async (_x, y) => y // contrary: always the second
    );
    expect(added).toHaveLength(2);
    const after = new Map(added.map((e) => [e.after, e.before]));
    // Following "lands after" from any node ends: no cycle.
    for (const start of [1, 2, 3]) {
      const seen = new Set<number>();
      for (
        let n: number | undefined = start;
        n !== undefined;
        n = after.get(n)
      ) {
        expect(seen.has(n)).toBe(false);
        seen.add(n);
      }
    }
  });

  it('跳过处于依赖环中的拉取请求', async () => {
    const added = await linearize(
      {
        open: [1, 2, 3, 4],
        stackable: new Map([
          [1, [2]],
          [2, [1]],
          [4, [1, 3]],
        ]),
        others: [],
        orders: [],
      },
      firstIs(3)
    );
    expect(added).toEqual([]);
  });

  it('读取 Clef 的排序回答', () => {
    expect(
      readOrder({
        first: {
          type: 'choice',
          value: 'b',
          confidence: 0.8,
          probabilities: { b: 0.8 },
        },
      })
    ).toEqual({ first: 'b', confidence: 0.8 });
    expect(() => readOrder({ first: { type: 'noul', value: 0.9 } })).toThrow();
    expect(() =>
      readOrder({
        first: { type: 'choice', value: 'c', confidence: 1, probabilities: {} },
      })
    ).toThrow();
  });
});
