// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { describe, expect, it } from 'vitest';
import type { AuditEvent } from './uiApi';
import {
  AUDIT_ACTIONS,
  actorName,
  agentLabel,
  auditCategory,
  auditDetail,
  auditLink,
  auditParts,
  auditText,
} from './auditText';

const person = {
  kind: 'person',
  login: 'mahmoud',
  name: 'Mahmoud H.',
} as const;

/** An event with sensible defaults, so each test says only what it is about. */
const ev = (over: Partial<AuditEvent>): AuditEvent => ({
  id: 'e1',
  at: Date.UTC(2026, 9, 8, 12, 0, 0),
  actor: person,
  via: null,
  action: 'merging.paused',
  target: '',
  data: {},
  repo: 'octocat/cloudforge',
  pull: null,
  ...over,
});

describe('审计摘要中的句子', () => {
  it('mahmoud 暂停 octocat/cloudforge 的合并', () => {
    expect(auditText(ev({ action: 'merging.paused' }))).toBe(
      'mahmoud paused merging on octocat/cloudforge'
    );
  });

  it('CloudForge AI 代表 cho 批准 Speed 在 #74 上的问题', () => {
    expect(
      auditText(
        ev({
          actor: { kind: 'ai', login: 'cho', name: 'Cho' },
          via: 'CloudForge AI',
          action: 'finding.delegated',
          target: 'Token is logged',
          pull: 74,
          data: {
            finding: 'f1',
            kind: 'needs_person',
            agent: 'speedagent',
            decision: 'approve',
            reason: 'It only logs the first four characters.',
          },
        }),
        { scope: 'repo' }
      )
    ).toBe("CloudForge AI approved Speed's finding on #74 for cho");
  });

  it('系统在 #47 合并后删除 stack-tree 分支', () => {
    expect(
      auditText(
        ev({
          actor: { kind: 'system', login: null, name: null },
          action: 'branch.deleted',
          target: 'stack-tree',
          pull: 47,
          data: { sha: 'abc1234', merged: true },
        }),
        { scope: 'repo' }
      )
    ).toBe('System deleted branch stack-tree after #47 merged');
  });
});

describe('操作执行者', () => {
  it('优先以用户名指代用户，缺失时使用姓名', () => {
    expect(actorName({ kind: 'person', login: 'cho', name: 'Cho' })).toBe(
      'cho'
    );
    expect(actorName({ kind: 'person', login: null, name: 'Cho Yin' })).toBe(
      'Cho Yin'
    );
    expect(actorName({ kind: 'person', login: null, name: null })).toBe(
      'A former member'
    );
  });

  it('命名 CloudForge AI、系统和代理', () => {
    expect(actorName({ kind: 'ai', login: 'cho', name: null })).toBe(
      'CloudForge AI'
    );
    expect(actorName({ kind: 'system', login: null, name: null })).toBe(
      'System'
    );
    expect(
      actorName({ kind: 'agent', login: 'securityagent', name: null })
    ).toBe('Security');
  });

  it('页面已知代理名称时使用真实名称', () => {
    expect(
      actorName(
        { kind: 'agent', login: 'a11y', name: null },
        { a11y: 'Accessibility' }
      )
    ).toBe('Accessibility');
  });

  it('将账号名转换为常用名称', () => {
    expect(agentLabel('speedagent')).toBe('Speed');
    expect(agentLabel('dataagent')).toBe('Data');
    expect(agentLabel('reviewer')).toBe('reviewer');
    expect(agentLabel('speedagent', { speedagent: 'Speedy' })).toBe('Speedy');
  });
});

describe('仓库视图与实例视图', () => {
  const merged = ev({
    action: 'pull.merged',
    target: '#12',
    pull: 12,
    data: {
      title: 'Fix the queue',
      sha: 'abc',
      into: 'main',
      automatic: false,
    },
  });

  it('仓库自身的日志不重复显示仓库名', () => {
    expect(auditText(merged, { scope: 'repo' })).toBe(
      'mahmoud merged #12 “Fix the queue” into main'
    );
  });

  it('实例日志包含仓库名', () => {
    expect(auditText(merged)).toBe(
      'mahmoud merged octocat/cloudforge#12 “Fix the queue” into main'
    );
  });

  it('为仓库和拉取请求添加链接', () => {
    const parts = auditParts(merged);
    expect(parts.find((p) => p.kind === 'pull')).toEqual({
      kind: 'pull',
      text: 'octocat/cloudforge#12',
      to: '/octocat/cloudforge/pull/12',
    });
    expect(parts[0]).toEqual({ kind: 'who', text: 'mahmoud' });
    const paused = auditParts(ev({ action: 'merging.paused' }));
    expect(paused.find((p) => p.kind === 'repo')).toEqual({
      kind: 'repo',
      text: 'octocat/cloudforge',
      to: '/octocat/cloudforge',
    });
  });

  it('实例事件没有仓库时保持原样', () => {
    expect(
      auditText(
        ev({
          action: 'token.created',
          repo: null,
          target: 'laptop',
          data: { token: 't1', expiresAt: null },
        })
      )
    ).toBe('mahmoud created the access token “laptop”');
  });

  it('显示用户通过何种入口作出变更', () => {
    expect(
      auditText(ev({ action: 'merging.resumed', via: 'Claude Code' }))
    ).toBe('mahmoud resumed merging on octocat/cloudforge via Claude Code');
  });
});

