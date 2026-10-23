import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret, secretMasks } from '../actions/secrets';
import { addMember, call } from './helpers/app';
import {
  harness,
  pushFiles,
  runDetail,
  runs,
  script,
  setup,
  type Setup,
} from './helpers/actions';

const base = '/api/repos/octocat/app/actions';
const put = (s: Setup, cookie: string, path: string, value: string) =>
  call(s.t, path, { cookie, method: 'PUT', json: { value } });
const get = async <T = Record<string, unknown>>(
  s: Setup,
  cookie: string,
  path: string
) => (await (await call(s.t, path, { cookie })).json()) as T;
type List = {
  configured: boolean;
  items: { name: string; value: string | null; updatedBy: unknown }[];
  inherited: { name: string; value: string | null }[];
};

async function runOnce(
  s: Setup,
  yml: string,
  onStep?: Parameters<typeof harness>[1]
) {
  await pushFiles(s, 'main', { '.github/workflows/ci.yml': yml });
  const [queued] = (await runs(s.t, s.admin)).runs;
  const h = harness(s.t, onStep);
  const result = await h.run(queued.id);
  const { jobs } = await runDetail(s.t, s.admin, 1);
  const log = async (job: string, n: number) =>
    (
      await call(
        s.t,
        `/api/repos/octocat/app/actions/runs/1/jobs/${jobs.find((j) => j.name === job)!.id}/steps/${n}/logs`,
        { cookie: s.admin }
      )
    ).text();
  return { result, h, log };
}

describe('secret encryption', () => {
  it('round-trips, and a ciphertext opens only for its own row and key', async () => {
    const { t } = await setup();
    const c = await encryptSecret(t.env, 'repo-1', 'TOKEN', 'hunter22');
    expect(c).toMatch(/^v1\./);
    expect(c).not.toContain('hunter22');
    expect(await decryptSecret(t.env, 'repo-1', 'TOKEN', c)).toBe('hunter22');
    expect(await decryptSecret(t.env, 'repo-2', 'TOKEN', c)).toBeNull();
    expect(await decryptSecret(t.env, 'repo-1', 'OTHER', c)).toBeNull();
    expect(await decryptSecret(t.env, null, 'TOKEN', c)).toBeNull();
    const rotated = {
      ...t.env,
      ACTIONS_SECRETS_KEY: 'another-key',
    } as CloudflareBindings;
    expect(await decryptSecret(rotated, 'repo-1', 'TOKEN', c)).toBeNull();
    // Two saves of one value never look alike.
    expect(await encryptSecret(t.env, 'repo-1', 'TOKEN', 'hunter22')).not.toBe(
      c
    );
  });

  it('masks each line of a multi-line secret, longest first', () => {
    expect(secretMasks({ A: 'line-one\nline-two', B: 'abc' })).toEqual([
      'line-one\nline-two',
      'line-one',
      'line-two',
      'abc',
    ]);
  });
});

