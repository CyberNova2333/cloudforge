import { describe, expect, it } from 'vitest';
import { addMember, call } from './helpers/app';
import { connect, crewRepo, tool } from './helpers/crew';

const parse = (r: { content: { text: string }[] }) =>
  JSON.parse(r.content[0].text);
const repository = 'octocat/app';

describe('议题的 MCP 工具', () => {
  it('新建、列出、读取、评论并关闭议题', async () => {
    const s = await crewRepo();
    const { access_token } = await connect(s.t, s.admin);
    await call(s.t, '/api/repos/octocat/app/labels', {
      cookie: s.admin,
      json: { name: 'bug', color: 'd73a4a' },
    });
    const created = await tool(s.t, access_token, 'cloudforge_create_issue', {
      repository,
      title: 'Crash on start',
      body: 'Steps…',
      labels: ['bug'],
      assignees: ['octocat'],
    });
    expect(created.isError).toBeUndefined();
    const { number, url } = parse(created);
    expect(url).toMatch(new RegExp(`/octocat/app/issues/${number}$`));

    expect(
      (
        await tool(s.t, access_token, 'cloudforge_comment_issue', {
          repository,
          number,
          body: 'Looking into it',
        })
      ).isError
    ).toBeUndefined();
    const listed = parse(
      await tool(s.t, access_token, 'cloudforge_list_issues', {
        repository,
        label: 'bug',
      })
    );
    expect(listed.issues).toMatchObject([
      {
        number,
        labels: ['bug'],
        assignees: ['octocat'],
        comments: 1,
        author: 'octocat',
      },
    ]);
    expect(listed.open).toBe(1);

    const closed = await tool(s.t, access_token, 'cloudforge_update_issue', {
      repository,
      number,
      state: 'closed',
      state_reason: 'not_planned',
      labels: [],
    });
    expect(parse(closed)).toMatchObject({
      state: 'closed',
      state_reason: 'not_planned',
    });
    const read = parse(
      await tool(s.t, access_token, 'cloudforge_get_issue', {
        repository,
        number,
      })
    );
    expect(read).toMatchObject({
      body: 'Steps…',
      labels: [],
      closed_by: 'octocat',
      comments: [{ author: 'octocat', body: 'Looking into it' }],
      pull_requests: [],
    });
  });

  it('沿用网页的权限：没有推送权限不能设标签，也不能改别人的议题', async () => {
    const s = await crewRepo();
    const bob = await addMember(s.t, s.admin, 'bob');
    const { access_token } = await connect(s.t, bob);
    const refused = await tool(s.t, access_token, 'cloudforge_create_issue', {
      repository,
      title: 'Mine',
      labels: ['bug'],
    });
    expect(refused.isError).toBe(true);
    expect(refused.content[0].text).toContain("don't have push access");
    const own = parse(
      await tool(s.t, access_token, 'cloudforge_create_issue', {
        repository,
        title: 'Mine',
      })
    );
    // His own issue he may close.
    expect(
      (
        await tool(s.t, access_token, 'cloudforge_update_issue', {
          repository,
          number: own.number,
          state: 'closed',
        })
      ).isError
    ).toBeUndefined();
    const admins = await call(s.t, '/api/repos/octocat/app/issues', {
      cookie: s.admin,
      json: { title: 'Not his' },
    });
    const theirs = ((await admins.json()) as { number: number }).number;
    const edit = await tool(s.t, access_token, 'cloudforge_update_issue', {
      repository,
      number: theirs,
      title: 'Hijacked',
    });
    expect(edit.isError).toBe(true);
    expect(edit.content[0].text).toContain('Only its author');
    // A pull request's number is not an issue.
    const missing = await tool(s.t, access_token, 'cloudforge_get_issue', {
      repository,
      number: 999,
    });
    expect(missing.isError).toBe(true);
    expect(missing.content[0].text).toContain('may be a pull request');
  });

  it('列出并标记自己的通知', async () => {
    const s = await crewRepo();
    const bob = await addMember(s.t, s.admin, 'bob');
    const { access_token } = await connect(s.t, s.admin);
    const created = parse(
      await tool(s.t, access_token, 'cloudforge_create_issue', {
        repository,
        title: 'Ping me',
      })
    );
    await call(
      s.t,
      `/api/repos/octocat/app/issues/${created.number}/comments`,
      {
        cookie: bob,
        json: { body: 'Done, @octocat' },
      }
    );
    const listed = parse(
      await tool(s.t, access_token, 'cloudforge_list_notifications', {})
    );
    expect(listed.unread).toBe(1);
    expect(listed.notifications).toMatchObject([
      {
        repository,
        kind: 'issue',
        number: created.number,
        event: 'commented',
        actor: 'bob',
        reason: 'mention',
        excerpt: 'Done, @octocat',
      },
    ]);
    const marked = await tool(
      s.t,
      access_token,
      'cloudforge_mark_notifications_read',
      { ids: [listed.notifications[0].id] }
    );
    expect(marked.content[0].text).toBe('Marked 1 notification(s) read.');
    expect(
      parse(await tool(s.t, access_token, 'cloudforge_list_notifications', {}))
        .notifications
    ).toEqual([]);
    const refused = await tool(
      s.t,
      access_token,
      'cloudforge_mark_notifications_read',
      {}
    );
    expect(refused.isError).toBe(true);
  });

  it('仓库关闭议题后工具拒绝', async () => {
    const s = await crewRepo();
    const { access_token } = await connect(s.t, s.admin);
    await call(s.t, '/api/repos/octocat/app', {
      cookie: s.admin,
      method: 'PATCH',
      json: { hasIssues: false },
    });
    const off = await tool(s.t, access_token, 'cloudforge_list_issues', {
      repository,
    });
    expect(off.isError).toBe(true);
    expect(off.content[0].text).toContain('issues turned off');
  });
});