describe('每项审计操作都构成一个句子', () => {
  const cases: [string, Partial<AuditEvent>, string][] = [
    [
      'settings.changed 设置变更',
      {
        action: 'settings.changed',
        target: 'octocat/cloudforge',
        data: {
          changes: {
            defaultBranch: { from: 'main', to: 'trunk' },
            description: { from: 'a', to: 'b' },
          },
        },
      },
      'mahmoud changed the default branch and the description on octocat/cloudforge',
    ],
    [
      'settings.changed 不包含已知字段',
      { action: 'settings.changed', data: {} },
      'mahmoud changed settings on octocat/cloudforge',
    ],
    [
      'collaborator.added 添加协作者',
      { action: 'collaborator.added', target: 'cho' },
      'mahmoud added cho as a collaborator on octocat/cloudforge',
    ],
    [
      'collaborator.removed 移除协作者',
      { action: 'collaborator.removed', target: 'cho' },
      'mahmoud removed cho as a collaborator on octocat/cloudforge',
    ],
    [
      'agent.invited 邀请智能体',
      { action: 'agent.invited', target: 'speedagent' },
      'mahmoud invited Speed to review octocat/cloudforge',
    ],
    [
      'agent.removed 移除智能体',
      { action: 'agent.removed', target: 'speedagent' },
      'mahmoud removed Speed as a reviewer on octocat/cloudforge',
    ],
    [
      'agent.created 创建智能体',
      {
        action: 'agent.created',
        repo: null,
        target: 'securityagent',
        data: { name: 'Security', preset: 'security' },
      },
      'mahmoud created the reviewer Security',
    ],
    [
      'agent.deleted 删除智能体',
      { action: 'agent.deleted', repo: null, target: 'securityagent' },
      'mahmoud deleted the reviewer Security',
    ],
    [
      'agent.restored 恢复智能体',
      { action: 'agent.restored', repo: null, target: 'securityagent' },
      'mahmoud restored the reviewer Security',
    ],
    [
      'secret.saved 在仓库中新建密钥',
      {
        action: 'secret.saved',
        target: 'NPM_TOKEN',
        data: { scope: 'repository', created: true },
      },
      'mahmoud added the Actions secret NPM_TOKEN in octocat/cloudforge',
    ],
    [
      'variable.saved 保存实例级变量',
      {
        action: 'variable.saved',
        repo: null,
        target: 'REGION',
        data: { scope: 'instance', created: false },
      },
      'mahmoud updated the Actions variable REGION for every repository',
    ],
    [
      'secret.saved 保存实例级密钥',
      {
        action: 'secret.saved',
        repo: null,
        target: 'DEPLOY_KEY',
        data: { scope: 'instance', created: true },
      },
      'mahmoud added the Actions secret DEPLOY_KEY for the instance',
    ],
    [
      'secret.repositories 调整实例级密钥的可用仓库',
      {
        action: 'secret.repositories',
        repo: null,
        target: 'DEPLOY_KEY',
        data: {
          added: ['octocat/api', 'octocat/web'],
          removed: ['octocat/old'],
        },
      },
      'mahmoud changed which repositories the instance secret DEPLOY_KEY reaches: added octocat/api and octocat/web; removed octocat/old',
    ],
    [
      'secret.deleted 删除密钥',
      {
        action: 'secret.deleted',
        target: 'NPM_TOKEN',
        data: { scope: 'repository' },
      },
      'mahmoud deleted the Actions secret NPM_TOKEN in octocat/cloudforge',
    ],
    [
      'variable.deleted 删除实例级变量',
      {
        action: 'variable.deleted',
        repo: null,
        target: 'REGION',
        data: { scope: 'instance' },
      },
      'mahmoud deleted the Actions variable REGION for every repository',
    ],
    [
      'user.password_reset 通过重置链接设置新密码',
      {
        action: 'user.password_reset',
        repo: null,
        target: '@mahmoud',
        data: {},
      },
      'mahmoud set a new password with a reset link',
    ],
    [
      'user.password_reset_link 管理员生成并发送重置链接',
      {
        action: 'user.password_reset_link',
        repo: null,
        target: '@bob',
        data: { emailed: true },
      },
      'mahmoud created a password reset link for @bob and emailed it',
    ],
    [
      'user.password_reset_link 未发送邮件',
      {
        action: 'user.password_reset_link',
        repo: null,
        target: '@bob',
        data: { emailed: false },
      },
      'mahmoud created a password reset link for @bob',
    ],
    [
      'user.password_set 安装器直接设置新密码',
      {
        actor: { kind: 'system', login: null, name: null },
        action: 'user.password_set',
        repo: null,
        target: '@bob',
        via: 'cloudforge reset-password',
        data: {},
      },
      'System set a new password for @bob via cloudforge reset-password',
    ],
    [
      'instance.oidc_configuration 管理员发布外部身份提供方配置',
      {
        action: 'instance.oidc_configuration',
        repo: null,
        target: 'company',
        data: { providerId: 'company', version: 2 },
      },
      'mahmoud published the OIDC provider configuration for company',
    ],
    [
      'user.oidc_linked 成员确认绑定外部身份',
      {
        action: 'user.oidc_linked',
        repo: null,
        target: 'company',
        data: { providerId: 'company', actionId: 'link-action' },
      },
      'mahmoud linked an external identity through company',
    ],
    [
      'user.oidc_revoked 成员撤销外部身份绑定',
      {
        action: 'user.oidc_revoked',
        repo: null,
        target: 'company',
        data: { providerId: 'company', bindingId: 'binding-one' },
      },
      'mahmoud revoked an external identity binding for company',
    ],
    [
      'user.oidc_signed_in 成员以已绑定外部身份完成本地登录',
      {
        action: 'user.oidc_signed_in',
        repo: null,
        target: 'company',
        data: { providerId: 'company' },
      },
      'mahmoud signed in through the OIDC provider company',
    ],
    [
      'user.deleted 管理员原子删除无仓库成员',
      { action: 'user.deleted', repo: null, target: 'member-id', data: {} },
      'mahmoud deleted the member member-id',
    ],
    [
      'artifact.deleted 删除产物',
      { action: 'artifact.deleted', target: 'dist', data: { run: 12 } },
      'mahmoud deleted the artifact dist of run #12 in octocat/cloudforge',
    ],
    [
      'branch.deleted 由人工删除分支',
      { action: 'branch.deleted', target: 'old-idea', data: { sha: 'abc' } },
      'mahmoud deleted branch old-idea in octocat/cloudforge',
    ],
    [
      'branches.cleaned 清理分支',
      {
        action: 'branches.cleaned',
        target: '3 branches',
        data: { branches: ['a', 'b', 'c'], shas: {} },
      },
      'mahmoud cleaned up 3 merged branches in octocat/cloudforge',
    ],
    [
      'merging.paused 暂停合并',
      { action: 'merging.paused' },
      'mahmoud paused merging on octocat/cloudforge',
    ],
    [
      'merging.resumed 恢复合并',
      { action: 'merging.resumed' },
      'mahmoud resumed merging on octocat/cloudforge',
    ],
    [
      'pull.merged 合并拉取请求',
      {
        action: 'pull.merged',
        target: '#12',
        pull: 12,
        data: { title: 'Fix it', into: 'main', automatic: false },
      },
      'mahmoud merged octocat/cloudforge#12 “Fix it” into main',
    ],
    [
      'pull.merged 自动合并',
      {
        actor: { kind: 'system', login: null, name: null },
        action: 'pull.merged',
        target: '#12',
        pull: 12,
        data: { title: 'Fix it', into: 'main', automatic: true },
      },
      'System merged octocat/cloudforge#12 “Fix it” into main',
    ],
    [
      'pull.reverted 回退拉取请求',
      { action: 'pull.reverted', target: '#12', pull: 12 },
      'mahmoud reverted octocat/cloudforge#12',
    ],
    [
      'pull.reverted 显示新建的回退拉取请求',
      {
        action: 'pull.reverted',
        target: '#12',
        pull: 12,
        data: { revert: 13 },
      },
      'mahmoud reverted octocat/cloudforge#12 with octocat/cloudforge#13',
    ],
    [
      'pull.approved 批准拉取请求',
      { action: 'pull.approved', target: '#12', pull: 12 },
      'mahmoud approved octocat/cloudforge#12',
    ],
    [
      'finding.approved 批准审查意见',
      {
        action: 'finding.approved',
        target: 'Token is logged',
        pull: 74,
        data: { finding: 'f', kind: 'needs_person', agent: 'securityagent' },
      },
      "mahmoud approved Security's finding on octocat/cloudforge#74",
    ],
    [
      'finding.approved 在修改请求上表示驳回',
      {
        action: 'finding.approved',
        target: 'Slow query',
        pull: 74,
        data: { finding: 'f', kind: 'change_requested', agent: 'speedagent' },
      },
      "mahmoud dismissed Speed's change request on octocat/cloudforge#74",
    ],
    [
      'finding.changes_requested 要求修改',
      {
        action: 'finding.changes_requested',
        target: 'Slow query',
        pull: 74,
        data: { finding: 'f', kind: 'needs_person', agent: 'speedagent' },
      },
      "mahmoud asked for changes on Speed's finding on octocat/cloudforge#74",
    ],
    [
      'finding.assigned 指派审查意见',
      {
        action: 'finding.assigned',
        target: 'Slow query',
        pull: 74,
        data: { finding: 'f', agent: 'speedagent', assignee: 'cho' },
      },
      "mahmoud assigned Speed's finding on octocat/cloudforge#74 to cho",
    ],
    [
      'finding.assigned 清除指派',
      {
        action: 'finding.assigned',
        target: 'Slow query',
        pull: 74,
        data: { finding: 'f', agent: 'speedagent', assignee: null },
      },
      "mahmoud unassigned Speed's finding on octocat/cloudforge#74",
    ],
    [
      'finding.delegated 委托批准',
      {
        actor: { kind: 'ai', login: 'cho', name: null },
        via: 'CloudForge AI',
        action: 'finding.delegated',
        pull: 74,
        data: {
          agent: 'speedagent',
          kind: 'needs_person',
          decision: 'approve',
        },
      },
      "CloudForge AI approved Speed's finding on octocat/cloudforge#74 for cho",
    ],
    [
      'finding.delegated 委托要求修改',
      {
        actor: { kind: 'ai', login: 'cho', name: null },
        via: 'CloudForge AI',
        action: 'finding.delegated',
        pull: 74,
        data: {
          agent: 'speedagent',
          kind: 'needs_person',
          decision: 'request_changes',
        },
      },
      "CloudForge AI asked for changes on Speed's finding on octocat/cloudforge#74 for cho",
    ],
    [
      'finding.delegated 留待人工处理',
      {
        actor: { kind: 'ai', login: 'cho', name: null },
        via: 'CloudForge AI',
        action: 'finding.delegated',
        pull: 74,
        data: { agent: 'speedagent', decision: 'leave', reason: 'Unsure.' },
      },
      "CloudForge AI left Speed's finding on octocat/cloudforge#74 for cho to decide",
    ],
    [
      'finding.undone 撤销 AI 决定',
      {
        action: 'finding.undone',
        pull: 74,
        data: {
          agent: 'speedagent',
          undid: 'approved',
          via: 'CloudForge AI',
        },
      },
      "mahmoud undid CloudForge AI's decision on Speed's finding on octocat/cloudforge#74",
    ],
    [
      'finding.undone 撤销自己的决定',
      {
        action: 'finding.undone',
        pull: 74,
        data: { agent: 'speedagent', undid: 'changes_requested', via: null },
      },
      "mahmoud reopened Speed's finding on octocat/cloudforge#74",
    ],
    [
      'finding.taught 附加指导说明',
      {
        action: 'finding.taught',
        pull: 74,
        data: { agent: 'speedagent', teach: 'Never flag test files.' },
      },
      'mahmoud taught Speed a rule from its finding on octocat/cloudforge#74',
    ],
    [
      'token.created 创建令牌',
      {
        action: 'token.created',
        repo: null,
        target: 'laptop',
        data: { token: 't', expiresAt: null },
      },
      'mahmoud created the access token “laptop”',
    ],
    [
      'token.deleted 删除令牌',
      {
        action: 'token.deleted',
        repo: null,
        target: 'laptop',
        data: { token: 't' },
      },
      'mahmoud deleted the access token “laptop”',
    ],
    [
      'visibility.changed 修改可见性',
      {
        action: 'visibility.changed',
        target: 'octocat/cloudforge',
        data: { from: 'private', to: 'internal' },
      },
      'mahmoud made octocat/cloudforge internal',
    ],
    [
      'repository.created 创建仓库',
      {
        action: 'repository.created',
        target: 'octocat/cloudforge',
        data: { visibility: 'private' },
      },
      'mahmoud created octocat/cloudforge (private)',
    ],
    [
      'repository.deleted 删除仓库',
      {
        action: 'repository.deleted',
        repo: null,
        target: 'choyiny/old-thing',
        data: { repository: 'r1' },
      },
      'mahmoud deleted choyiny/old-thing',
    ],
    [
      'instance.settings 修改实例设置',
      {
        action: 'instance.settings',
        repo: null,
        target: 'actions.retention_days',
        data: { value: 30 },
      },
      'mahmoud changed the instance setting Actions retention days',
    ],
    [
      'instance.settings 重置实例设置',
      {
        action: 'instance.settings',
        repo: null,
        target: 'ai.review_model',
        data: { reset: true },
      },
      'mahmoud reset the instance setting AI review model to its default',
    ],
    [
      'release.created 创建发行版本',
      {
        action: 'release.created',
        target: 'v1.2.0',
        data: { sha: 'abc', pulls: 3 },
      },
      'mahmoud released v1.2.0 of octocat/cloudforge',
    ],
    [
      'release.updated 更新发行版本',
      {
        action: 'release.updated',
        target: 'v1.2.0',
        data: { fields: ['title', 'notes'] },
      },
      'mahmoud edited the title and notes of release v1.2.0 in octocat/cloudforge',
    ],
    [
      'release.updated 仅更新发行说明',
      {
        action: 'release.updated',
        target: 'v1.2.0',
        data: { fields: ['notes'] },
      },
      'mahmoud edited the notes of release v1.2.0 in octocat/cloudforge',
    ],
    [
      'pull.version_bump 设置版本递增级别',
      {
        action: 'pull.version_bump',
        target: '#4',
        pull: 4,
        data: { from: null, to: 'minor' },
      },
      'mahmoud set the version bump to minor on octocat/cloudforge#4',
    ],
    [
      'pull.version_bump 修改版本递增级别',
      {
        action: 'pull.version_bump',
        target: '#4',
        pull: 4,
        data: { from: 'minor', to: 'major' },
      },
      'mahmoud changed the version bump from minor to major on octocat/cloudforge#4',
    ],
    [
      'pull.version_bump 清除版本递增级别',
      {
        action: 'pull.version_bump',
        target: '#4',
        pull: 4,
        data: { from: 'patch', to: null },
      },
      'mahmoud cleared the version bump on octocat/cloudforge#4',
    ],
    [
      'issue.deleted 删除议题',
      { action: 'issue.deleted', target: '#12', data: { title: 'Spam' } },
      'mahmoud deleted issue #12 in octocat/cloudforge',
    ],
    [
      'issue.comment_deleted 删除他人评论',
      { action: 'issue.comment_deleted', target: '#12' },
      "mahmoud deleted someone's comment on issue #12 in octocat/cloudforge",
    ],
    [
      'label.created 新建标签',
      { action: 'label.created', target: 'bug' },
      'mahmoud created the label “bug” in octocat/cloudforge',
    ],
    [
      'label.updated 修改标签',
      { action: 'label.updated', target: 'bug' },
      'mahmoud edited the label “bug” in octocat/cloudforge',
    ],
    [
      'label.deleted 删除标签',
      { action: 'label.deleted', target: 'bug' },
      'mahmoud deleted the label “bug” in octocat/cloudforge',
    ],
    [
      'webhook.created 新建 webhook',
      { action: 'webhook.created', target: 'ci.example.com' },
      'mahmoud added a webhook for ci.example.com in octocat/cloudforge',
    ],
    [
      'webhook.updated 修改 webhook',
      { action: 'webhook.updated', target: 'ci.example.com' },
      'mahmoud edited the webhook for ci.example.com in octocat/cloudforge',
    ],
    [
      'webhook.deleted 删除 webhook',
      { action: 'webhook.deleted', target: 'ci.example.com' },
      'mahmoud deleted the webhook for ci.example.com in octocat/cloudforge',
    ],
    [
      'deploy_token.created 新建部署令牌',
      { action: 'deploy_token.created', target: 'production' },
      'mahmoud created the deploy token “production” in octocat/cloudforge',
    ],
    [
      'deploy_token.deleted 撤销部署令牌',
      { action: 'deploy_token.deleted', target: 'production' },
      'mahmoud revoked the deploy token “production” in octocat/cloudforge',
    ],
    [
      'deploy_token.pushed 部署身份推送',
      {
        action: 'deploy_token.pushed',
        target: 'production',
        actor: { kind: 'system', login: null, name: null },
      },
      'System pushed with deploy token “production” in octocat/cloudforge',
    ],
  ];

  it.each(cases)('审计操作：%s', (_name, over, sentence) => {
    expect(auditText(ev(over))).toBe(sentence);
  });

  it('覆盖规范列出的每项操作', () => {
    // Every audit_events action (auditActions in worker/src/db/app.schema.ts).
    expect([...AUDIT_ACTIONS].sort()).toEqual(
      [
        'settings.changed',
        'collaborator.added',
        'collaborator.removed',
        'agent.invited',
        'agent.removed',
        'agent.created',
        'agent.deleted',
        'agent.restored',
        'artifact.deleted',
        'secret.saved',
        'secret.deleted',
        'secret.repositories',
        'variable.saved',
        'variable.deleted',
        'user.password_reset',
        'user.password_reset_link',
        'user.password_set',
        'branch.deleted',
        'branches.cleaned',
        'merging.paused',
        'merging.resumed',
        'pull.merged',
        'pull.reverted',
        'pull.approved',
        'finding.approved',
        'finding.changes_requested',
        'finding.assigned',
        'finding.delegated',
        'finding.undone',
        'finding.taught',
        'token.created',
        'token.deleted',
        'deploy_token.created',
        'deploy_token.deleted',
        'deploy_token.pushed',
        'visibility.changed',
        'repository.created',
        'repository.deleted',
        'instance.settings',
        'instance.oidc_configuration',
        'user.oidc_linked',
        'user.oidc_revoked',
        'user.oidc_signed_in',
        'user.deleted',
        'release.created',
        'release.updated',
        'pull.version_bump',
        'issue.deleted',
        'issue.comment_deleted',
        'label.created',
        'label.updated',
        'label.deleted',
        'webhook.created',
        'webhook.updated',
        'webhook.deleted',
      ].sort()
    );
  });

  it('为每项操作提供用例', () => {
    const covered = new Set(
      cases.map(([, over]) => over.action).filter(Boolean)
    );
    for (const action of AUDIT_ACTIONS) expect(covered.has(action)).toBe(true);
  });
});

