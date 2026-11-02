// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { can } from '../repositories/permissions';
// External CI status reporting over MCP, with the same permissions and validation as the REST API.
import { commitStatusStates, type CommitStatus } from '../db/app.schema';
import {
  combinedState,
  createStatus,
  latestStatuses,
  statusInputSchema,
} from '../repositories/commit-statuses';
import { usersById } from '../members/users';
import { emitStatus } from '../webhooks/events';
import { publishChange } from '../live/publish';
import { settleStates } from '../pulls/settle';
import { autoMergeForCommit } from '../review/auto-merge';
import { McpToolError } from './errors';
import { repoFor, repositoryProp, str, text } from './pull-tools';
import type { ToolContext, ToolModule } from './tools';

async function statusViews(ctx: ToolContext, statuses: CommitStatus[]) {
  const people = await usersById(
    ctx.db,
    statuses.map((s) => s.creatorId ?? '')
  );
  return statuses.map((s) => ({
    id: s.id,
    sha: s.sha,
    state: s.state,
    context: s.context,
    description: s.description,
    target_url: s.targetUrl,
    creator: s.creatorId
      ? { login: people.get(s.creatorId)?.username ?? 'ghost' }
      : null,
    created_at: s.createdAt.toISOString(),
    updated_at: s.createdAt.toISOString(),
  }));
}

const createCommitStatus: ToolModule = {
  definition: {
    name: 'cloudforge_create_commit_status',
    title: 'Create commit status',
    description:
      'Report an external CI check on an existing commit. Requires push access. ' +
      'The latest status for each context counts: failure/error blocks merging and pending waits. ' +
      'Only report results from checks actually performed; success can trigger automatic merging.',
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      title: 'Create commit status',
    },
    inputSchema: {
      type: 'object',
      properties: {
        repository: repositoryProp,
        sha: {
          type: 'string',
          pattern: '^[0-9a-fA-F]{40}$',
          description: 'Full commit SHA in this repository.',
        },
        state: { type: 'string', enum: [...commitStatusStates] },
        context: {
          type: 'string',
          minLength: 1,
          maxLength: 100,
          description: 'Check name, e.g. ci/build; defaults to default.',
        },
        description: { type: ['string', 'null'], maxLength: 140 },
        target_url: {
          type: ['string', 'null'],
          maxLength: 500,
          description: 'Optional http/https link to the CI result.',
        },
      },
      required: ['repository', 'sha', 'state'],
    },
  },
  handler: async (args, ctx) => {
    const { repo, perms, git, fullName } = await repoFor(ctx, args);
    if (!can(perms, 'publishStatus'))
      throw new McpToolError(
        'You need push access to report statuses on this repository.'
      );
    const sha = str(args, 'sha', true).trim().toLowerCase();
    if (!/^[0-9a-f]{40}$/.test(sha))
      throw new McpToolError('sha must be a full 40-character commit SHA.');
    const parsed = statusInputSchema.safeParse(args);
    if (!parsed.success)
      throw new McpToolError(
        parsed.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ')
      );
    if (!(await git.commit(sha)))
      throw new McpToolError(`There is no commit ${sha} in this repository.`);
    const body = parsed.data;
    const created = await createStatus(
      ctx.db,
      repo.id,
      sha,
      {
        state: body.state,
        context: body.context,
        description: body.description,
        targetUrl: body.target_url,
      },
      ctx.user.id
    );
    if (!created.ok) throw new McpToolError(created.error);
    ctx.after(publishChange(ctx.env, repo.id, { approvals: true }));
    ctx.after(settleStates(ctx.env, ctx.db, repo.id));
    if (body.state === 'success')
      ctx.after(
        autoMergeForCommit(ctx.env, ctx.db, repo.id, sha).catch((e) =>
          console.error('[statuses] auto-merge failed', repo.id, e)
        )
      );
    await emitStatus(
      { env: ctx.env, db: ctx.db, after: ctx.after },
      repo,
      created.status,
      ctx.user.id
    );
    return {
      content: [
        text(
          JSON.stringify(
            {
              repository: fullName,
              ...(await statusViews(ctx, [created.status]))[0],
            },
            null,
            2
          )
        ),
      ],
    };
  },
};

const getCommitStatus: ToolModule = {
  definition: {
    name: 'cloudforge_get_commit_status',
    title: 'Get commit status',
    description:
      'Read the latest external CI status per context and their combined state for a commit, branch or tag. ' +
      'Requires repository read access. Without ref, reads the default branch. ' +
      'The combined state is null when no external checks have reported; Actions runs are separate.',
    annotations: { readOnlyHint: true, title: 'Get commit status' },
    inputSchema: {
      type: 'object',
      properties: {
        repository: repositoryProp,
        ref: {
          type: 'string',
          minLength: 1,
          maxLength: 255,
          description:
            'Full SHA, branch or tag; defaults to the default branch.',
        },
      },
      required: ['repository'],
    },
  },
  handler: async (args, ctx) => {
    const { repo, git, fullName } = await repoFor(ctx, args);
    const requestedRef = str(args, 'ref')?.trim();
    const ref = requestedRef ?? repo.defaultBranch;
    if (!ref || ref.length > 255)
      throw new McpToolError('ref must be from 1 to 255 characters.');
    const sha =
      requestedRef === undefined
        ? await git.resolveBranch(repo.defaultBranch)
        : /^[0-9a-fA-F]{40}$/.test(ref)
          ? ref.toLowerCase()
          : await git.resolve(ref);
    if (!sha || !(await git.commit(sha)))
      throw new McpToolError(
        `There is no commit or ref ${ref} in this repository.`
      );
    const statuses = (await latestStatuses(ctx.db, repo.id, [sha])).get(sha)!;
    return {
      content: [
        text(
          JSON.stringify(
            {
              repository: fullName,
              sha,
              state: combinedState(statuses),
              total_count: statuses.length,
              statuses: await statusViews(ctx, statuses),
            },
            null,
            2
          )
        ),
      ],
    };
  },
};

export const COMMIT_STATUS_TOOLS: ToolModule[] = [
  createCommitStatus,
  getCommitStatus,
];
