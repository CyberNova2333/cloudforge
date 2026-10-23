// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSE).
import { describe, expect, it } from 'vitest';
import {
  AgentConfigError,
  MAX_AGENT_MD,
  parseAgentConfig,
  readAgentConfig,
} from '../agents/config';
import { ArtifactsRepoClient } from '../git/remote';
import { GitService } from '../git/service';
import { createFakeArtifacts } from './helpers/fake-artifacts';
import { commitPaths } from './helpers/seed';

const VALID = `name: Security Agent
bio: Reviews changes to authentication.
trigger:
  ask: Does this change touch authentication?
  above: 0.3
engine: pass`;

const md = (front: string, body = 'Review carefully.') =>
  `---\n${front}\n---\n${body}\n`;

describe('parseAgentConfig 智能体配置解析', () => {
  it('读取前置元数据和指令', () => {
    expect(
      parseAgentConfig(md(VALID, '# Security\n\nLook for leaked secrets.'))
    ).toEqual({
      name: 'Security Agent',
      bio: 'Reviews changes to authentication.',
      trigger: { ask: 'Does this change touch authentication?', above: 0.3 },
      engine: 'pass',
      instructions: '# Security\n\nLook for leaked secrets.',
    });
  });

  it('bio 默认为空，engine 默认为 pass', () => {
    const front = VALID.replace(
      'bio: Reviews changes to authentication.\n',
      ''
    ).replace('\nengine: pass', '');
    expect(parseAgentConfig(md(front))).toMatchObject({
      bio: '',
      engine: 'pass',
    });
  });

  it('读取可选颜色、领域和 guarded 标记', () => {
    expect(
      parseAgentConfig(
        md(`${VALID}\ncolor: "#2A78D6"\nfacet: security\nguarded: true`)
      )
    ).toMatchObject({ color: '#2a78d6', facet: 'security', guarded: true });
    for (const facet of [
      'security',
      'data',
      'speed',
      'features',
      'reliability',
      'privacy',
      'shipping',
      'other',
    ])
      expect(parseAgentConfig(md(`${VALID}\nfacet: ${facet}`)).facet).toBe(
        facet
      );
    expect(parseAgentConfig(md(`${VALID}\nguarded: false`)).guarded).toBe(
      false
    );
  });

  it('AGENT.md 未提供颜色、领域和 guarded 标记时不包含这些字段', () => {
    const config = parseAgentConfig(md(VALID));
    expect(config.color).toBeUndefined();
    expect(config.facet).toBeUndefined();
    expect(config.guarded).toBeUndefined();
  });

  it('接受 pi 引擎', () => {
    expect(
      parseAgentConfig(md(VALID.replace('engine: pass', 'engine: pi'))).engine
    ).toBe('pi');
  });

  it('读取带 BOM 和 Windows 换行符的文件', () => {
    const source = ('﻿' + md(VALID, 'Body.')).replace(/\n/g, '\r\n');
    expect(parseAgentConfig(source)).toMatchObject({
      name: 'Security Agent',
      trigger: { above: 0.3 },
      instructions: 'Body.',
    });
  });

  it.each([
    ['缺少前置元数据', '# Just Markdown\n', /must start with YAML frontmatter/],
    ['前置元数据未闭合', '---\nname: X\n', /must start with YAML frontmatter/],
    ['无效 YAML', md('name: [unclosed'), /not valid YAML/],
    [
      '缺少名称',
      md(VALID.replace('name: Security Agent\n', '')),
      /AGENT\.md: name/,
    ],
    ['缺少 trigger', md('name: X'), /AGENT\.md: trigger/],
    [
      'above 为 0',
      md(VALID.replace('0.3', '0')),
      /trigger\.above: must be between 0 and 1/,
    ],
    [
      'above 为 1',
      md(VALID.replace('0.3', '1')),
      /trigger\.above: must be between 0 and 1/,
    ],
    ['above 为文本', md(VALID.replace('0.3', '"0.3"')), /trigger\.above/],
    [
      '未知引擎',
      md(VALID.replace('engine: pass', 'engine: gpt')),
      /engine: must be pass or pi/,
    ],
    ['未知字段', md(`${VALID}\nmodel: clef`), /model/],
    [
      '使用颜色名称',
      md(`${VALID}\ncolor: red`),
      /color: must be a colour like "#2a78d6"/,
    ],
    [
      '十六进制颜色过短',
      md(`${VALID}\ncolor: "#2a78d"`),
      /color: must be a colour like "#2a78d6"/,
    ],
    [
      '颜色不是十六进制',
      md(`${VALID}\ncolor: "#2a78zz"`),
      /color: must be a colour like "#2a78d6"/,
    ],
    [
      // YAML reads an unquoted # as the start of a comment, so the value is empty.
      '颜色未加引号',
      md(`${VALID}\ncolor: #2a78d6`),
      /color: .*quote/,
    ],
    [
      '未知领域',
      md(`${VALID}\nfacet: ops`),
      /facet: must be one of security, data, speed, features, reliability, privacy, shipping or other/,
    ],
    [
      'guarded 为文本',
      md(`${VALID}\nguarded: "yes"`),
      /guarded: must be true or false/,
    ],
    ['正文为空', md(VALID, '   '), /no instructions/],
  ])('拒绝 %s', (_, source, message) => {
    expect(() => parseAgentConfig(source)).toThrow(AgentConfigError);
    expect(() => parseAgentConfig(source)).toThrow(message);
  });
});

