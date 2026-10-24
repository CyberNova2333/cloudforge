// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { concat, decoder, encoder } from './bytes';
import {
  FLUSH,
  parsePktLines,
  parseRefAdvertisement,
  pktLine,
  type RefAdvertisement,
} from './pktline';
import { buildPack } from './pack';
import type { GitObject } from './objects';

export const ZERO_SHA = '0000000000000000000000000000000000000000';

export class GitPushError extends Error {}

type Scope = 'read' | 'write';

/** Seconds a minted Artifacts token lives. */
const TOKEN_TTL = 300;
/** A cached token is used until this long before it expires, so a request it starts never outlives it. */
const TOKEN_MARGIN_MS = 60_000;
/** Repositories remembered per isolate; the oldest is forgotten first. */
const MAX_CACHED_REPOS = 1000;

/**
 * What each request would otherwise ask Artifacts' control plane again (`get`, `info`, `createToken`: 2,000 calls per
 * 10 s for the whole namespace), remembered per isolate and binding: a repository's remote URL, and its tokens until
 * shortly before they expire. Only plain strings: the binding's objects belong to the request that made them.
 */
type CachedRepo = {
  remote?: string;
  tokens: Partial<Record<Scope, { plaintext: string; until: number }>>;
};
const cached = new WeakMap<Artifacts, Map<string, CachedRepo>>();

function cacheFor(artifacts: Artifacts, name: string): CachedRepo {
  let repos = cached.get(artifacts);
  if (!repos) cached.set(artifacts, (repos = new Map()));
  let entry = repos.get(name);
  if (!entry) {
    if (repos.size >= MAX_CACHED_REPOS)
      repos.delete(repos.keys().next().value!);
    repos.set(name, (entry = { tokens: {} }));
  }
  return entry;
}

/** One Artifacts repo: the binding for object reads, smart HTTP for refs and pushes. */
export class ArtifactsRepoClient {
  private handle?: Promise<ArtifactsRepo>;
  private remoteUrl?: Promise<string>;

  constructor(
    private readonly artifacts: Artifacts,
    readonly name: string
  ) {}

  repo(): Promise<ArtifactsRepo> {
    this.handle ??= this.artifacts.get(this.name);
    return this.handle;
  }

  remote(): Promise<string> {
    const entry = cacheFor(this.artifacts, this.name);
    if (entry.remote) return Promise.resolve(entry.remote);
    this.remoteUrl ??= this.repo().then(async (r) => {
      const { remote } = await r.info();
      entry.remote = remote;
      return remote;
    });
    return this.remoteUrl;
  }

  /**
   * A token for this repository, reused within the isolate until shortly before it expires. `fresh` mints a new one
   * that lives its whole TTL (one handed to a runner, which uses it later and elsewhere).
   */
  async token(scope: Scope, opts: { fresh?: boolean } = {}): Promise<string> {
    const entry = cacheFor(this.artifacts, this.name);
    const hit = entry.tokens[scope];
    if (!opts.fresh && hit && hit.until > Date.now()) return hit.plaintext;
    const minted = Date.now();
    const t = await (await this.repo()).createToken(scope, TOKEN_TTL);
    const expires = Date.parse(t.expiresAt);
    entry.tokens[scope] = {
      plaintext: t.plaintext,
      until:
        Math.min(
          minted + TOKEN_TTL * 1000,
          Number.isFinite(expires) ? expires : Infinity
        ) - TOKEN_MARGIN_MS,
    };
    return t.plaintext;
  }

  /** Forgets this repository's cached remote and tokens (Artifacts refused them, or no longer has it there). */
  private forget() {
    cached.get(this.artifacts)?.delete(this.name);
    this.remoteUrl = undefined;
  }

  /** Forwards a smart-HTTP request (path relative to the .git remote) with a minted token. */
  async forward(
    path: string,
    init: {
      method: string;
      headers: Headers;
      body?: ReadableStream | Uint8Array | null;
    },
    scope: Scope
  ): Promise<Response> {
    const send = async (fresh: boolean) => {
      const headers = new Headers(init.headers);
      headers.set(
        'Authorization',
        `Bearer ${await this.token(scope, { fresh })}`
      );
      return fetch((await this.remote()) + path, {
        method: init.method,
        headers,
        body: init.body ?? undefined,
      });
    };
    const res = await send(false);
    if (![401, 403, 404].includes(res.status)) return res;
    // Cached values Artifacts no longer takes (a refused token, a repository gone from that address): forget them,
    // and send again when the body can be, looking the repository up afresh (so a deleted one fails as NOT_FOUND).
    this.forget();
    if (init.body instanceof ReadableStream) return res;
    await res.body?.cancel();
    return send(true);
  }

  async listRefs(): Promise<RefAdvertisement> {
    const res = await this.forward(
      '/info/refs?service=git-upload-pack',
      { method: 'GET', headers: new Headers() },
      'read'
    );
    if (!res.ok) throw new Error(`info/refs failed: ${res.status}`);
    return parseRefAdvertisement(new Uint8Array(await res.arrayBuffer()));
  }

  /** Atomic compare-and-swap ref update: fails if `old` no longer matches. */
  async push(
    updates: { ref: string; old: string; new: string }[],
    objects: GitObject[]
  ): Promise<void> {
    const lines: Uint8Array[] = [];
    updates.forEach((u, i) => {
      const caps = i === 0 ? '\0report-status agent=cloudforge/1.0' : '';
      lines.push(pktLine(`${u.old} ${u.new} ${u.ref}${caps}\n`));
    });
    lines.push(FLUSH);
    const needsPack = updates.some((u) => u.new !== ZERO_SHA);
    if (needsPack) lines.push(await buildPack(objects));
    const res = await this.forward(
      '/git-receive-pack',
      {
        method: 'POST',
        headers: new Headers({
          'Content-Type': 'application/x-git-receive-pack-request',
          Accept: 'application/x-git-receive-pack-result',
        }),
        body: concat(lines),
      },
      'write'
    );
    const body = new Uint8Array(await res.arrayBuffer());
    if (!res.ok)
      throw new GitPushError(
        `push failed: ${res.status} ${decoder.decode(body)}`
      );
    const report = parsePktLines(body)
      .filter((p) => p.type === 'data')
      .map((p) => decoder.decode((p as { data: Uint8Array }).data).trim());
    const unpack = report.find((l) => l.startsWith('unpack'));
    if (unpack && unpack !== 'unpack ok') throw new GitPushError(unpack);
    const failed = report.filter((l) => l.startsWith('ng '));
    if (failed.length) throw new GitPushError(failed.join('; '));
  }
}

export { encoder };
