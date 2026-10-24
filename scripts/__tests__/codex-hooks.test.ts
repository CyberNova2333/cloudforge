import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import {
  delimiter,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const TEMP_ROOT = resolve(tmpdir());
const ownedDirectories: string[] = [];

interface RecordedCommand {
  cwd: string;
  args: string[];
}

function put(root: string, name: string, content: string) {
  const file = join(root, name);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
  return file;
}

function fixture() {
  const root = mkdtempSync(join(TEMP_ROOT, 'codex-hooks-中文 路径-'));
  ownedDirectories.push(root);
  for (const name of ['.codex/hooks', '.claude/hooks']) {
    cpSync(join(ROOT, name), join(root, name), { recursive: true });
  }
  mkdirSync(join(root, 'scripts/githooks'), { recursive: true });
  cpSync(
    join(ROOT, 'scripts/githooks/run-yarn.mjs'),
    join(root, 'scripts/githooks/run-yarn.mjs')
  );
  // The shared test scanner uses the project's installed TypeScript parser.
  symlinkSync(
    join(ROOT, 'node_modules'),
    join(root, 'node_modules'),
    'junction'
  );

  const commands = new Map<string, string>();
  for (const name of ['format', 'typecheck']) {
    commands.set(
      name,
      put(
        root,
        `.fixture/${name} 命令.mjs`,
        `import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
appendFileSync(join(process.cwd(), '${name}.jsonl'), JSON.stringify({
  cwd: process.cwd(), args: process.argv.slice(2)
}) + '\\n');
`
      )
    );
  }
  const configPath = join(root, '.claude/hooks/hooks.config.json');
  const config: Record<string, unknown> = {
    ...JSON.parse(readFileSync(configPath, 'utf8')),
    format: [process.execPath, commands.get('format')!],
    typecheck: [process.execPath, commands.get('typecheck')!],
  };
  const configure = (values: Record<string, unknown>) => {
    Object.assign(config, values);
    writeFileSync(configPath, JSON.stringify(config));
  };
  configure({});

  return {
    root,
    commands,
    configure,
    records(name: string): RecordedCommand[] {
      const file = join(root, `${name}.jsonl`);
      return existsSync(file)
        ? readFileSync(file, 'utf8')
            .trim()
            .split('\n')
            .map((line) => JSON.parse(line) as RecordedCommand)
        : [];
    },
    run(
      event: 'PreToolUse' | 'PostToolUse' | 'Stop',
      command = '',
      options: {
        launchCwd?: string;
        eventCwd?: string;
        extra?: Record<string, unknown>;
        env?: NodeJS.ProcessEnv;
        input?: string;
      } = {}
    ) {
      const result = spawnSync(
        process.execPath,
        [join(root, '.codex/hooks/run.mjs')],
        {
          cwd: options.launchCwd ?? root,
          env: {
            ...process.env,
            ...options.env,
            CLAUDE_PROJECT_DIR: join(root, '错误的根目录'),
          },
          input:
            options.input ??
            JSON.stringify({
              hook_event_name: event,
              tool_name: 'apply_patch',
              cwd: options.eventCwd ?? root,
              tool_input: { command },
              ...options.extra,
            }),
          encoding: 'utf8',
          timeout: 15_000,
        }
      );
      expect(result.error, result.stderr).toBeUndefined();
      expect(result.signal, result.stderr).toBeNull();
      return result;
    },
  };
}

afterEach(() => {
  for (const directory of ownedDirectories.splice(0)) {
    const withinTemp = relative(TEMP_ROOT, resolve(directory));
    if (
      isAbsolute(withinTemp) ||
      withinTemp.startsWith('..') ||
      !withinTemp.startsWith('codex-hooks-中文 路径-')
    ) {
      throw new Error(`拒绝清理不属于测试的目录：${directory}`);
    }
    rmSync(directory, { recursive: true, force: true });
  }
});

const patch = (...sections: string[]) =>
  ['*** Begin Patch', ...sections, '*** End Patch'].join('\n');
const update = (name: string) => `*** Update File: ${name}\n@@\n-old\n+new`;
const add = (name: string) => `*** Add File: ${name}\n+new`;
const move = (from: string, to: string) =>
  `*** Update File: ${from}\n*** Move to: ${to}\n@@\n-old\n+new`;

function denied(result: ReturnType<ReturnType<typeof fixture>['run']>) {
  expect(result.status, result.stderr).toBe(0);
  const output = JSON.parse(result.stdout);
  expect(output).toMatchObject({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
    },
  });
  return output.hookSpecificOutput.permissionDecisionReason as string;
}

