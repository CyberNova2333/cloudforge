// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { findFocusedTests } from '../../../.claude/hooks/_focused-tests.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

describe('聚焦与跳过测试的语法检测', () => {
  it.each(['describe', 'it', 'test', 'suite', 'bench'])(
    '识别 %s 的聚焦与跳过调用',
    (root) => {
      for (const mode of ['only', 'skip']) {
        expect(findFocusedTests(`${root}.${mode}('用例', () => {});`)).toEqual([
          { line: 1, snippet: `${root}.${mode}` },
        ]);
      }
    }
  );

  it.each(['fit', 'fdescribe', 'xit', 'xtest', 'xdescribe'])(
    '识别旧式别名 %s 的调用',
    (alias) => {
      expect(findFocusedTests(`${alias}('用例', () => {});`)).toEqual([
        { line: 1, snippet: alias },
      ]);
    }
  );

  it.each([
    ['test.concurrent.only("用例", () => {});', 'test.concurrent.only'],
    ['it.skip.each([1, 2])("用例", () => {});', 'it.skip.each(…)'],
    ['it.only.each([1, 2])("用例", () => {});', 'it.only.each(…)'],
    [
      'describe.each([{ value: wrap(nested()) }]).only("用例", () => {});',
      'describe.each(…).only',
    ],
    [
      'test.each([() => nested()]).skip("用例", () => {});',
      'test.each(…).skip',
    ],
    ['it\n  .concurrent\n  .only("用例", () => {});', 'it.concurrent.only'],
    ['(test as typeof it).only<number>("用例", () => {});', 'test.only'],
    ['(<typeof it>test).skip("用例", () => {});', 'test.skip'],
    ['(it satisfies typeof test).only("用例", () => {});', 'it.only'],
    ['test!.skip("用例", () => {});', 'test.skip'],
    ['test?.only?.("用例", () => {});', 'test.only'],
    ['test["only"]("用例", () => {});', 'test.only'],
    ['it[`skip`]("用例", () => {});', 'it.skip'],
    ['it.only.each`value\n${1}`("用例", () => {});', 'it.only.each`…`'],
    [
      'describe.each`value\n${1}`.skip("用例", () => {});',
      'describe.each`…`.skip',
    ],
  ])('保留链式调用检测：%s', (source, snippet) => {
    expect(findFocusedTests(source)).toEqual([{ line: 1, snippet }]);
  });

  it('忽略注释、字符串、正则及模板中的示例文本', () => {
    const source = [
      '// it.only("注释", () => {});',
      '/* test.skip("块注释", () => {}); fdescribe("分组", () => {}); */',
      'const single = \'it.only("夹具", () => {})\';',
      'const double = "test.skip(\\"夹具\\", () => {})";',
      'const template = `suite.only("夹具", () => {}); ${"xit("}`;',
      String.raw`const pattern = /it\.only\(test\.skip\(/;`,
      'it("真实普通用例", () => expect(single).toContain("it.only("));',
    ].join('\n');
    expect(findFocusedTests(source)).toEqual([]);
  });

  it('忽略属性读取、无关对象及函数声明', () => {
    const source = [
      'const selected = test.only;',
      'const skipped = it["skip"];',
      'const factory = describe.each([1, 2]).only;',
      'consume(test.only, fit, xdescribe);',
      'config.only(); readonly.skip(); obj.test.only();',
      'const methods = { only() {}, skip() {}, fit() {} };',
      'function fit() {}',
      'it.each([1, 2])("普通参数化用例", () => {});',
    ].join('\n');
    expect(findFocusedTests(source)).toEqual([]);
  });

  it('报告真实调用的行号，并且同一参数化调用只报告一次', () => {
    const source = [
      '// test.only("注释中的假用例", () => {});',
      'const fixture = "it.skip(";',
      'describe.only.each([1])("分组", () => {',
      '  test.skip("内部用例", () => {});',
      '});',
    ].join('\r\n');
    expect(findFocusedTests(source)).toEqual([
      { line: 3, snippet: 'describe.only.each(…)' },
      { line: 4, snippet: 'test.skip' },
    ]);
  });

  it('仍检查模板插值中的真实调用', () => {
    expect(
      findFocusedTests(
        'const output = `it.only( ${test.skip("用例", () => {})}`;'
      )
    ).toEqual([{ line: 1, snippet: 'test.skip' }]);
  });

  it('支持 TSX，并区分 JSX 文本与表达式中的调用', () => {
    const source = [
      'const example = <pre title="it.only()">test.skip()</pre>;',
      'const actual = <div>{it.only("用例", () => {})}</div>;',
    ].join('\n');
    expect(findFocusedTests(source, 'component.test.tsx')).toEqual([
      { line: 2, snippet: 'it.only' },
    ]);
  });

  it('真实调用使钩子退出 2，纯示例文本正常通过', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cloudforge-focused-tests-'));
    const file = join(dir, 'fixture.test.ts');
    const run = () =>
      spawnSync(
        process.execPath,
        [join(ROOT, '.claude/hooks/focused-tests.mjs')],
        {
          cwd: ROOT,
          env: { ...process.env, CLAUDE_PROJECT_DIR: ROOT },
          input: JSON.stringify({ tool_input: { file_path: file } }),
          encoding: 'utf8',
        }
      );
    try {
      writeFileSync(
        file,
        `const fixture = ${JSON.stringify('it.only("example", () => {})')};\n`
      );
      const allowed = run();
      expect(allowed.error).toBeUndefined();
      expect(allowed.status, allowed.stderr).toBe(0);
      expect(allowed.stderr).toBe('');

      writeFileSync(file, 'test.concurrent.only("用例", () => {});\n');
      const blocked = run();
      expect(blocked.error).toBeUndefined();
      expect(blocked.status).toBe(2);
      expect(blocked.stdout).toBe('');
      expect(blocked.stderr).toContain(`${file}:1`);
      expect(blocked.stderr).toContain('test.concurrent.only');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
