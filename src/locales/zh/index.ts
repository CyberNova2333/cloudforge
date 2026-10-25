/**
 * Chinese (Simplified) UI text, keyed by the English in the source (see `src/lib/i18n.ts`). One file per area of
 * the app, so they can be edited apart; a key may appear in several files only with the same translation (the
 * i18n test checks). `{name}` placeholders must survive translation unchanged.
 *
 * Terms, used the same way everywhere:
 *   repository 仓库 · pull request 拉取请求 · issue 议题 · label 标记 · assignee 指派人 · commit 提交 ·
 *   branch 分支 · tag 标签 · release 发行版 ·
 *   merge 合并 · rebase 变基 · conflict 冲突 · auto-merge 自动合并 · merge queue 合并队列 · stack 堆叠 ·
 *   review 评审 · reviewer agent 评审 Agent · agent Agent · crew 评审组 · finding 评审意见 · approve 批准 ·
 *   Approvals 待审批 · Actions Actions · workflow 工作流 · run 运行 · job 作业 · step 步骤 · runner 运行器 ·
 *   member 成员 · collaborator 协作者 · team 团队 · site admin 站点管理员 · instance 实例 ·
 *   personal access token 个人访问令牌 · token 令牌 · sign in 登录 · sign out 退出登录 · settings 设置 ·
 *   private 私有 · internal 内部 · public 公开 · insights 洞察 · health 健康度 · invite 邀请 ·
 *   Clef, Fixer, CloudForge, Git LFS, MCP, Markdown: kept as is.
 */
import { actions } from './actions';
import { admin } from './admin';
import { agents } from './agents';
import { approvals } from './approvals';
import { common } from './common';
import { errors } from './errors';
import { issues } from './issues';
import { lib } from './lib';
import { pulls } from './pulls';
import { repo } from './repo';
import { review } from './review';
import { shell } from './shell';

/** Every area, for the i18n test (which checks they agree on shared keys). */
export const zhAreas: Record<string, Record<string, string>> = {
  common,
  shell,
  repo,
  pulls,
  issues,
  review,
  actions,
  agents,
  approvals,
  admin,
  lib,
  errors,
};

export const zh: Record<string, string> = Object.assign(
  {},
  ...Object.values(zhAreas)
);

export { zhPatterns } from './errors';