describe('仓库自身的日志', () => {
  it.each<[string, Partial<AuditEvent>, string]>([
    [
      '设置变更',
      { action: 'settings.changed', data: { changes: { name: {} } } },
      'mahmoud changed the name',
    ],
    [
      '邀请智能体',
      { action: 'agent.invited', target: 'speedagent' },
      'mahmoud invited Speed to review this repository',
    ],
    [
      '移除智能体',
      { action: 'agent.removed', target: 'speedagent' },
      'mahmoud removed Speed as a reviewer on this repository',
    ],
    [
      '修改可见性',
      {
        action: 'visibility.changed',
        data: { from: 'internal', to: 'private' },
      },
      'mahmoud made this repository private',
    ],
    [
      '创建仓库',
      { action: 'repository.created', data: { visibility: 'internal' } },
      'mahmoud created this repository (internal)',
    ],
    ['暂停合并', { action: 'merging.paused' }, 'mahmoud paused merging'],
    [
      '清理分支',
      {
        action: 'branches.cleaned',
        data: { branches: ['a'] },
        target: '1 branch',
      },
      'mahmoud cleaned up 1 merged branch',
    ],
    [
      '发布版本',
      { action: 'release.created', target: 'v0.1.0', data: { pulls: 9 } },
      'mahmoud released v0.1.0',
    ],
    [
      '版本递增',
      {
        action: 'pull.version_bump',
        pull: 4,
        data: { from: null, to: 'patch' },
      },
      'mahmoud set the version bump to patch on #4',
    ],
  ])('仓库操作：%s', (_n, over, sentence) => {
    expect(auditText(ev(over), { scope: 'repo' })).toBe(sentence);
  });
});

