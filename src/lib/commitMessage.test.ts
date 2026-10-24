// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { describe, expect, it } from 'vitest';
import {
  agentIdOfEmail,
  coAuthors,
  isAgentEmail,
  parseCommitMessage,
} from './commitMessage';

describe('parseCommitMessage：解析提交消息', () => {
  it('拆分单行消息', () => {
    expect(parseCommitMessage('Fix the thing')).toEqual({
      subject: 'Fix the thing',
      body: '',
      trailers: [],
    });
  });

  it('保留正文且不把普通段落识别为尾注', () => {
    const m = parseCommitMessage(
      'Add caching\n\nReads were slow.\nNow they are fast.\n'
    );
    expect(m.subject).toBe('Add caching');
    expect(m.body).toBe('Reads were slow.\nNow they are fast.');
    expect(m.trailers).toEqual([]);
  });

  it('最后一段每行都是尾注时将整段作为尾注', () => {
    const m = parseCommitMessage(
      'Learn from #67\n\nLearned from #67 (a/b): dismissed "x"\n\nDismissed-Finding: abc123\nDismissed-Finding: def456\n'
    );
    expect(m.subject).toBe('Learn from #67');
    expect(m.body).toBe('Learned from #67 (a/b): dismissed "x"');
    expect(m.trailers).toEqual([
      { key: 'Dismissed-Finding', value: 'abc123' },
      { key: 'Dismissed-Finding', value: 'def456' },
    ]);
  });

  it('读取紧随主题的尾注', () => {
    const m = parseCommitMessage(
      'Summary\n\nDismissed-Finding: f1\nDismissed-Finding: f2'
    );
    expect(m.body).toBe('');
    expect(m.trailers.map((t) => t.value)).toEqual(['f1', 'f2']);
  });

  it('不将主题或混合内容的末段视为尾注', () => {
    expect(parseCommitMessage('Fixes: the build').trailers).toEqual([]);
    const mixed = parseCommitMessage(
      'Subject\n\nSee the docs.\nCo-Authored-By: A <a@x.y>'
    );
    expect(mixed.trailers).toEqual([]);
    expect(mixed.body).toBe('See the docs.\nCo-Authored-By: A <a@x.y>');
  });

  it('冒号后必须有空格，避免将 URL 视为尾注', () => {
    const m = parseCommitMessage('Subject\n\nhttps://example.com/x');
    expect(m.trailers).toEqual([]);
    expect(m.body).toBe('https://example.com/x');
  });

  it('将缩进续行连接到前一条尾注', () => {
    const m = parseCommitMessage(
      'Subject\n\nBody.\n\nSigned-off-by: A <a@x.y>\nNote: one\n  two'
    );
    expect(m.trailers).toEqual([
      { key: 'Signed-off-by', value: 'A <a@x.y>' },
      { key: 'Note', value: 'one two' },
    ]);
  });

  it('处理 Windows 换行符和末尾空行', () => {
    const m = parseCommitMessage(
      'S\r\n\r\nBody\r\n\r\nCo-Authored-By: C <c@x.y>\r\n\r\n'
    );
    expect(m.subject).toBe('S');
    expect(m.body).toBe('Body');
    expect(m.trailers).toEqual([{ key: 'Co-Authored-By', value: 'C <c@x.y>' }]);
  });
});

describe('coAuthors：共同作者', () => {
  it('读取 Co-Authored-By 尾注时忽略大小写', () => {
    expect(
      coAuthors([
        {
          key: 'Co-Authored-By',
          value: 'Claude Opus 5.5 <noreply@anthropic.com>',
        },
        { key: 'co-authored-by', value: 'Sam' },
        { key: 'Reviewed-by', value: 'Z <z@x.y>' },
      ])
    ).toEqual([
      { name: 'Claude Opus 5.5', email: 'noreply@anthropic.com' },
      { name: 'Sam', email: null },
    ]);
  });
});

describe('代理身份', () => {
  it('识别代理账户邮箱', () => {
    expect(isAgentEmail('u_123@agents.invalid')).toBe(true);
    expect(isAgentEmail(' U_123@Agents.Invalid ')).toBe(true);
    expect(isAgentEmail('a@example.com')).toBe(false);
    expect(isAgentEmail('a@agents.invalid.example.com')).toBe(false);
  });

  it('返回邮箱中的账户 ID', () => {
    expect(agentIdOfEmail('u_123@agents.invalid')).toBe('u_123');
    expect(agentIdOfEmail('a@example.com')).toBeNull();
  });
});
