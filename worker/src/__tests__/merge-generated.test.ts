// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSE).
import { describe, expect, it } from 'vitest';
import { generatedMatcher } from '../merge/generated';

describe('生成文件不会发送给模型', () => {
  it('匹配目标分支 .orangeignore 中列出的路径', () => {
    const generated = generatedMatcher(
      'generated/\n*.pb.go\n!generated/keep.ts\n'
    );
    expect(generated('generated/api.ts')).toBe(true);
    expect(generated('pkg/types.pb.go')).toBe(true);
    expect(generated('generated/keep.ts')).toBe(false);
    expect(generated('src/api.ts')).toBe(false);
  });

  it('没有 .orangeignore 时仍匹配锁文件', () => {
    const generated = generatedMatcher(null);
    expect(generated('yarn.lock')).toBe(true);
    expect(generated('web/package-lock.json')).toBe(true);
    expect(generated('Cargo.lock')).toBe(true);
    expect(generated('src/lock.ts')).toBe(false);
  });

  it('无论 .orangeignore 如何排除，锁文件和 Drizzle 元数据始终视为生成文件', () => {
    const generated = generatedMatcher(
      '!yarn.lock\n!migrations/meta/0008_snapshot.json\n'
    );
    expect(generated('yarn.lock')).toBe(true);
    expect(generated('migrations/meta/0008_snapshot.json')).toBe(true);
  });

  it('匹配 Drizzle 迁移快照和日志', () => {
    const generated = generatedMatcher(null);
    expect(generated('migrations/meta/0008_snapshot.json')).toBe(true);
    expect(generated('migrations/meta/_journal.json')).toBe(true);
    expect(generated('db/migrations/meta/0001_snapshot.json')).toBe(true);
    // The SQL migrations themselves are reviewed and merged like any file.
    expect(generated('migrations/0008_add_users.sql')).toBe(false);
    expect(generated('migrations/meta/notes.json')).toBe(false);
  });
});