describe('Actions secrets and variables API', () => {
  it('lets repository admins save secrets (write-only, encrypted) and variables (plain text)', async () => {
    const s = await setup();
    const first = await put(
      s,
      s.admin,
      `${base}/secrets/npm_token`,
      'tok-1234'
    );
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ name: 'NPM_TOKEN', created: true });
    expect(
      await (
        await put(s, s.admin, `${base}/secrets/NPM_TOKEN`, 'tok-5678')
      ).json()
    ).toEqual({ name: 'NPM_TOKEN', created: false });
    await put(s, s.admin, `${base}/variables/region`, 'eu-west-1');

    const secrets = await get<List>(s, s.admin, `${base}/secrets`);
    expect(secrets).toMatchObject({
      configured: true,
      items: [
        { name: 'NPM_TOKEN', value: null, updatedBy: { username: 'octocat' } },
      ],
      inherited: [],
    });
    expect(JSON.stringify(secrets)).not.toContain('tok-');
    expect(
      (await get<List>(s, s.admin, `${base}/variables`)).items
    ).toMatchObject([{ name: 'REGION', value: 'eu-west-1' }]);

    const row = await s.t.env.DB.prepare(
      "SELECT value FROM actions_variables WHERE name = 'NPM_TOKEN'"
    ).first<{ value: string }>();
    expect(row!.value).toMatch(/^v1\./);
    expect(row!.value).not.toContain('tok-');

    const del = await call(s.t, `${base}/secrets/npm_token`, {
      cookie: s.admin,
      method: 'DELETE',
    });
    expect(del.status).toBe(200);
    expect(
      (
        await call(s.t, `${base}/secrets/NPM_TOKEN`, {
          cookie: s.admin,
          method: 'DELETE',
        })
      ).status
    ).toBe(404);

    // The audit log names them and never holds a value.
    const audit = await s.t.env.DB.prepare(
      "SELECT action, target, data FROM audit_events WHERE action LIKE 'secret.%' OR action LIKE 'variable.%' ORDER BY created_at, rowid"
    ).all<{ action: string; target: string; data: string }>();
    expect(audit.results.map((a) => [a.action, a.target])).toEqual([
      ['secret.saved', 'NPM_TOKEN'],
      ['secret.saved', 'NPM_TOKEN'],
      ['variable.saved', 'REGION'],
      ['secret.deleted', 'NPM_TOKEN'],
    ]);
    expect(JSON.parse(audit.results[0].data)).toEqual({
      scope: 'repository',
      created: true,
    });
    expect(JSON.stringify(audit.results)).not.toMatch(/tok-|eu-west/);
  });

  it('refuses bad names and values, and anyone but repository admins', async () => {
    const s = await setup();
    for (const [name, message] of [
      ['1ABC', /may not start with a digit/],
      ['A-B', /only letters, digits and underscores/],
      ['GITHUB_TOKEN', /reserved for the runner/],
      ['cloudforge_x', /reserved for the runner/],
    ] as const) {
      const r = await put(s, s.admin, `${base}/secrets/${name}`, 'value');
      expect(r.status, name).toBe(400);
      expect(((await r.json()) as { error: string }).error).toMatch(message);
    }
    expect((await put(s, s.admin, `${base}/variables/X`, '')).status).toBe(400);
    const big = await put(
      s,
      s.admin,
      `${base}/variables/X`,
      'x'.repeat(48 * 1024 + 1)
    );
    expect(((await big.json()) as { error: string }).error).toBe(
      'Values are at most 48 KB.'
    );

    const bob = await addMember(s.t, s.admin, 'bob');
    await call(s.t, '/api/repos/octocat/app/collaborators/bob', {
      cookie: s.admin,
      method: 'PUT',
    });
    expect((await call(s.t, `${base}/secrets`, { cookie: bob })).status).toBe(
      403
    );
    expect((await put(s, bob, `${base}/variables/X`, 'y')).status).toBe(403);
    expect(
      (await call(s.t, '/api/admin/actions/secrets', { cookie: bob })).status
    ).toBe(403);
    expect(
      (await put(s, bob, '/api/admin/actions/variables/X', 'y')).status
    ).toBe(403);
  });

  it('keeps instance-wide ones for site admins and shows a repository what it inherits', async () => {
    const s = await setup();
    await put(s, s.admin, '/api/admin/actions/secrets/SHARED', 'shared-1234');
    await put(s, s.admin, '/api/admin/actions/variables/REGION', 'us-east-1');
    await put(s, s.admin, `${base}/variables/REGION`, 'eu-west-1');

    expect(
      (await get<List>(s, s.admin, '/api/admin/actions/secrets')).items.map(
        (i) => [i.name, i.value]
      )
    ).toEqual([['SHARED', null]]);
    const repoSecrets = await get<List>(s, s.admin, `${base}/secrets`);
    expect(repoSecrets.items).toEqual([]);
    expect(repoSecrets.inherited).toEqual([{ name: 'SHARED', value: null }]);
    const repoVars = await get<List>(s, s.admin, `${base}/variables`);
    expect(repoVars.items.map((i) => [i.name, i.value])).toEqual([
      ['REGION', 'eu-west-1'],
    ]);
    // The repository's own REGION wins, so the instance's isn't listed as inherited.
    expect(repoVars.inherited).toEqual([]);

    const audit = await s.t.env.DB.prepare(
      "SELECT repository_id, data FROM audit_events WHERE action = 'secret.saved'"
    ).first<{ repository_id: string | null; data: string }>();
    expect(audit!.repository_id).toBeNull();
    expect(JSON.parse(audit!.data)).toMatchObject({ scope: 'instance' });
  });
});

