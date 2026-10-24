import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error: plain JavaScript module, no types
import { resolveYarnCommand, runYarn } from '../run-yarn.mjs';

const helper = fileURLToPath(new URL('../run-yarn.mjs', import.meta.url));
const roots: string[] = [];
const literalArgs = [
  'lint-staged',
  '文件 with spaces.ts',
  '& echo 非命令',
  '$(echo 非命令)',
  '%PATH%',
  '$HOME',
  '"双引号"',
  "'单引号'",
  '^&|<>!',
  '两行\n参数',
  '',
  '--',
];

function directory() {
  const root = mkdtempSync(join(tmpdir(), 'cloudforge-yarn & 中文-'));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    if (
      !resolve(root).startsWith(resolve(tmpdir(), 'cloudforge-yarn & 中文-'))
    ) {
      throw new Error('Yarn 测试临时目录超出预期范围');
    }
    rmSync(root, { recursive: true, force: true });
  }
});

function environment(paths: string[], extra: NodeJS.ProcessEnv = {}) {
  const env = { ...process.env, ...extra };
  // Windows 的 Path / PATH 不能同时出现，否则子进程可能选择另一个值。
  for (const key of Object.keys(env)) {
    if (key.toUpperCase() === 'PATH' || key.toUpperCase() === 'PATHEXT') {
      delete env[key];
    }
  }
  return {
    ...env,
    PATH: paths.join(delimiter),
    PATHEXT: '.COM;.EXE;.BAT;.CMD',
  };
}

function fakeCommand(
  root: string,
  name: 'yarn' | 'corepack',
  { platform = process.platform, modern = false } = {}
) {
  const relative = `node_modules/${name}/bin/${name}.mjs`;
  const entry = join(root, relative);
  mkdirSync(join(root, 'node_modules', name, 'bin'), { recursive: true });
  writeFileSync(
    entry,
    `import { writeFileSync } from 'node:fs';
const name = ${JSON.stringify(name)};
if (process.env.CALL_MARKER) writeFileSync(process.env.CALL_MARKER + '-' + name, '调用');
process.stdout.write(JSON.stringify({ name, args: process.argv.slice(2), cwd: process.cwd(), token: process.env.TEST_TOKEN }));
process.stderr.write('测试标准错误');
if (process.env.TEST_SIGNAL) process.kill(process.pid, process.env.TEST_SIGNAL);
if (process.env.TEST_HANG) setInterval(() => {}, 1000);
else process.exitCode = Number(process.env.TEST_EXIT || 0);
`
  );
  const command = join(root, platform === 'win32' ? `${name}.cmd` : name);
  if (platform === 'win32') {
    const target = relative.replaceAll('/', '\\');
    writeFileSync(
      command,
      modern
        ? `@ECHO off\r\nSET dp0=%~dp0\r\nSET "_prog=node"\r\n"%_prog%" "%dp0%\\${target}" %*\r\n`
        : `@IF EXIST "%~dp0\\node.exe" (\r\n  "%~dp0\\node.exe" "%~dp0\\${target}" %*\r\n) ELSE (\r\n  node "%~dp0\\${target}" %*\r\n)\r\n`
    );
  } else {
    // 使用真实 Node 子进程执行测试程序，避免把 spawnSync 本身模拟掉。
    writeFileSync(
      command,
      `#!${process.execPath}\n${readFileSync(entry, 'utf8')}`
    );
    chmodSync(command, 0o755);
  }
  return { command, entry };
}

function invoke(root: string, env: NodeJS.ProcessEnv, args = literalArgs) {
  return runYarn(args, { cwd: root, env, stdio: 'pipe', encoding: 'utf8' });
}