describe('同一日志中的拉取请求时间线', () => {
  const system = { kind: 'system', login: null, name: null } as const;
  it.each<[string, Partial<AuditEvent>, string]>([
    [
      '状态变更',
      {
        actor: system,
        action: 'pull.state_changed',
        pull: 74,
        data: { state: 'ready' },
      },
      'System marked #74 as ready to merge',
    ],
    [
      '等待人工处理',
      {
        actor: system,
        action: 'pull.state_changed',
        pull: 74,
        data: { state: 'human_review' },
      },
      'System marked #74 as waiting on a person',
    ],
    [
      '建立堆叠关系',
      { actor: system, action: 'pull.stacked', pull: 74, data: { pr: 73 } },
      'System stacked #74 on #73',
    ],
    [
      '移除堆叠关系',
      { actor: system, action: 'pull.unstacked', pull: 74, data: { pr: 73 } },
      'System unstacked #74 from #73',
    ],
    [
      '排序记录在较晚合并的拉取请求上',
      {
        actor: system,
        action: 'pull.ordered',
        pull: 73,
        data: { before: 72, for_pr: 74 },
      },
      'System set #73 to land after #72, so #74 can build on both',
    ],
    [
      '没有第三个拉取请求时排序',
      {
        actor: system,
        action: 'pull.ordered',
        pull: 73,
        data: { before: 72, for_pr: 73 },
      },
      'System set #73 to land after #72',
    ],
    [
      '需要考虑另一拉取请求',
      {
        actor: system,
        action: 'pull.must_account_for',
        pull: 74,
        data: { pr: 73 },
      },
      'System flagged #74 as needing to account for #73',
    ],
    [
      '已考虑另一拉取请求',
      {
        actor: system,
        action: 'pull.accounted_for',
        pull: 74,
        data: { pr: 73 },
      },
      'System marked #74 as accounted for #73',
    ],
    [
      '驳回依赖关系',
      { action: 'pull.dismissed', pull: 74, data: { pr: 73 } },
      'mahmoud dismissed the dependency of #74 on #73',
    ],
    [
      '撤回批准',
      { action: 'pull.withdrawn', pull: 74 },
      'mahmoud withdrew their approval of #74',
    ],
    [
      '完成学习',
      {
        actor: { kind: 'agent', login: 'speedagent', name: 'Speed' },
        action: 'pull.learned',
        pull: 74,
        data: { handle: 'speedagent', findings: 2 },
      },
      'Speed learned from 2 dismissed findings on #74',
    ],
    [
      '完成变基',
      {
        actor: system,
        action: 'pull.rebased',
        pull: 74,
        data: { onto: 'main', from: 'a'.repeat(40), to: 'b'.repeat(40) },
      },
      'System rebased #74 onto main',
    ],
  ])('时间线事件：%s', (_n, over, sentence) => {
    expect(auditText(ev(over), { scope: 'repo' })).toBe(sentence);
  });

  it('在详情行说明拉取请求的阻塞原因', () => {
    expect(
      auditDetail(
        ev({
          actor: system,
          action: 'pull.state_changed',
          pull: 74,
          data: {
            state: 'human_review',
            reasons: [{ kind: 'changes_requested', flags: 2 }],
          },
        })
      )
    ).toBe('changes requested on 2 flags');
  });
});