describe('Codex 钩子输入校验', () => {
  const secret = '不得回显的钩子载荷-79dc25';
  it.each([
    ['非法 JSON', `{"private":"${secret}"`],
    ['空输入', ''],
    ['null 载荷', 'null'],
    ['空对象', '{}'],
    ['未知事件', JSON.stringify({ hook_event_name: secret, prompt: secret })],
  ])('%s 返回失败且不泄露原始载荷', (_label, input) => {
    const f = fixture();
    const result = f.run('PreToolUse', '', { input });
    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).not.toBe('');
    expect(result.stdout + result.stderr).not.toContain(secret);
    expect(f.records('format')).toEqual([]);
    expect(f.records('typecheck')).toEqual([]);
  });
});

describe('Codex 修改前钩子的完整入口', () => {
  it('允许同一补丁添加、修改、删除和移动普通文件，兼容空格与中文路径', () => {
    const f = fixture();
    const result = f.run(
      'PreToolUse',
      patch(
        add('src/新增 文件.ts'),
        update('src/子目录/修改 文件.ts'),
        '*** Delete File: src/已删除.ts',
        move('src/旧 文件.ts', 'src/新目录/移动 文件.ts')
      )
    );
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({});
    expect(f.records('format')).toEqual([]);
  });

  it.each([
    ['后续修改', update('worker/src/db/auth.schema.ts'), 'auth.schema.ts'],
    ['新增迁移', add('migrations/nested/0001.sql'), '0001.sql'],
    ['删除锁文件', '*** Delete File: yarn.lock', 'yarn.lock'],
    [
      '移动目的地',
      move('src/普通.ts', 'worker/src/db/auth.schema.ts'),
      'auth.schema.ts',
    ],
    [
      '移动来源',
      move('worker/src/db/auth.schema.ts', 'src/普通.ts'),
      'auth.schema.ts',
    ],
  ])('%s 受到保护时返回退出码为零的拒绝 JSON', (_label, section, name) => {
    const f = fixture();
    const reason = denied(
      f.run('PreToolUse', patch(update('src/普通.ts'), section))
    );
    expect(reason).toContain(name);
  });

  it('从子目录启动时仍使用钩子所属仓库的保护配置', () => {
    const f = fixture();
    const child = join(f.root, 'src/子目录');
    mkdirSync(child, { recursive: true });
    expect(
      denied(
        f.run('PreToolUse', patch(update('worker/src/db/auth.schema.ts')), {
          launchCwd: child,
        })
      )
    ).toContain('auth.schema.ts');
  });

  it('按事件工作目录解析父目录路径，阻止通过相对路径修改生成文件', () => {
    const f = fixture();
    const child = join(f.root, '子目录');
    mkdirSync(child, { recursive: true });
    expect(
      denied(
        f.run('PreToolUse', patch(update('../worker/src/db/auth.schema.ts')), {
          launchCwd: child,
          eventCwd: child,
        })
      )
    ).toContain('auth.schema.ts');
  });

  it('拒绝绝对路径指向的生成文件', () => {
    const f = fixture();
    expect(
      denied(
        f.run(
          'PreToolUse',
          patch(update(join(f.root, 'worker/src/db/auth.schema.ts')))
        )
      )
    ).toContain('auth.schema.ts');
  });

  it.each([
    ['修改现有文件', update('src/链接目录/现有.ts')],
    ['新增文件', add('src/链接目录/新增.ts')],
  ])('通过仓库内目录链接%s时仍按真实保护路径拒绝', (_label, command) => {
    const f = fixture();
    put(f.root, '.agents/现有.ts', 'export const generated = true;\n');
    mkdirSync(join(f.root, 'src'), { recursive: true });
    symlinkSync(
      join(f.root, '.agents'),
      join(f.root, 'src/链接目录'),
      'junction'
    );
    expect(denied(f.run('PreToolUse', patch(command)))).toContain('.agents');
  });

  it('补丁正文中的伪造文件头不被当作实际修改目标', () => {
    const f = fixture();
    const result = f.run(
      'PreToolUse',
      patch('*** Add File: src/普通.ts\n+*** Update File: yarn.lock')
    );
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({});
  });

  it('补丁格式无法识别时报告失败，不静默放行', () => {
    const f = fixture();
    const result = f.run('PreToolUse', '这不是 apply_patch 补丁');
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('补丁');
  });

  it('缺少共享保护规则时报告失败，不把配置错误视为允许修改', () => {
    const f = fixture();
    f.configure({ protected: null });
    const result = f.run('PreToolUse', patch(update('src/普通.ts')));
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('protected');
  });

  it('不依赖 transcript 文件，也不把输入载荷写入输出或新增日志', () => {
    const f = fixture();
    const before = readdirSync(f.root).sort();
    const marker = '仅用于验证未记录的私密输入-9fc42';
    const result = f.run('PreToolUse', patch(update('src/普通.ts')), {
      extra: {
        transcript_path: join(f.root, '不存在的会话记录.jsonl'),
        prompt: marker,
        tool_response: marker,
      },
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout + result.stderr).not.toContain(marker);
    expect(readdirSync(f.root).sort()).toEqual(before);
  });
});

describe('Codex 修改后钩子的完整入口', () => {
  it('仓库内链接指向外部目录时不格式化外部文件，同时仍处理仓库自己的文件', () => {
    const f = fixture();
    const outside = mkdtempSync(join(TEMP_ROOT, 'codex-hooks-中文 路径-'));
    ownedDirectories.push(outside);
    const external = put(outside, '外部.ts', 'export const outside = true;\n');
    const local = put(f.root, 'src/本地.ts', 'export const local = true;\n');
    symlinkSync(outside, join(f.root, 'src/外部链接'), 'junction');
    const result = f.run(
      'PostToolUse',
      patch(update('src/外部链接/外部.ts'), update('src/本地.ts'))
    );
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({});
    expect(f.records('format')).toEqual([{ cwd: f.root, args: ['--', local] }]);
    expect(readFileSync(external, 'utf8')).toBe(
      'export const outside = true;\n'
    );
  });

  it('格式化全部仍存在的修改目标，跳过已删除文件和移动来源', () => {
    const f = fixture();
    const names = [
      'src/新增 文件.ts',
      'src/子目录/修改.ts',
      'src/移动 目标.ts',
    ];
    for (const name of names) put(f.root, name, 'export const value = 1;\n');
    const launchCwd = join(f.root, 'src/子目录');
    const result = f.run(
      'PostToolUse',
      patch(
        add(names[0]),
        update(names[1]),
        '*** Delete File: src/已删除.ts',
        move('src/旧位置.ts', names[2])
      ),
      { launchCwd }
    );
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({});
    expect(f.records('format')).toEqual(
      names.map((name) => ({ cwd: f.root, args: ['--', join(f.root, name)] }))
    );
  });

  it('格式化程序失败时阻止通过，并保留其诊断信息', () => {
    const f = fixture();
    put(f.root, 'src/普通.ts', 'export const value=1;\n');
    writeFileSync(
      f.commands.get('format')!,
      "process.stderr.write('格式化夹具拒绝此文件\\n'); process.exit(7);"
    );
    const result = f.run('PostToolUse', patch(update('src/普通.ts')));
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('格式化夹具拒绝此文件');
  });

  it('格式化程序不存在时报告失败', () => {
    const f = fixture();
    put(f.root, 'src/普通.ts', 'export const value=1;\n');
    f.configure({ format: [join(f.root, '不存在的格式化命令')] });
    const result = f.run('PostToolUse', patch(update('src/普通.ts')));
    expect(result.status).toBe(2);
    expect(result.stderr).not.toBe('');
  });

  it.each(['only', 'skip'])(
    '后续测试文件中残留 %s 调用时阻止通过',
    (modifier) => {
      const f = fixture();
      put(f.root, 'src/普通.ts', 'export const value=1;\n');
      put(f.root, 'src/测试.test.ts', `it.${modifier}('用例', () => {});\n`);
      const result = f.run(
        'PostToolUse',
        patch(update('src/普通.ts'), update('src/测试.test.ts'))
      );
      expect(result.status).toBe(2);
      expect(result.stderr).toContain(modifier);
      expect(result.stderr).toContain('测试.test.ts');
    }
  );

  it('某个文件格式化失败后仍检查后续文件，并汇总全部问题', () => {
    const f = fixture();
    const names = ['src/拒绝.ts', 'src/聚焦.test.ts', 'src/正常.ts'];
    put(f.root, names[0], 'export const value=1;\n');
    put(f.root, names[1], "it.only('用例', () => {});\n");
    put(f.root, names[2], 'export const other=2;\n');
    const command = f.commands.get('format')!;
    writeFileSync(
      command,
      readFileSync(command, 'utf8') +
        "if (process.argv.at(-1).endsWith('拒绝.ts')) { process.stderr.write('格式化夹具失败'); process.exit(5); }"
    );
    const result = f.run('PostToolUse', patch(...names.map(update)));
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('格式化夹具失败');
    expect(result.stderr).toContain('only');
    expect(result.stderr).toContain('聚焦.test.ts');
    expect(f.records('format')).toHaveLength(3);
  });

  it('普通测试及注释、字符串中的聚焦示例不误报', () => {
    const f = fixture();
    put(
      f.root,
      'src/正常.test.ts',
      `// it.only('文档示例', () => {});
const example = "test.skip('仅为字符串', () => {})";
it('正常用例', () => {});
`
    );
    const result = f.run('PostToolUse', patch(update('src/正常.test.ts')));
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({});
    expect(f.records('format')).toHaveLength(1);
  });
});

describe('Codex 完成前钩子的完整入口', () => {
  it('从子目录启动时在仓库根目录执行共享类型检查，成功返回 JSON', () => {
    const f = fixture();
    const child = join(f.root, '深层/子目录');
    mkdirSync(child, { recursive: true });
    const result = f.run('Stop', '', { launchCwd: child, eventCwd: child });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({});
    expect(f.records('typecheck')).toEqual([{ cwd: f.root, args: [] }]);
  });

  it('类型检查失败时阻止完成，并保留检查诊断', () => {
    const f = fixture();
    writeFileSync(
      f.commands.get('typecheck')!,
      "process.stderr.write('类型检查夹具失败\\n'); process.exit(3);"
    );
    const result = f.run('Stop');
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('类型检查夹具失败');
  });

  it('类型检查程序不存在时阻止完成', () => {
    const f = fixture();
    f.configure({ typecheck: [join(f.root, '不存在的类型检查命令')] });
    const result = f.run('Stop');
    expect(result.status).toBe(2);
    expect(result.stderr).not.toBe('');
  });

  it('共享配置缺少类型检查命令时阻止完成', () => {
    const f = fixture();
    f.configure({ typecheck: null });
    const result = f.run('Stop');
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('typecheck');
  });

  it('通过共享 Yarn 入口执行检查时捕获命令输出，保持钩子响应为有效 JSON', () => {
    const f = fixture();
    const bin = join(f.root, '.fixture/Yarn 目录');
    const output = '仅供命令输出，不应出现在钩子 JSON 中';
    const script = `const fs = require('node:fs');
fs.writeFileSync('yarn-called.json', JSON.stringify({cwd: process.cwd(), args: process.argv.slice(2)}));
process.stdout.write(${JSON.stringify(output)});
`;
    if (process.platform === 'win32') {
      put(f.root, '.fixture/Yarn 目录/entry.cjs', script);
      put(
        f.root,
        '.fixture/Yarn 目录/yarn.cmd',
        '@echo off\r\nnode "%~dp0\\entry.cjs" %*\r\n'
      );
    } else {
      const launcher = put(
        f.root,
        '.fixture/Yarn 目录/yarn',
        '#!/usr/bin/env node\n' + script
      );
      chmodSync(launcher, 0o755);
    }
    f.configure({ typecheck: 'yarn typecheck' });
    const result = f.run('Stop', '', {
      env: { PATH: [bin, dirname(process.execPath)].join(delimiter) },
    });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({});
    expect(result.stdout + result.stderr).not.toContain(output);
    expect(
      JSON.parse(readFileSync(join(f.root, 'yarn-called.json'), 'utf8'))
    ).toEqual({
      cwd: f.root,
      args: ['typecheck'],
    });
  });

  it('完成钩子重入时不再次运行失败检查，避免无限循环', () => {
    const f = fixture();
    f.configure({ typecheck: null });
    const result = f.run('Stop', '', { extra: { stop_hook_active: true } });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({});
    expect(f.records('typecheck')).toEqual([]);
  });

  it('完成钩子重入时即使配置不是有效 JSON 也直接返回，避免无限循环', () => {
    const f = fixture();
    writeFileSync(join(f.root, '.claude/hooks/hooks.config.json'), '{坏配置');
    const result = f.run('Stop', '', { extra: { stop_hook_active: true } });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({});
    expect(result.stderr).toBe('');
    expect(f.records('typecheck')).toEqual([]);
  });

  it('共享完成检查执行器将超时判为失败', () => {
    const f = fixture();
    const hang = put(
      f.root,
      '.fixture/超时命令.mjs',
      'setTimeout(() => {}, 60_000);'
    );
    const library = pathToFileURL(join(f.root, '.claude/hooks/_lib.mjs')).href;
    const script = `import { runStopGate } from ${JSON.stringify(library)};
runStopGate({ input: {}, command: ${JSON.stringify([process.execPath, hang])}, label: '类型检查', timeoutMs: 50 });`;
    const result = spawnSync(
      process.execPath,
      ['--input-type=module', '-e', script],
      {
        cwd: f.root,
        env: { ...process.env, CLAUDE_PROJECT_DIR: f.root },
        encoding: 'utf8',
        timeout: 10_000,
      }
    );
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/timed out|超时/);
  });
});
