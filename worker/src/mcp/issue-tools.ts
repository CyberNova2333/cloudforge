// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { can } from '../lib/repo-permissions';
// Issues over MCP (docs/issues.md), with the web's permissions: readers list, read, open and comment; the author or
// someone with push access edits, closes and reopens; push access sets labels and assignees.
import { asc, eq } from 'drizzle-orm';
import { issueComments, issueStateReasons, type Issue } from '../db/app.schema';
import {
  addIssueComment,
  assigneesNamed,
  assigneesOf,
  closeIssue,
  editIssue,
  getIssue,
  ISSUE_BODY_MAX,
  ISSUE_TITLE_MAX,
  labelsNamed,
  labelsOf,
  listIssues,
  MAX_ISSUE_ASSIGNEES,
  MAX_ISSUE_LABELS,
  openIssue,
  reopenIssue,
  setIssueAssignees,
  setIssueLabels,
} from '../lib/issues';
import { pullsNaming } from '../lib/issue-links';
import type { NotifyCtx } from '../lib/notifications';
import { userByUsername, usersById } from '../lib/users';
import { publishChange } from '../live/publish';
import { McpToolError } from './errors';
import { prNumber, repoFor, repositoryProp, str, text } from './pull-tools';
import type { ToolContext, ToolModule } from './tools';

const json = (v: unknown) => text(JSON.stringify(v, null, 2));

const issueNumberProp = {
  type: 'integer',
  minimum: 1,
  description: 'The issue number, e.g. 12.',
};

const notifyCtx = (ctx: ToolContext): NotifyCtx => ({
  env: ctx.env,
  db: ctx.db,
  after: ctx.after,
});

const issueUrl = (ctx: ToolContext, fullName: string, n: number) =>
  `${ctx.baseURL}/${fullName}/issues/${n}`;

/** The repository, refused when it has issues turned off. */
async function issuesRepo(ctx: ToolContext, args: Record<string, unknown>) {
  const found = await repoFor(ctx, args);
  if (!found.repo.hasIssues)
    throw new McpToolError(`${found.fullName} has issues turned off.`);
  return found;
}

async function issueFor(
  ctx: ToolContext,
  repositoryId: string,
  fullName: string,
  n: number
): Promise<Issue> {
  const issue = await getIssue(ctx.db, repositoryId, n);
  if (!issue)
    throw new McpToolError(
      `${fullName} has no issue #${n}. Call cloudforge_list_issues to see them (#${n} may be a pull request).`
    );
  return issue;
}

function names(args: Record<string, unknown>, key: string, max: number) {
  const v = args[key];
  if (v === undefined || v === null) return undefined;
  if (
    !Array.isArray(v) ||
    v.length > max ||
    !v.every((s) => typeof s === 'string')
  )
    throw new McpToolError(
      `${key} must be an array of at most ${max} strings.`
    );
  return v as string[];
}

function limited(args: Record<string, unknown>, key: string, max: number) {
  const v = str(args, key);
  if (v !== undefined && Array.from(v).length > max)
    throw new McpToolError(`${key} must be at most ${max} characters.`);
  return v;
}

/** `list` as the tools show them: labels and assignees by name, one query each. */
async function summaries(
  ctx: ToolContext,
  fullName: string,
  list: { issue: Issue; comments: number }[]
) {
  const ids = list.map((r) => r.issue.id);
  const [labels, assignees] = await Promise.all([
    labelsOf(ctx.db, ids),
    assigneesOf(ctx.db, ids),
  ]);
  const people = await usersById(ctx.db, [
    ...list.map((r) => r.issue.authorId),
    ...[...assignees.values()].flat(),
  ]);
  const login = (id: string) => people.get(id)?.username ?? 'ghost';
  return list.map(({ issue, comments }) => ({
    number: issue.number,
    title: issue.title,
    state: issue.state,
    state_reason: issue.stateReason,
    author: login(issue.authorId),
    labels: (labels.get(issue.id) ?? []).map((l) => l.name),
    assignees: (assignees.get(issue.id) ?? []).map(login),
    comments: Number(comments),
    created_at: issue.createdAt.toISOString(),
    updated_at: issue.updatedAt.toISOString(),
    url: issueUrl(ctx, fullName, issue.number),
  }));
}

