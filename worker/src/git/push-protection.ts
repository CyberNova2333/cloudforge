// Branch protection for pushes through the git endpoint (git-http.ts). The default branch and the repository's
// protected branches (`repositories.protected_branches`) move only through CloudForge itself (landPull, its rebases,
// which push to Artifacts directly) or a repository admin's fast-forward: nobody deletes or rewrites them, and a
// collaborator opens a pull request. `refs/pull/*` (PR heads, pre-rebase heads, landing receipts) is CloudForge's own.

import { concat, decoder } from './bytes';
import { FLUSH, parsePktLines, pktLine } from './pktline';
import { ZERO_SHA } from './remote';
import { protectedBy } from '../lib/protected-branches';

export type PushCommand = { old: string; new: string; ref: string };

/** The command list a receive-pack request starts with, and its whole body again (as received) to forward. */
export type ReceiveRequest = {
  commands: PushCommand[];
  capabilities: string[];
  body: ReadableStream<Uint8Array>;
};

/** The longest command list read (thousands of refs); a longer one is refused as malformed. */
export const MAX_COMMAND_LIST_BYTES = 1024 * 1024;

const COMMAND = /^([0-9a-f]{40}) ([0-9a-f]{40}) (\S+)$/;

/**
 * Reads a receive-pack request's command list (`*shallow-line command-list`, up to its flush) without consuming
 * the packfile after it. Null when it isn't one (the stream is cancelled then).
 */
export async function readReceiveRequest(
  stream: ReadableStream<Uint8Array>
): Promise<ReceiveRequest | null> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let buf: Uint8Array = new Uint8Array(0);
  const more = async () => {
    if (buf.length > MAX_COMMAND_LIST_BYTES) return false;
    const { value, done } = await reader.read();
    if (done) return false;
    chunks.push(value);
    buf = concat([buf, value]);
    return true;
  };
  const fail = async () => {
    await reader.cancel().catch(() => {});
    return null;
  };
  const commands: PushCommand[] = [];
  let capabilities: string[] = [];
  for (let off = 0; ;) {
    while (buf.length < off + 4) if (!(await more())) return fail();
    const len = parseInt(decoder.decode(buf.subarray(off, off + 4)), 16);
    if (len === 0) break;
    if (!Number.isInteger(len) || len < 5) return fail();
    while (buf.length < off + len) if (!(await more())) return fail();
    let line = decoder.decode(buf.subarray(off + 4, off + len));
    off += len;
    line = line.replace(/\n$/, '');
    if (line.startsWith('shallow ')) continue;
    const nul = line.indexOf('\0');
    if (nul >= 0) {
      if (!commands.length)
        capabilities = line
          .slice(nul + 1)
          .split(' ')
          .filter(Boolean);
      line = line.slice(0, nul);
    }
    const m = COMMAND.exec(line);
    if (!m) return fail();
    commands.push({ old: m[1], new: m[2], ref: m[3] });
  }
  // Everything read so far goes first, untouched, then the rest of the stream.
  let pending: Uint8Array[] | null = chunks;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (pending) {
        for (const c of pending) controller.enqueue(c);
        pending = null;
        return;
      }
      const { value, done } = await reader.read();
      if (done) controller.close();
      else controller.enqueue(value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
  return { commands, capabilities, body };
}

export type PushRules = {
  defaultBranch: string;
  protectedPatterns: readonly string[] | null;
  /** The pusher is a repository admin (owner, team repository creator, site admin). */
  admin: boolean;
  /** The repository has no branches yet: whoever may push creates its default branch. */
  empty: boolean;
};

export type PushDecision = {
  /** Refused refs, with the reason git shows; any refusal refuses the whole push. */
  refused: Map<string, string>;
  /** An admin's updates of protected branches: allowed only as fast-forwards, checked once the objects are in. */
  fastForwardOnly: PushCommand[];
};

/** The protected branch `ref` is (the default branch or a protected pattern's match), or null. */
export function protectedBranchOf(
  ref: string,
  rules: Pick<PushRules, 'defaultBranch' | 'protectedPatterns'>
): string | null {
  if (!ref.startsWith('refs/heads/')) return null;
  const branch = ref.slice('refs/heads/'.length);
  return branch === rules.defaultBranch ||
    protectedBy(rules.protectedPatterns, branch)
    ? branch
    : null;
}