describe('数据未提供的信息', () => {
  it('处理未知操作', () => {
    expect(
      auditText(ev({ action: 'pull.something_new', pull: 5, target: '#5' }), {
        scope: 'repo',
      })
    ).toBe('mahmoud recorded something new on #5');
    expect(
      auditText(ev({ action: 'widget.frobbed', repo: null, target: 'w1' }))
    ).toBe('mahmoud widget frobbed w1');
  });

  it('处理未指明代理的问题', () => {
    expect(
      auditText(
        ev({
          action: 'finding.approved',
          pull: 9,
          data: { kind: 'needs_person' },
        }),
        { scope: 'repo' }
      )
    ).toBe('mahmoud approved a finding on #9');
  });

  it('处理已移除的执行者', () => {
    expect(
      auditText(
        ev({
          actor: { kind: 'person', login: null, name: null },
          action: 'merging.resumed',
        }),
        { scope: 'repo' }
      )
    ).toBe('A former member resumed merging');
  });

  it('处理不符合预期的数据', () => {
    expect(
      auditText(
        ev({
          action: 'settings.changed',
          data: { changes: 'nonsense' },
        }),
        { scope: 'repo' }
      )
    ).toBe('mahmoud changed settings');
    expect(
      auditText(ev({ action: 'branches.cleaned', target: 'some', data: {} }), {
        scope: 'repo',
      })
    ).toBe('mahmoud cleaned up merged branches');
  });
});