const listIssuesTool: ToolModule = {
  definition: {
    name: 'cloudforge_list_issues',
    title: 'List issues',
    description:
      "List a repository's issues, newest first, with their labels, assignees and comment counts. " +
      'Filter by state (default open), label, assignee (a username, or "none") and words of the title or author (q; "#12" finds issue 12). ' +
      'Issues and pull requests share numbers: a number missing here may be a pull request.',
    annotations: { readOnlyHint: true, title: 'List issues' },
    inputSchema: {
      type: 'object',
      properties: {
        repository: repositoryProp,
        state: {
          type: 'string',
          enum: ['open', 'closed', 'all'],
          description: 'Default open.',
        },
        label: { type: 'string', description: 'A label name.' },
        assignee: {
          type: 'string',
          description: 'A username, or "none" for unassigned issues.',
        },
        q: { type: 'string', description: 'Search words.' },
        page: { type: 'integer', minimum: 1, description: 'Default 1.' },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 50,
          description: 'Default 20.',
        },
      },
      required: ['repository'],
    },
  },
  handler: async (args, ctx) => {
    const { repo, fullName } = await issuesRepo(ctx, args);
    const state = str(args, 'state') ?? 'open';
    if (state !== 'open' && state !== 'closed' && state !== 'all')
      throw new McpToolError('state must be open, closed or all.');
    const int = (key: string, fallback: number, max: number) => {
      const v = args[key];
      if (v === undefined || v === null) return fallback;
      if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > max)
        throw new McpToolError(`${key} must be an integer from 1 to ${max}.`);
      return v;
    };
    const limit = int('limit', 20, 50);
    const page = int('page', 1, 10_000);
    const assignee = limited(args, 'assignee', 100);
    const result = await listIssues(ctx.db, repo.id, {
      state,
      q: limited(args, 'q', 100),
      label: limited(args, 'label', 50),
      assignee:
        assignee?.toLowerCase() === 'none'
          ? 'none'
          : assignee
            ? ((await userByUsername(ctx.db, assignee))?.id ?? 'nobody')
            : undefined,
      limit,
      offset: (page - 1) * limit,
    });
    return {
      content: [
        json({
          issues: await summaries(ctx, fullName, result.rows),
          open: result.openCount,
          closed: result.closedCount,
          matching: result.total,
          page,
        }),
      ],
    };
  },
};

const getIssueTool: ToolModule = {
  definition: {
    name: 'cloudforge_get_issue',
    title: 'Get issue',
    description:
      'Read one issue: its description, labels, assignees, comments (oldest first), when it was closed and why, ' +
      'and the pull requests that name it (closes: true when one closes it on landing).',
    annotations: { readOnlyHint: true, title: 'Get issue' },
    inputSchema: {
      type: 'object',
      properties: { repository: repositoryProp, number: issueNumberProp },
      required: ['repository', 'number'],
    },
  },
  handler: async (args, ctx) => {
    const { repo, fullName } = await issuesRepo(ctx, args);
    const issue = await issueFor(ctx, repo.id, fullName, prNumber(args));
    const [comments, pulls] = await Promise.all([
      ctx.db
        .select()
        .from(issueComments)
        .where(eq(issueComments.issueId, issue.id))
        .orderBy(asc(issueComments.createdAt), asc(issueComments.id))
        .all(),
      pullsNaming(ctx.db, issue.id),
    ]);
    const people = await usersById(ctx.db, [
      ...comments.map((c) => c.authorId),
      issue.closedById ?? '',
    ]);
    const [summary] = await summaries(ctx, fullName, [
      { issue, comments: comments.length },
    ]);
    return {
      content: [
        json({
          ...summary,
          body: issue.body,
          closed_at: issue.closedAt?.toISOString() ?? null,
          closed_by: issue.closedById
            ? (people.get(issue.closedById)?.username ?? 'ghost')
            : null,
          comments: comments.map((c) => ({
            author: people.get(c.authorId)?.username ?? 'ghost',
            body: c.body,
            created_at: c.createdAt.toISOString(),
          })),
          pull_requests: pulls,
        }),
      ],
    };
  },
};