describe('secrets and variables in jobs', () => {
  it('reads them in steps, masks secrets in every log, and withholds outputs that carry one', async () => {
    const s = await setup();
    await put(
      s,
      s.admin,
      '/api/admin/actions/secrets/DEPLOY_KEY',
      'inst-key-111'
    );
    await put(
      s,
      s.admin,
      '/api/admin/actions/secrets/NPM_TOKEN',
      'inst-npm-000'
    );
    await put(s, s.admin, `${base}/secrets/NPM_TOKEN`, 'repo-npm-999');
    await put(s, s.admin, `${base}/variables/region`, 'eu-west-1');
    const { result, h, log } = await runOnce(
      s,
      `on: push
jobs:
  build:
    runs-on: ubuntu-latest
    outputs:
      leaked: \${{ steps.a.outputs.token }}
      region: \${{ vars.REGION }}
    steps:
      - id: a
        run: echo "publish to \${{ vars.REGION }}"
        env:
          NPM_TOKEN: \${{ secrets.NPM_TOKEN }}
      - run: echo "\${{ secrets.DEPLOY_KEY }} \${{ secrets.MISSING }}end"
  after:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - run: echo "got [\${{ needs.build.outputs.leaked }}] [\${{ needs.build.outputs.region }}]"
`,
      (r) =>
        script(r).includes('publish')
          ? {
              outputs: { token: 'repo-npm-999' },
              log: 'npm token repo-npm-999 used',
            }
          : {}
    );
    expect(result).toBe('success');
    const [first, second, third] = h.requests;
    expect(script(first)).toContain('publish to eu-west-1');
    expect(first.env.NPM_TOKEN).toBe('repo-npm-999');
    expect(first.masks).toEqual(
      expect.arrayContaining(['repo-npm-999', 'inst-key-111'])
    );
    // The repository's NPM_TOKEN replaced the instance's, which no job sees.
    expect(first.masks).not.toContain('inst-npm-000');
    expect(script(second)).toContain('inst-key-111 end');
    expect(script(third)).toContain('got [] [eu-west-1]');

    // What the step printed is stored masked, whatever wrote it.
    const stepLog = await log('build', 2);
    expect(stepLog).toContain('npm token *** used');
    expect(stepLog).not.toContain('repo-npm-999');
    expect(await log('build', 4)).toContain(
      'Warning: skipped the job output leaked: it may contain a secret.'
    );
  });

  it('without ACTIONS_SECRETS_KEY, secrets are refused and read as empty, with a warning', async () => {
    const s = await setup();
    await put(s, s.admin, `${base}/secrets/TOKEN`, 'saved-1234');
    (s.t.env as { ACTIONS_SECRETS_KEY: string }).ACTIONS_SECRETS_KEY = '';
    const r = await put(s, s.admin, `${base}/secrets/OTHER`, 'value-1234');
    expect(r.status).toBe(400);
    expect(((await r.json()) as { error: string }).error).toMatch(
      /ACTIONS_SECRETS_KEY/
    );
    expect((await get<List>(s, s.admin, `${base}/secrets`)).configured).toBe(
      false
    );
    // Variables don't need the key.
    expect((await put(s, s.admin, `${base}/variables/V`, 'v')).status).toBe(
      200
    );

    const { result, h, log } = await runOnce(
      s,
      `on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: echo "[\${{ secrets.TOKEN }}] [\${{ vars.V }}]"
`
    );
    expect(result).toBe('success');
    expect(script(h.requests[0])).toContain('[] [v]');
    expect(await log('build', 1)).toContain(
      'Warning: This server has no ACTIONS_SECRETS_KEY, so every secret is empty in this run.'
    );
  });

  it('a secret saved under another key reads as empty, and the job says so', async () => {
    const s = await setup();
    await put(s, s.admin, `${base}/secrets/TOKEN`, 'saved-1234');
    (s.t.env as { ACTIONS_SECRETS_KEY: string }).ACTIONS_SECRETS_KEY =
      'a-rotated-key';
    const { h, log } = await runOnce(
      s,
      `on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: echo "[\${{ secrets.TOKEN }}]"
`
    );
    expect(script(h.requests[0])).toContain('[]');
    expect(await log('build', 1)).toContain(
      'Secret TOKEN could not be decrypted (was ACTIONS_SECRETS_KEY changed?)'
    );
  });
});