describe('Git 与编码代理钩子的 Yarn 启动器', () => {
  it('优先使用已有 Yarn，即使 Corepack 更早出现在 PATH 中', () => {
    const root = directory();
    const corepackDir = join(root, 'Corepack 目录');
    const yarnDir = join(root, 'Yarn 目录');
    fakeCommand(corepackDir, 'corepack');
    fakeCommand(yarnDir, 'yarn');
    const marker = join(root, '运行记录');
    const result = invoke(
      root,
      environment([corepackDir, yarnDir], {
        CALL_MARKER: marker,
        TEST_TOKEN: '保留环境变量',
      })
    );
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      name: 'yarn',
      args: literalArgs,
      cwd: root,
      token: '保留环境变量',
    });
    expect(result.stderr).toBe('测试标准错误');
    expect(existsSync(`${marker}-yarn`)).toBe(true);
    expect(existsSync(`${marker}-corepack`)).toBe(false);
  });

  it('缺少 Yarn 时使用 Corepack，保留空格、中文和 shell 特殊字符参数', () => {
    const root = directory();
    fakeCommand(root, 'corepack');
    const result = invoke(root, environment([root]));
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      name: 'corepack',
      args: ['yarn', ...literalArgs],
      cwd: root,
    });
  });

  it('Yarn 非零退出时原样传播状态，且不尝试 Corepack', () => {
    const root = directory();
    fakeCommand(root, 'yarn');
    fakeCommand(root, 'corepack');
    const marker = join(root, '运行记录');
    const env = environment([root], { CALL_MARKER: marker, TEST_EXIT: '23' });
    const result = invoke(root, env);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(23);
    expect(JSON.parse(result.stdout).name).toBe('yarn');
    expect(existsSync(`${marker}-corepack`)).toBe(false);

    const cli = spawnSync(process.execPath, [helper, ...literalArgs], {
      cwd: root,
      env,
      encoding: 'utf8',
      shell: false,
    });
    expect(cli.status).toBe(23);
    expect(JSON.parse(cli.stdout).args).toEqual(literalArgs);
    expect(cli.stderr).toBe('测试标准错误');
    expect(existsSync(`${marker}-corepack`)).toBe(false);
  });

  it('Corepack 失败时也保留退出码', () => {
    const root = directory();
    fakeCommand(root, 'corepack');
    const result = invoke(root, environment([root], { TEST_EXIT: '17' }));
    expect(result.status).toBe(17);
    expect(JSON.parse(result.stdout).name).toBe('corepack');
  });

  it('两个命令均缺失时返回明确错误，CLI 以 127 退出', () => {
    const root = directory();
    const env = environment([root]);
    const result = invoke(root, env);
    expect(result.status).toBeNull();
    expect(result.error.code).toBe('ENOENT');
    expect(result.error.message).toContain('未找到 Yarn 或 Corepack');
    const cli = spawnSync(process.execPath, [helper, 'lint-staged'], {
      cwd: root,
      env,
      encoding: 'utf8',
      shell: false,
    });
    expect(cli.status).toBe(127);
    expect(cli.stderr).toContain('Yarn 启动失败');
  });

  it('子进程超时返回错误，且不尝试 Corepack', () => {
    const root = directory();
    fakeCommand(root, 'yarn');
    fakeCommand(root, 'corepack');
    const marker = join(root, '运行记录');
    const result = runYarn([], {
      cwd: root,
      env: environment([root], { CALL_MARKER: marker, TEST_HANG: '1' }),
      stdio: 'pipe',
      timeout: 100,
    });
    expect(result.error.code).toBe('ETIMEDOUT');
    expect(result.status).not.toBe(0);
    expect(existsSync(`${marker}-corepack`)).toBe(false);
  });

  it.skipIf(process.platform === 'win32')(
    'POSIX 上 Yarn 不可执行时保留 EACCES，且不尝试 Corepack',
    () => {
      const root = directory();
      const { command } = fakeCommand(root, 'yarn');
      fakeCommand(root, 'corepack');
      chmodSync(command, 0o600);
      const marker = join(root, '运行记录');
      const result = invoke(root, environment([root], { CALL_MARKER: marker }));
      expect(result.error.code).toBe('EACCES');
      expect(existsSync(`${marker}-corepack`)).toBe(false);
    }
  );

  it.skipIf(process.platform === 'win32')(
    'POSIX 上保留 Yarn 终止信号，CLI 同样以该信号结束',
    () => {
      const root = directory();
      fakeCommand(root, 'yarn');
      const env = environment([root], { TEST_SIGNAL: 'SIGTERM' });
      const result = invoke(root, env);
      expect(result.status).toBeNull();
      expect(result.signal).toBe('SIGTERM');
      const cli = spawnSync(process.execPath, [helper], {
        cwd: root,
        env,
        encoding: 'utf8',
        shell: false,
      });
      expect(cli.status).toBeNull();
      expect(cli.signal).toBe('SIGTERM');
    }
  );
});

describe('Windows 标准 Node 启动器解析', () => {
  it.each([false, true])(
    '读取 npm/Corepack 包装格式，现代格式为 %s',
    (modern) => {
      const root = directory();
      const { entry } = fakeCommand(root, 'yarn', {
        platform: 'win32',
        modern,
      });
      expect(
        resolveYarnCommand({
          cwd: root,
          env: { Path: `"${root}"`, PATHEXT: '.CMD' },
          platform: 'win32',
        })
      ).toEqual({ command: process.execPath, args: [entry] });
    }
  );

  it('已存在但不可识别的 Yarn 包装器不会回退 Corepack', () => {
    const root = directory();
    fakeCommand(root, 'corepack', { platform: 'win32' });
    writeFileSync(join(root, 'yarn.cmd'), '@exit /b 19\r\n');
    expect(() =>
      resolveYarnCommand({
        cwd: root,
        env: { PATH: root, PATHEXT: '.CMD' },
        platform: 'win32',
      })
    ).toThrow('无法安全解析 Node 启动器');
  });

  it('已存在但入口损坏的 Yarn 不会回退 Corepack', () => {
    const root = directory();
    fakeCommand(root, 'corepack', { platform: 'win32' });
    writeFileSync(join(root, 'yarn.cmd'), 'node "%~dp0\\missing.mjs" %*\r\n');
    expect(() =>
      resolveYarnCommand({
        cwd: root,
        env: { PATH: root, PATHEXT: '.CMD' },
        platform: 'win32',
      })
    ).toThrow('Node 启动器入口不存在');
  });

  it('原生可执行文件按 PATHEXT 优先级直接运行', () => {
    const root = directory();
    fakeCommand(root, 'yarn', { platform: 'win32' });
    const executable = join(root, 'yarn.exe');
    writeFileSync(executable, '原生文件占位');
    expect(
      resolveYarnCommand({
        cwd: root,
        env: { PATH: root, PATHEXT: '.EXE;.CMD' },
        platform: 'win32',
      })
    ).toEqual({ command: executable, args: [] });
  });
});