const createIssueTool: ToolModule = {
  definition: {
    name: 'cloudforge_create_issue',
    title: 'Create issue',
    description:
      'Open an issue, as the signed-in user. Labels (existing label names) and assignees (usernames of people with push access) need push access. ' +
      'To close it from a pull request, write "Fixes #<number>" in the pull request\'s description.',
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      title: 'Create issue',
    },
    inputSchema: {
      type: 'object',
      properties: {
        repository: repositoryProp,
        title: { type: 'string', description: 'One line.' },
        body: { type: 'string', description: 'Markdown.' },
        labels: { type: 'array', items: { type: 'string' } },
        assignees: { type: 'array', items: { type: 'string' } },
      },
      required: ['repository', 'title'],
    },
  },
  handler: async (args, ctx) => {
    const { repo, perms, fullName } = await issuesRepo(ctx, args);
    const title = str(args, 'title', true).trim();
    if (Array.from(title).length > ISSUE_TITLE_MAX)
      throw new McpToolError(
        `title must be at most ${ISSUE_TITLE_MAX} characters.`
      );
    const body = limited(args, 'body', ISSUE_BODY_MAX) ?? '';
    const labelNames = names(args, 'labels', MAX_ISSUE_LABELS) ?? [];
    const usernames = names(args, 'assignees', MAX_ISSUE_ASSIGNEES) ?? [];
    if ((labelNames.length || usernames.length) && !can(perms, 'manageIssues'))
      throw new McpToolError(
        `You don't have push access to ${fullName}, so you can't set labels or assignees. Open the issue without them.`
      );
    const labels = await labelsNamed(ctx.db, repo.id, labelNames);
    if (!labels.ok) throw new McpToolError(labels.error);
    const assignees = await assigneesNamed(ctx.db, repo, usernames);
    if (!assignees.ok) throw new McpToolError(assignees.error);
    const issue = await openIssue({
      db: ctx.db,
      repo,
      authorId: ctx.user.id,
      title,
      body,
      labels: labels.labels,
      assigneeIds: assignees.users.map((u) => u.id),
      notify: notifyCtx(ctx),
    });
    ctx.after(publishChange(ctx.env, repo.id));
    return {
      content: [
        json({
          number: issue.number,
          url: issueUrl(ctx, fullName, issue.number),
        }),
      ],
    };
  },
};