/** Whether a push needs to know if the repository is empty (a collaborator creating the default branch). */
export function needsEmptyCheck(
  commands: PushCommand[],
  rules: Pick<PushRules, 'defaultBranch' | 'admin'>
) {
  return (
    !rules.admin &&
    commands.some(
      (c) => c.ref === `refs/heads/${rules.defaultBranch}` && c.old === ZERO_SHA
    )
  );
}

/** What branch protection allows of a push. */
export function decidePush(
  commands: PushCommand[],
  rules: PushRules
): PushDecision {
  const refused = new Map<string, string>();
  const fastForwardOnly: PushCommand[] = [];
  for (const c of commands) {
    if (c.ref.startsWith('refs/pull/')) {
      refused.set(c.ref, 'refs/pull/ is managed by CloudForge');
      continue;
    }
    const branch = protectedBranchOf(c.ref, rules);
    if (!branch) continue;
    if (c.new === ZERO_SHA) {
      refused.set(
        c.ref,
        `${branch} is a protected branch and can't be deleted`
      );
      continue;
    }
    if (!rules.admin) {
      if (rules.empty && branch === rules.defaultBranch && c.old === ZERO_SHA)
        continue;
      refused.set(
        c.ref,
        `${branch} is a protected branch: open a pull request (only repository admins push to it)`
      );
      continue;
    }
    if (c.old !== ZERO_SHA) fastForwardOnly.push(c);
  }
  return { refused, fastForwardOnly };
}

/** The client asked for report-status (v1 or v2): a refusal can be told per ref. */
export const reportsStatus = (capabilities: string[]) =>
  capabilities.includes('report-status') ||
  capabilities.includes('report-status-v2');

/** Bytes of report per side-band packet the client takes, or 0 without side-band. */
function sidebandMax(capabilities: string[]) {
  if (capabilities.includes('side-band-64k')) return 65515;
  if (capabilities.includes('side-band')) return 995;
  return 0;
}

/** A report-status reply as the client asked for it (on side-band 1 or plain), ending with the flush. */
function encodeReport(lines: string[], capabilities: string[]): Uint8Array {
  const inner = concat([...lines.map((l) => pktLine(`${l}\n`)), FLUSH]);
  const max = sidebandMax(capabilities);
  if (!max) return inner;
  const out: Uint8Array[] = [];
  for (let i = 0; i < inner.length; i += max)
    out.push(
      pktLine(concat([new Uint8Array([1]), inner.subarray(i, i + max)]))
    );
  out.push(FLUSH);
  return concat(out);
}

/** The reply to a refused push: every ref rejected, the refused ones with their reason. */
export function refusalReport(
  commands: PushCommand[],
  refused: Map<string, string>,
  capabilities: string[]
): Uint8Array {
  return encodeReport(
    [
      'unpack ok',
      ...commands.map(
        (c) =>
          `ng ${c.ref} ${refused.get(c.ref) ?? 'declined: another ref of this push was refused'}`
      ),
    ],
    capabilities
  );
}

/**
 * Upstream's receive-pack reply with the refs of `refused` reported as rejected (`ng`, their v2 option lines dropped);
 * progress messages are kept. Null when the reply has no report to rewrite.
 */
export function rewriteReport(
  body: Uint8Array,
  capabilities: string[],
  refused: Map<string, string>
): Uint8Array | null {
  const max = sidebandMax(capabilities);
  const progress: Uint8Array[] = [];
  let inner = body;
  if (max) {
    const parts: Uint8Array[] = [];
    for (const p of parsePktLines(body)) {
      if (p.type !== 'data' || !p.data.length) continue;
      if (p.data[0] === 1) parts.push(p.data.subarray(1));
      else progress.push(pktLine(p.data));
    }
    inner = concat(parts);
  }
  const lines: string[] = [];
  let dropping = false;
  for (const p of parsePktLines(inner)) {
    if (p.type !== 'data') continue;
    const line = decoder.decode(p.data).replace(/\n$/, '');
    if (line.startsWith('option ')) {
      if (!dropping) lines.push(line);
      continue;
    }
    dropping = false;
    const m = /^(?:ok|ng) (\S+)/.exec(line);
    if (m && refused.has(m[1])) {
      lines.push(`ng ${m[1]} ${refused.get(m[1])}`);
      dropping = true;
      continue;
    }
    lines.push(line);
  }
  if (!lines.length) return null;
  return concat([...progress, encodeReport(lines, capabilities)]);
}