describe('第二行详情', () => {
  it('引用问题及决定理由', () => {
    expect(
      auditDetail(
        ev({
          action: 'finding.approved',
          target: 'Token is logged',
          pull: 74,
          data: {
            agent: 'securityagent',
            kind: 'needs_person',
            reason: 'Only the first four characters.',
          },
        })
      )
    ).toBe('“Token is logged”. Reason: Only the first four characters.');
  });

  it('显示修改要求的备注和教学内容', () => {
    expect(
      auditDetail(
        ev({
          action: 'finding.changes_requested',
          target: 'Slow query',
          data: { note: 'Add an index.' },
        })
      )
    ).toBe('“Slow query”. Note: Add an index.');
    expect(
      auditDetail(
        ev({
          action: 'finding.taught',
          target: 'Slow query',
          data: { teach: 'Never flag test files.' },
        })
      )
    ).toBe('“Slow query”. Taught: Never flag test files.');
  });

  it('显示 CloudForge AI 的判断', () => {
    expect(
      auditDetail(
        ev({
          actor: { kind: 'ai', login: 'cho', name: null },
          action: 'finding.delegated',
          target: 'Slow query',
          data: { decision: 'leave', reason: 'Unsure.' },
        })
      )
    ).toBe('“Slow query”. Why: Unsure.');
  });

  it('显示设置的具体变更', () => {
    expect(
      auditDetail(
        ev({
          action: 'settings.changed',
          data: {
            changes: {
              defaultBranch: { from: 'main', to: 'trunk' },
              protectedBranches: { from: [], to: ['main', 'release/*'] },
              deleteMergedBranches: { from: true, to: false },
            },
          },
        })
      )
    ).toBe(
      'Default branch: main → trunk. Protected branches: none → main, release/*. Automatic branch clean-up: on → off'
    );
  });

  it('列出清理的分支和实例设置值', () => {
    expect(
      auditDetail(
        ev({
          action: 'branches.cleaned',
          data: { branches: ['a', 'b'], shas: {} },
        })
      )
    ).toBe('a, b');
    expect(
      auditDetail(
        ev({
          action: 'instance.settings',
          repo: null,
          target: 'app.name',
          data: { value: 'XY Space' },
        })
      )
    ).toBe('Now: XY Space');
  });

  it('说明令牌何时失效', () => {
    expect(
      auditDetail(
        ev({
          action: 'token.created',
          repo: null,
          target: 'laptop',
          data: { expiresAt: Date.UTC(2026, 10, 4) },
        })
      )
    ).toBe('Expires 2026-11-04');
    expect(
      auditDetail(
        ev({
          action: 'token.created',
          repo: null,
          target: 'laptop',
          data: { expiresAt: null },
        })
      )
    ).toBe('Never expires');
  });

  it('显示暂停合并的原因', () => {
    expect(
      auditDetail(
        ev({
          action: 'merging.paused',
          data: { reason: 'Freeze for the demo' },
        })
      )
    ).toBe('Reason: Freeze for the demo');
    expect(
      auditDetail(ev({ action: 'merging.paused', data: { reason: '' } }))
    ).toBeNull();
  });

  it('将空值显示为无', () => {
    expect(
      auditDetail(
        ev({
          action: 'settings.changed',
          data: { changes: { description: { from: '', to: 'A code host' } } },
        })
      )
    ).toBe('Description: none → A code host');
  });

  it('统计发行版本包含的拉取请求数量', () => {
    expect(
      auditDetail(ev({ action: 'release.created', data: { pulls: 3 } }))
    ).toBe('3 pull requests');
    expect(
      auditDetail(ev({ action: 'release.created', data: { pulls: 1 } }))
    ).toBe('1 pull request');
    expect(
      auditDetail(ev({ action: 'release.created', data: { pulls: 0 } }))
    ).toBeNull();
  });

  it('普通事件没有额外详情', () => {
    expect(auditDetail(ev({ action: 'merging.paused' }))).toBeNull();
  });

  it('缩短过长的理由', () => {
    const d = auditDetail(
      ev({
        action: 'finding.approved',
        target: 'T',
        data: { reason: 'x'.repeat(500) },
      })
    );
    expect(d!.length).toBeLessThan(260);
    expect(d!.endsWith('…')).toBe(true);
  });
});