const updateIssueTool: ToolModule = {
  definition: {
    name: 'cloudforge_update_issue',
    title: 'Update issue',
    description:
      'Change an issue: its title or description, close it (state "closed", with state_reason "completed" or "not_planned") or reopen it, ' +
      'or replace its labels or assignees (the full list from now on; [] clears). Its author or people with push access can edit and close; labels and assignees need push access.',
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      title: 'Update issue',
    },
    inputSchema: {
      type: 'object',
      properties: {
        repository: repositoryProp,
        number: issueNumberProp,
        title: { type: 'string' },
        body: { type: 'string', description: 'Markdown; replaces it.' },
        state: { type: 'string', enum: ['open', 'closed'] },
        state_reason: { type: 'string', enum: [...issueStateReasons] },
        labels: { type: 'array', items: { type: 'string' } },
        assignees: { type: 'array', items: { type: 'string' } },
      },
      required: ['repository', 'number'],
    },
  },
  handler: async (args, ctx) => {
    const { repo, perms, fullName } = await issuesRepo(ctx, args);
    const issue = await issueFor(ctx, repo.id, fullName, prNumber(args));
    if (!can(perms, 'manageIssues') && issue.authorId !== ctx.user.id)
      throw new McpToolError(
        `Only its author or people with push access to ${fullName} can change issue #${issue.number}.`
      );
    const title = str(args, 'title')?.trim();
    if (
      title !== undefined &&
      (!title || Array.from(title).length > ISSUE_TITLE_MAX)
    )
      throw new McpToolError(
        `title must be 1 to ${ISSUE_TITLE_MAX} characters.`
      );
    const body = limited(args, 'body', ISSUE_BODY_MAX);
    const state = str(args, 'state');
    if (state !== undefined && state !== 'open' && state !== 'closed')
      throw new McpToolError('state must be open or closed.');
    const reason = str(args, 'state_reason') ?? 'completed';
    if (!(issueStateReasons as readonly string[]).includes(reason))
      throw new McpToolError('state_reason must be completed or not_planned.');
    const labelNames = names(args, 'labels', MAX_ISSUE_LABELS);
    const usernames = names(args, 'assignees', MAX_ISSUE_ASSIGNEES);
    if ((labelNames || usernames) && !can(perms, 'manageIssues'))
      throw new McpToolError(
        `You don't have push access to ${fullName}, so you can't set labels or assignees.`
      );
    const labels = labelNames
      ? await labelsNamed(ctx.db, repo.id, labelNames)
      : null;
    if (labels && !labels.ok) throw new McpToolError(labels.error);
    const assignees = usernames
      ? await assigneesNamed(ctx.db, repo, usernames)
      : null;
    if (assignees && !assignees.ok) throw new McpToolError(assignees.error);
    await editIssue(ctx.db, issue, { title, body }, ctx.user.id);
    if (labels?.ok)
      await setIssueLabels(ctx.db, issue, labels.labels, ctx.user.id);
    if (assignees?.ok)
      await setIssueAssignees(
        ctx.db,
        issue,
        assignees.users,
        ctx.user.id,
        notifyCtx(ctx)
      );
    if (state === 'closed')
      await closeIssue(ctx.db, issue, {
        actorId: ctx.user.id,
        reason: reason as (typeof issueStateReasons)[number],
        notify: notifyCtx(ctx),
      });
    if (state === 'open')
      await reopenIssue(ctx.db, issue, ctx.user.id, notifyCtx(ctx));
    ctx.after(publishChange(ctx.env, repo.id));
    const fresh = (await getIssue(ctx.db, repo.id, issue.number))!;
    return {
      content: [
        json({
          number: fresh.number,
          title: fresh.title,
          state: fresh.state,
          state_reason: fresh.stateReason,
          url: issueUrl(ctx, fullName, fresh.number),
        }),
      ],
    };
  },
};

const commentIssueTool: ToolModule = {
  definition: {
    name: 'cloudforge_comment_issue',
    title: 'Comment on issue',
    description: 'Add a Markdown comment to an issue, as the signed-in user.',
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      title: 'Comment on issue',
    },
    inputSchema: {
      type: 'object',
      properties: {
        repository: repositoryProp,
        number: issueNumberProp,
        body: { type: 'string', description: 'The comment, in Markdown.' },
      },
      required: ['repository', 'number', 'body'],
    },
  },
  handler: async (args, ctx) => {
    const { repo, fullName } = await issuesRepo(ctx, args);
    const issue = await issueFor(ctx, repo.id, fullName, prNumber(args));
    const body = str(args, 'body', true);
    if (Array.from(body).length > ISSUE_BODY_MAX)
      throw new McpToolError(
        `body must be at most ${ISSUE_BODY_MAX} characters.`
      );
    await addIssueComment(ctx.db, issue, ctx.user.id, body, notifyCtx(ctx));
    ctx.after(publishChange(ctx.env, repo.id));
    return {
      content: [text(`Commented on ${issueUrl(ctx, fullName, issue.number)}`)],
    };
  },
};

export const ISSUE_TOOLS: ToolModule[] = [
  listIssuesTool,
  getIssueTool,
  createIssueTool,
  updateIssueTool,
  commentIssueTool,
];
