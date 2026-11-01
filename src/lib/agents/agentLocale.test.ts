/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';
import { zh } from '../../locales/zh';
import { localizeAgentsWith, PRESET_TEXT } from './agentLocale';

// The server's presets as text (read, not imported: the web app's type check doesn't cover worker code).
const presetsSource = Object.values(
  import.meta.glob('../../../worker/src/agents/presets.ts', {
    query: '?raw',
    import: 'default',
    eager: true,
  }) as Record<string, string>
)[0];

const mark = (s: string) => `中:${s}`;

describe('与界面语言一致的预设代理', () => {
  it('识别每个预设与服务端一致的准确英文', () => {
    const fromServer: typeof PRESET_TEXT = {};
    for (const block of presetsSource.split(/\n {4}facet: /).slice(1)) {
      const field = (key: string) =>
        block.match(new RegExp(`\\b${key}:\\s*'((?:\\\\.|[^'\\\\])*)'`))?.[1];
      const handle = field('handle');
      if (!handle) continue; // Another `facet:` line further down (presetAgentMd), not a preset.
      fromServer[handle] = {
        name: field('name')!,
        bio: field('bio')!,
        ask: field('triggerAsk')!,
      };
    }
    expect(fromServer).toEqual(PRESET_TEXT);
  });

  it('每个预设的名称、简介和触发问题都有中文', () => {
    const missing = Object.values(PRESET_TEXT)
      .flatMap((p) => [p.name, p.bio, p.ask])
      .filter((s) => !zh[s]);
    expect(missing).toEqual([]);
  });

  it('无论出现在哪里，都仅翻译预设代理自带的文案', () => {
    const p = PRESET_TEXT.securityagent;
    const body = {
      agents: [
        {
          username: 'securityagent',
          name: p.name,
          bio: p.bio,
          trigger: { ask: p.ask, above: 0.4 },
        },
        // Renamed in its AGENT.md: shown as written.
        { username: 'dataagent', name: 'Our data guard', bio: 'Custom.' },
        // Not an agent: a person who happens to be called Security, and a repository called Data.
        { username: 'bob', name: 'Security' },
        { name: 'Data', fullName: 'bob/Data' },
      ],
      presets: [
        {
          handle: 'speedagent',
          name: 'Speed',
          triggerAsk: PRESET_TEXT.speedagent.ask,
        },
      ],
    };
    localizeAgentsWith(body, mark);
    expect(body.agents[0]).toEqual({
      username: 'securityagent',
      name: mark(p.name),
      bio: mark(p.bio),
      trigger: { ask: mark(p.ask), above: 0.4 },
    });
    expect(body.agents[1]).toEqual({
      username: 'dataagent',
      name: 'Our data guard',
      bio: 'Custom.',
    });
    expect(body.agents[2]).toEqual({ username: 'bob', name: 'Security' });
    expect(body.agents[3]).toEqual({ name: 'Data', fullName: 'bob/Data' });
    expect(body.presets[0]).toEqual({
      handle: 'speedagent',
      name: mark('Speed'),
      triggerAsk: mark(PRESET_TEXT.speedagent.ask),
    });
  });
});