describe('链接和分类', () => {
  it('优先链接拉取请求，其次仓库，否则无链接', () => {
    expect(auditLink(ev({ action: 'pull.merged', pull: 12 }))).toBe(
      '/octocat/cloudforge/pull/12'
    );
    expect(auditLink(ev({ action: 'merging.paused' }))).toBe(
      '/octocat/cloudforge'
    );
    expect(auditLink(ev({ action: 'token.created', repo: null }))).toBeNull();
  });

  it('将议题与标签事件链接到对应页面', () => {
    expect(auditLink(ev({ action: 'label.created', target: 'bug' }))).toBe(
      '/octocat/cloudforge/labels'
    );
    expect(auditLink(ev({ action: 'issue.deleted', target: '#3' }))).toBe(
      '/octocat/cloudforge/issues'
    );
    expect(
      auditLink(ev({ action: 'issue.comment_deleted', target: '#3' }))
    ).toBe('/octocat/cloudforge/issues/3');
    expect(
      auditDetail(ev({ action: 'issue.deleted', data: { title: 'Spam' } }))
    ).toBe('Spam');
    expect(
      auditDetail(
        ev({
          action: 'label.updated',
          data: { name: { from: 'bug', to: 'defect' } },
        })
      )
    ).toBe('Renamed to “defect”');
  });

  it('将发布事件链接到发行版本', () => {
    expect(auditLink(ev({ action: 'release.created', target: 'v1.2.0' }))).toBe(
      '/octocat/cloudforge/releases/v1.2.0'
    );
    expect(auditLink(ev({ action: 'release.updated', target: 'v1.2.0' }))).toBe(
      '/octocat/cloudforge/releases/v1.2.0'
    );
  });

  it('为每项操作分配类别', () => {
    for (const action of AUDIT_ACTIONS)
      if (action !== 'pull.version_bump')
        expect(auditCategory(action)).toMatch(
          /^(merging|decisions|access|settings)$/
        );
    expect(auditCategory('release.created')).toBe('merging');
    expect(auditCategory('instance.oidc_configuration')).toBe('access');
    expect(auditCategory('user.oidc_linked')).toBe('access');
    expect(auditCategory('user.oidc_revoked')).toBe('access');
    expect(auditCategory('user.oidc_signed_in')).toBe('access');
    expect(auditCategory('user.deleted')).toBe('access');
    expect(auditCategory('pull.version_bump')).toBe('activity');
    expect(auditCategory('pull.state_changed')).toBe('activity');
    expect(auditCategory('pull.rebased')).toBe('activity');
    expect(auditCategory('pull.dismissed')).toBe('decisions');
    expect(auditCategory('something.else')).toBe('activity');
  });
});
