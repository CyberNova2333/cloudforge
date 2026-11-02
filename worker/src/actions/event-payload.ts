// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import type { WorkflowRun } from '../db/app.schema';
import { ZERO_SHA } from '../git/remote';
import type { GitService } from '../git/service';
import type { Value } from './expressions';

export const MAX_EVENT_BYTES = 96 * 1024;
const MAX_COMMITS = 20;
const encoder = new TextEncoder();

export interface EventUser {
  id: string;
  username: string;
  name: string;
  image: string | null;
}

export interface EventSource {
  event: 'push' | 'pull_request';
  ref: string;
  headSha: string;
  data: WorkflowRun['eventData'];
  serverUrl: string;
  repo: {
    id: string;
    name: string;
    description: string | null;
    visibility: 'private' | 'internal' | 'public';
    defaultBranch: string;
    createdAt: Date;
    updatedAt: Date;
  };
  owner: {
    kind: 'user' | 'team';
    id: string;
    username: string;
    image: string | null;
  };
  sender: EventUser | null;
}

/** Limit UTF-8 bytes before persisting supplemental event text. */
export function boundedEventText(value: string, bytes: number): string {
  const prefix = value.slice(0, bytes);
  const encoded = encoder.encode(prefix);
  return encoded.length <= bytes
    ? prefix
    : new TextDecoder()
        .decode(encoded.subarray(0, bytes))
        .replace(/\uFFFD$/, '');
}

const sha = (value: string | undefined) =>
  value && /^[0-9a-f]{40}$/.test(value) ? value : null;
const iso = (value: Date | number) =>
  new Date(value).toISOString().replace(/\.\d{3}Z$/, 'Z');

/**
 * GitHub-shaped supplemental event data. Mutable PR facts come only from the trigger's snapshot;
 * legacy rows expose unknown facts as null instead of reading a later PR or branch state.
 */
