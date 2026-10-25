// The signed-in person's notifications over MCP (docs/notifications.md): read the inbox, mark it read.
import { notificationReasons } from '../db/app.schema';
import { listInbox, markRead } from '../lib/inbox';
import { publishToUsers } from '../live/publish';
import { McpToolError } from './errors';
import { str, text } from './pull-tools';
import type { ToolModule } from './tools';

const json = (v: unknown) => text(JSON.stringify(v, null, 2));

const listNotifications: ToolModule = {
  definition: {
    name: 'cloudforge_list_notifications',
    title: 'List notifications',
    description:
      'List the signed-in user\'s notifications, newest first: unread ones by default (filter "all" for read ones too). ' +
      'Each says which issue or pull request, what happened (opened, commented, closed, reopened, merged, assigned), who did it, ' +
      'why the user hears about it (mention, assign, author, participating, watching) and an excerpt. ' +
      'Read the thread with cloudforge_get_issue or cloudforge_get_pull_request, then mark it read with cloudforge_mark_notifications_read.',
    annotations: { readOnlyHint: true, title: 'List notifications' },
    inputSchema: {
      type: 'object',
      properties: {
        filter: { type: 'string', enum: ['unread', 'all'] },
        reason: { type: 'string', enum: [...notificationReasons] },
        repository: {
          type: 'string',
          description: 'Only this repository, e.g. "ada/analytical-engine".',
        },
        limit: { type: 'integer', minimum: 1, maximum: 50 },
      },
    },
  },
  handler: async (args, ctx) => {
    const filter = str(args, 'filter') ?? 'unread';
    if (filter !== 'unread' && filter !== 'all')
      throw new McpToolError('filter must be unread or all.');
    const reason = str(args, 'reason');
    if (
      reason !== undefined &&
      !(notificationReasons as readonly string[]).includes(reason)
    )
      throw new McpToolError(
        `reason must be one of: ${notificationReasons.join(', ')}.`
      );
    const limit = args.limit ?? 20;
    if (
      typeof limit !== 'number' ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 50
    )
      throw new McpToolError('limit must be an integer from 1 to 50.');
    const inbox = await listInbox(ctx.db, ctx.user, {
      filter,
      reason: reason as (typeof notificationReasons)[number] | undefined,
      repo: str(args, 'repository')
        ?.trim()
        .replace(/\.git$/, ''),
      limit,
      offset: 0,
    });
    return {
      content: [
        json({
          unread: inbox.unread,
          notifications: inbox.items.map((n) => ({
            id: n.id,
            unread: n.unread,
            repository: n.repository,
            kind: n.subject.kind === 'issue' ? 'issue' : 'pull_request',
            number: n.subject.number,
            title: n.subject.title,
            state: n.subject.state,
            event: n.event,
            actor: n.actor?.username ?? null,
            reason: n.reason,
            excerpt: n.excerpt,
            updated_at: n.updatedAt,
            url: `${ctx.baseURL}${n.url}`,
          })),
        }),
      ],
    };
  },
};

const markNotificationsRead: ToolModule = {
  definition: {
    name: 'cloudforge_mark_notifications_read',
    title: 'Mark notifications read',
    description:
      "Mark the signed-in user's notifications read: the ids from cloudforge_list_notifications, or all of them (in one repository when given). " +
      'Only do this for notifications the user has seen or asked you to handle.',
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      title: 'Mark notifications read',
    },
    inputSchema: {
      type: 'object',
      properties: {
        ids: { type: 'array', items: { type: 'string' }, maxItems: 100 },
        all: { type: 'boolean' },
        repository: { type: 'string' },
      },
    },
  },
  handler: async (args, ctx) => {
    const ids = args.ids;
    if (
      ids !== undefined &&
      (!Array.isArray(ids) ||
        ids.length > 100 ||
        !ids.every((i) => typeof i === 'string'))
    )
      throw new McpToolError('ids must be an array of at most 100 strings.');
    const all = args.all === true;
    if (!all && !(ids as string[] | undefined)?.length)
      throw new McpToolError('Give ids, or all: true.');
    const updated = await markRead(ctx.db, ctx.user.id, {
      ids: ids as string[] | undefined,
      all,
      repo: str(args, 'repository')
        ?.trim()
        .replace(/\.git$/, ''),
    });
    if (updated) ctx.after(publishToUsers(ctx.env, [ctx.user.id]));
    return {
      content: [text(`Marked ${updated} notification(s) read.`)],
    };
  },
};

export const NOTIFICATION_TOOLS: ToolModule[] = [
  listNotifications,
  markNotificationsRead,
];
