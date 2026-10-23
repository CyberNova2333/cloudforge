// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSE).
import { describe, expect, it } from 'vitest';
import { collect, type Io } from '../collect.ts';

function io(
  tty: boolean,
  answer: string | null = 'prompted'
): Io & { asked: number } {
  const o = {
    tty,
    asked: 0,
    async prompt() {
      o.asked++;
      return answer;
    },
    async select<T>(_m: string, options: { value: T }[]) {
      return options[0]!.value;
    },
    async confirm(_m: string, initial: boolean) {
      return initial;
    },
    print() {},
  };
  return o;
}
const base = { message: 'Name?', flagName: '--name' };

describe('collect：收集输入', () => {
  it('优先顺序为参数、环境变量、草稿、询问', async () => {
    const i = io(true);
    expect(await collect(i, { ...base, flag: 'f', env: 'e', draft: 'd' })).toBe(
      'f'
    );
    expect(await collect(i, { ...base, env: 'e', draft: 'd' })).toBe('e');
    expect(await collect(i, { ...base, draft: 'd' })).toBe('d');
    expect(i.asked).toBe(0);
    expect(await collect(i, base)).toBe('prompted');
    expect(i.asked).toBe(1);
  });
  it('将空字符串视为 undefined', async () => {
    expect(
      await collect(io(true), { ...base, flag: '', env: '', draft: 'd' })
    ).toBe('d');
  });
  it('非终端环境中失败时指出参数名', async () => {
    await expect(collect(io(false), base)).rejects.toThrow(
      '--name is required when not running in a terminal.'
    );
  });
  it('参数或环境变量无效时抛出验证器消息', async () => {
    const validate = (v: string) => (v === 'bad' ? 'nope' : undefined);
    await expect(
      collect(io(true), { ...base, flag: 'bad', validate })
    ).rejects.toThrow('nope');
    await expect(
      collect(io(true), { ...base, env: 'bad', validate })
    ).rejects.toThrow('nope');
  });
  it('忽略无效草稿：终端中询问，否则失败', async () => {
    const validate = (v: string) => (v === 'bad' ? 'nope' : undefined);
    expect(await collect(io(true), { ...base, draft: 'bad', validate })).toBe(
      'prompted'
    );
    await expect(
      collect(io(false), { ...base, draft: 'bad', validate })
    ).rejects.toThrow('--name is required');
  });
  it('非终端环境中返回回退值而非失败', async () => {
    expect(await collect(io(false), { ...base, fallback: 'cloudforge' })).toBe(
      'cloudforge'
    );
  });
  it('将初始值传给输入提示', async () => {
    let seen: string | undefined;
    const i = io(true);
    i.prompt = async (_m, opts) => {
      seen = opts.initial;
      return 'x';
    };
    expect(await collect(i, { ...base, initial: 'cloudforge' })).toBe('x');
    expect(seen).toBe('cloudforge');
  });
  it('取消输入时抛出错误', async () => {
    await expect(collect(io(true, null), base)).rejects.toThrow('Cancelled.');
  });
});