describe('readAgentConfig 读取智能体配置', () => {
  async function gitWith(files: Record<string, string>) {
    const fake = createFakeArtifacts();
    await fake.binding.create('r_cfg');
    const sha = await commitPaths(
      fake.repos.get('r_cfg')!,
      'main',
      files,
      'Seed'
    );
    return {
      git: new GitService(new ArtifactsRepoClient(fake.binding, 'r_cfg')),
      sha,
    };
  }

  it('读取指定提交中的 AGENT.md', async () => {
    const { git, sha } = await gitWith({ 'AGENT.md': md(VALID) });
    expect(await readAgentConfig(git, sha)).toMatchObject({
      ok: true,
      config: { name: 'Security Agent' },
    });
  });

  it('报告缺失、无效或过大的 AGENT.md', async () => {
    const missing = await gitWith({ 'README.md': 'hi' });
    expect(await readAgentConfig(missing.git, missing.sha)).toEqual({
      ok: false,
      error: 'AGENT.md is missing.',
    });
    const invalid = await gitWith({ 'AGENT.md': md('name: X') });
    expect(await readAgentConfig(invalid.git, invalid.sha)).toMatchObject({
      ok: false,
      error: expect.stringMatching(/^AGENT\.md: trigger/),
    });
    const huge = await gitWith({
      'AGENT.md': md(VALID, 'x'.repeat(MAX_AGENT_MD)),
    });
    expect(await readAgentConfig(huge.git, huge.sha)).toEqual({
      ok: false,
      error: 'AGENT.md is larger than 64 KB.',
    });
  });

  it('加载过大的 AGENT.md 前先检查大小', async () => {
    const { git, sha } = await gitWith({
      'AGENT.md': md(VALID, 'x'.repeat(MAX_AGENT_MD)),
    });
    // Reading the bytes of the oversized blob is what the check must avoid.
    const repo = await git.client.repo();
    const readBlob = repo.readBlob.bind(repo);
    repo.readBlob = async (hash: string) => {
      const blob = await readBlob(hash);
      if (!blob) return blob;
      return Object.assign(blob, {
        arrayBuffer: () => Promise.reject(new Error('不应加载整个 blob')),
      });
    };
    expect(await readAgentConfig(git, sha)).toEqual({
      ok: false,
      error: 'AGENT.md is larger than 64 KB.',
    });
  });
});
