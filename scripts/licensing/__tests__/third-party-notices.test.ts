// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error: plain JavaScript module, no types
import { main } from '../third-party-notices.mjs';

let root: string;

const write = (file: string, body: unknown) => {
  mkdirSync(join(root, file, '..'), { recursive: true });
  writeFileSync(
    join(root, file),
    typeof body === 'string' ? body : JSON.stringify(body)
  );
};

/** A package in node_modules, as yarn would have installed it. */
const install = (
  name: string,
  license: string | undefined,
  extra: Record<string, unknown> = {}
) =>
  write(`node_modules/${name}/package.json`, {
    name,
    version: '1.0.0',
    ...(license ? { license } : {}),
    ...extra,
  });

const exceptions = (reasons: unknown[]) =>
  write('scripts/licensing/third-party-notices.exceptions.json', { reasons });

/**
 * The two sources that decide whether mermaid can reach the optional ELK layout: the init in
 * `mermaid.ts` and the encoder in `pullGraph.ts`, as the app has them.
 */
const renderPath = ({
  init = "      layout: 'dagre',\n",
  graph = [
    'const KEYWORDS = /click|init|direction/gi;',
    'export function mermaidText(s: string): string {',
    '  out += SAFE.test(ch) && !marks.has(i) ? ch : `#${ch.codePointAt(0)};`;',
    '  return out;',
    '}',
  ].join('\n'),
} = {}) => {
  write('src/lib/ui/mermaid.ts', `mermaid.initialize({\n${init}});\n`);
  write('src/lib/pulls/pullGraph.ts', `${graph}\n`);
};

const banner = (packages: string[]) =>
  write(
    'dist/client/assets/index-abc.js',
    `/*! Third-party software bundled in this file:\n\n${packages
      .map((p) => `${p} — MIT`)
      .join('\n\n')}\n*/\nconsole.log('app');\n`
  );

const run = (options = {}) =>
  main({ root, check: false, write: false, ...options }) as {
    changed: boolean;
    failures: string[];
    packages: number;
    content: string;
  };

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'notices-'));
  write('package.json', { name: 'app', dependencies: { a: '1.0.0' } });
  install('a', 'MIT');
  banner(['a@1.0.0']);
  renderPath();
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('第三方许可清单', () => {
  it('只从 dependencies 出发，跳过 devDependencies', () => {
    write('package.json', {
      name: 'app',
      dependencies: { a: '1.0.0' },
      devDependencies: { vite: '7.0.0' },
    });
    install('vite', 'MIT');
    const result = run();
    expect(result.packages).toBe(1);
    expect(result.content).toContain('`a`');
    expect(result.content).not.toContain('`vite`');
  });

  it('未安装的可选依赖（平台包）不算缺失', () => {
    install('a', 'MIT', {
      optionalDependencies: { '@img/sharp-darwin-x64': '1.0.0' },
    });
    expect(run().failures).toEqual([]);
  });

  it('未安装的必需依赖报错', () => {
    install('a', 'MIT', { dependencies: { missing: '1.0.0' } });
    expect(run().failures.join('\n')).toContain('missing');
  });

  it('manifest 没有 license 时读取 LICENSE 文件', () => {
    install('a', undefined);
    write(
      'node_modules/a/LICENSE',
      'GNU LESSER GENERAL PUBLIC LICENSE\nVersion 3\n'
    );
    exceptions([{ name: 'a', does: 'x', placement: 'client', reason: 'y' }]);
    const result = run();
    expect(result.content).toContain('`LGPL-3.0`');
    expect(result.failures).toEqual([]);
  });

  it('弱 copyleft 必须在例外清单里写明', () => {
    install('a', 'EPL-2.0');
    expect(run().failures.join('\n')).toContain('EPL-2.0');
  });

  it('例外清单与实际产物不一致时报错', () => {
    install('a', 'EPL-2.0');
    exceptions([{ name: 'a', does: 'x', placement: 'worker', reason: 'y' }]);
    expect(run().failures.join('\n')).toContain('客户端产物里也有它');
  });

  it('AGPL 等加压许可直接失败', () => {
    install('a', 'AGPL-3.0-only');
    expect(run().failures.join('\n')).toContain('不兼容');
  });

  it('客户端产物里的包必须仍在依赖树内', () => {
    banner(['a@1.0.0', 'ghost@9.9.9']);
    expect(run().failures.join('\n')).toContain('ghost@9.9.9');
  });

  it('生成结果稳定，内容不变时不标记为改动', () => {
    const first = run();
    expect(first.changed).toBe(true);
    write('THIRD_PARTY_NOTICES.md', first.content);
    expect(run().changed).toBe(false);
  });

  it('没有安装任何依赖时报错，而不是生成空清单', () => {
    rmSync(join(root, 'node_modules'), { recursive: true, force: true });
    expect(run().failures.join('\n')).toContain('依赖树为空');
  });

  it('无调用路径的组件：证实渲染路径没变就通过', () => {
    install('a', 'EPL-2.0', { dependencies: { b: '1.0.0' } });
    install('b', 'MIT');
    banner(['a@1.0.0', 'b@1.0.0']);
    exceptions([
      { name: 'a', does: 'x', placement: 'none', paths: false, reason: 'y' },
    ]);
    const result = run();
    expect(result.failures).toEqual([]);
    expect(result.content).toMatch(/\| `a@1\.0\.0`[^\n]*\| optional chunk \|/);
  });

  it('无调用路径的组件也必须真的还在产物里，否则清单是旧的', () => {
    install('a', 'EPL-2.0');
    banner([]);
    exceptions([
      { name: 'a', does: 'x', placement: 'none', paths: false, reason: 'y' },
    ]);
    expect(run().failures.join('\n')).toContain('不在图中');
  });

  it('mermaid 不再固定 dagre 时，无调用路径的判断失效', () => {
    install('a', 'EPL-2.0');
    banner(['a@1.0.0']);
    exceptions([
      { name: 'a', does: 'x', placement: 'none', paths: false, reason: 'y' },
    ]);
    renderPath({ init: "      layout: 'elk',\n" });
    expect(run().failures.join('\n')).toContain('不再固定 layout');
  });

  it('标题不再逐字编码时，无调用路径的判断失效', () => {
    install('a', 'EPL-2.0');
    banner(['a@1.0.0']);
    exceptions([
      { name: 'a', does: 'x', placement: 'none', paths: false, reason: 'y' },
    ]);
    renderPath({
      graph:
        'const KEYWORDS = /click/gi;\nexport const mermaidText = (s) => s;',
    });
    expect(run().failures.join('\n')).toContain('逐字编码');
  });

  it('构建前后 Artifact 列跟随产物变化', () => {
    install('a', 'MIT', { dependencies: { b: '1.0.0' } });
    install('b', 'MIT');
    expect(run().content).toMatch(/\| `b`\s+\| 1\.0\.0\s+\| worker\s+\|/);
    banner(['a@1.0.0', 'b@1.0.0']);
    expect(run().content).toMatch(/\| `b`\s+\| 1\.0\.0\s+\| client\s+\|/);
  });
});