export async function eventPayload(
  git: GitService,
  src: EventSource
): Promise<Record<string, Value>> {
  const full = `${src.owner.username}/${src.repo.name}`;
  const web = `${src.serverUrl}/${full}`;
  const user = (u: EventUser | null): Value =>
    u && {
      id: u.id,
      login: u.username,
      type: 'User',
      name: boundedEventText(u.name, 512),
      avatar_url: boundedEventText(u.image ?? '', 2048),
      html_url: `${src.serverUrl}/${u.username}`,
    };
  const owner = {
    id: src.owner.id,
    login: src.owner.username,
    type: src.owner.kind === 'team' ? 'Organization' : 'User',
    avatar_url: boundedEventText(src.owner.image ?? '', 2048),
    html_url: `${src.serverUrl}/${src.owner.username}`,
  };
  const repository = {
    id: src.repo.id,
    name: src.repo.name,
    full_name: full,
    private: src.repo.visibility !== 'public',
    visibility: src.repo.visibility,
    owner,
    html_url: web,
    description:
      src.repo.description && boundedEventText(src.repo.description, 4096),
    fork: false,
    url: `${src.serverUrl}/api/repos/${full}`,
    clone_url: `${web}.git`,
    default_branch: src.repo.defaultBranch,
    created_at: iso(src.repo.createdAt),
    updated_at: iso(src.repo.updatedAt),
  };
  const sender = user(src.sender);
  if (src.event === 'pull_request') {
    const d = src.data;
    const number = d?.number ?? null;
    const pull = d?.pull;
    const side = (ref: string | null, hash: string | null) => ({
      label: ref ? `${src.owner.username}:${ref}` : null,
      ref,
      sha: hash,
      user: owner,
      repo: repository,
    });
    return fit({
      action: d?.action ?? null,
      number,
      pull_request: {
        id: pull?.id ?? null,
        number,
        html_url: number === null ? null : `${web}/pull/${number}`,
        state: pull?.state ?? null,
        title: boundedEventText(d?.title ?? '', 2048),
        body: pull?.body ?? null,
        user: user(pull?.author ?? null),
        created_at: pull ? iso(pull.createdAt) : null,
        head: side(d?.headRef ?? null, src.headSha),
        base: side(d?.baseRef ?? null, sha(d?.baseSha)),
      },
      repository,
      sender,
    });
  }

  const before = sha(src.data?.before);
  const created = before === null ? null : before === ZERO_SHA;
  const head = await git.commit(src.headSha);
  let list: NonNullable<typeof head>[] = [];
  let forced: boolean | null = null;
  if (before !== null) {
    if (created) {
      forced = false;
      if (head) list = (await git.log(src.headSha, MAX_COMMITS)).reverse();
    } else if (head) {
      const ancestor = await git.isAncestor(before, src.headSha, true);
      forced = ancestor === null ? null : !ancestor;
      list = (await git.commitsBetween(before, src.headSha)).slice(
        -MAX_COMMITS
      );
    }
  }
  const commit = async (
    c: NonNullable<typeof head>
  ): Promise<Record<string, Value>> => {
    const parent = c.parents[0] ? await git.commit(c.parents[0]) : null;
    // A missing parent object is not a root commit. Do not describe every file as newly added.
    const changes =
      c.parents.length && !parent
        ? null
        : await git.diffTrees(parent?.treeHash ?? null, c.treeHash);
    const paths = (status: string) =>
      changes!
        .filter((change) => change.status === status)
        .map((change) => change.path);
    return {
      id: c.hash,
      tree_id: c.treeHash,
      distinct: true,
      message: boundedEventText(c.message, 4096),
      timestamp: iso(c.committedAt * 1000),
      url: `${web}/commit/${c.hash}`,
      // Commit identities already belong to Git data; never copy an account's private email.
      author: {
        name: boundedEventText(c.author.name, 512),
        email: boundedEventText(c.author.email, 512),
      },
      committer: {
        name: boundedEventText(c.committer.name, 512),
        email: boundedEventText(c.committer.email, 512),
      },
      ...(changes && {
        added: paths('added'),
        removed: paths('removed'),
        modified: paths('modified'),
      }),
    };
  };
  const commits: Record<string, Value>[] = [];
  for (const c of list) commits.push(await commit(c));
  return fit({
    ref: src.ref,
    before,
    after: src.headSha,
    created,
    deleted: false,
    forced,
    compare:
      before === null
        ? null
        : created
          ? `${web}/commits/${src.headSha.slice(0, 12)}`
          : `${web}/compare/${before.slice(0, 12)}...${src.headSha.slice(0, 12)}`,
    commits,
    head_commit:
      commits.find((c) => c.id === src.headSha) ??
      (head ? await commit(head) : null),
    repository,
    pusher: src.sender ? { name: src.sender.username } : null,
    sender,
  });
}

/** File lists and older commits are optional enrichment; the serialized payload has a hard byte cap. */
function fit(payload: Record<string, Value>): Record<string, Value> {
  const size = () => encoder.encode(JSON.stringify(payload)).length;
  if (size() <= MAX_EVENT_BYTES) return payload;
  const commits = (payload.commits ?? []) as Record<string, Value>[];
  for (const c of [
    ...commits,
    payload.head_commit as Record<string, Value> | null,
  ])
    if (c) for (const key of ['added', 'removed', 'modified']) c[key] = [];
  while (size() > MAX_EVENT_BYTES && commits.length > 1) commits.shift();
  if (size() <= MAX_EVENT_BYTES) return payload;
  const pull = payload.pull_request as Record<string, Value> | undefined;
  if (pull) pull.body = boundedEventText(String(pull.body ?? ''), 4096);
  for (const c of [
    ...commits,
    payload.head_commit as Record<string, Value> | null,
  ])
    if (c) c.message = boundedEventText(String(c.message ?? ''), 512);
  if (size() <= MAX_EVENT_BYTES) return payload;
  // Bound JSON-escaped strings as well (a control character takes six serialized bytes).
  const bound = (value: Value): Value => {
    if (typeof value === 'string') return boundedEventText(value, 128);
    if (Array.isArray(value)) return value.map(bound);
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, bound(item)])
      );
    return value;
  };
  const minimal = bound(payload) as Record<string, Value>;
  if (encoder.encode(JSON.stringify(minimal)).length > MAX_EVENT_BYTES)
    throw new Error('Actions event payload exceeds its byte limit.');
  return minimal;
}
