// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
// Git 和编码代理钩子共用的 Yarn 入口；不通过 shell 拼接或执行参数。
import { readFileSync, statSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';

function environmentValue(env, name, platform) {
  const key = Object.keys(env)
    .sort()
    .find((key) =>
      platform === 'win32'
        ? key.toUpperCase() === name.toUpperCase()
        : key === name
    );
  return key === undefined ? undefined : env[key];
}

function isFile(path) {
  try {
    return statSync(path).isFile();
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return false;
    throw error;
  }
}

function findCommand(name, { cwd, env, platform }) {
  const path = environmentValue(env, 'PATH', platform);
  if (path === undefined) return null;
  const extensions =
    platform === 'win32'
      ? (environmentValue(env, 'PATHEXT', platform) || '.COM;.EXE;.BAT;.CMD')
          .split(';')
          .filter((extension) => /^\.[a-z0-9]+$/i.test(extension))
          .map((extension) => extension.toLowerCase())
      : [''];
  for (const entry of path.split(platform === 'win32' ? ';' : ':')) {
    const directory = entry.replace(/^"(.*)"$/, '$1');
    for (const extension of extensions) {
      const candidate = resolve(cwd, directory, `${name}${extension}`);
      if (isFile(candidate)) return candidate;
    }
  }
  return null;
}

function commandError(message, code = 'EINVAL') {
  return Object.assign(new Error(message), { code });
}

function nodeShimEntry(command) {
  const source = readFileSync(command, 'utf8');
  // npm、Yarn 和 Corepack 的标准 Windows 启动器都把 %* 原样交给一个
  // 相对 %~dp0 / %dp0% 的 Node 入口。只读取这个入口，不执行批处理文本。
  const invocations = [
    ...source.matchAll(
      /^\s*@?(?:"(?:%~dp0|%dp0%)[\\/]node\.exe"|"?node(?:\.exe)?"?|"%_prog%")\s+"((?:%~dp0|%dp0%)[\\/][^"\r\n]+)"\s+%\*\s*$/gim
    ),
  ];
  const targets = new Set(invocations.map((match) => match[1]));
  if (targets.size !== 1) {
    throw commandError(
      `无法安全解析 Node 启动器：${command}。请使用标准 Yarn/Corepack 安装。`
    );
  }
  const relative = [...targets][0].replace(/^(?:%~dp0|%dp0%)[\\/]/i, '');
  if (/[%!]/.test(relative) || !/\.(?:cjs|mjs|js)$/i.test(relative)) {
    throw commandError(`Node 启动器入口格式不受支持：${command}`);
  }
  const entry = resolve(dirname(command), relative.replaceAll('\\', '/'));
  if (!isFile(entry)) {
    throw commandError(`Node 启动器入口不存在：${entry}`, 'ENOENT');
  }
  return entry;
}

/** 仅在 PATH 中没有 Yarn 时选择 Corepack；已存在但损坏的 Yarn 必须失败。 */
export function resolveYarnCommand({
  cwd = process.cwd(),
  env = process.env,
  platform = process.platform,
} = {}) {
  const options = { cwd, env, platform };
  const yarn = findCommand('yarn', options);
  const command = yarn ?? findCommand('corepack', options);
  if (!command) {
    throw commandError(
      'PATH 中未找到 Yarn 或 Corepack。请安装 Yarn，或安装包含 Corepack 的 Node.js 环境。',
      'ENOENT'
    );
  }
  const prefix = yarn ? [] : ['yarn'];
  if (platform !== 'win32') return { command, args: prefix };

  const extension = extname(command).toLowerCase();
  if (extension === '.exe' || extension === '.com') {
    return { command, args: prefix };
  }
  if (extension === '.cmd' || extension === '.bat') {
    return {
      command: process.execPath,
      args: [nodeShimEntry(command), ...prefix],
    };
  }
  if (['.js', '.cjs', '.mjs'].includes(extension)) {
    return { command: process.execPath, args: [command, ...prefix] };
  }
  throw commandError(`不支持的 Yarn/Corepack 可执行文件：${command}`);
}
