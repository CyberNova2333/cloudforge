// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSE).
import { describe, expect, it } from 'vitest';
import type { StepRequest } from '../actions/job-runner';
import { artifactNameError } from '../actions/artifacts';
import { deleteRepositoryLogs } from '../actions/trigger';
import { call } from './helpers/app';
import {
  harness,
  pushFiles,
  runDetail,
  runs,
  script,
  setup,
  type Setup,
} from './helpers/actions';

/** The R2 key a pre-signed URL points at. */
const keyOf = (url: string) =>
  decodeURIComponent(new URL(url).pathname.split('/').slice(2).join('/'));

/** A fake runner that "uploads": puts the zip where the step's pre-signed URL points, as curl would. */
function uploading(s: Setup, zips: Record<string, string> = {}) {
  return async (r: StepRequest) => {
    if (r.env.ARTIFACT_URL)
      await s.t.env.ACTIONS_CACHE.put(
        keyOf(r.env.ARTIFACT_URL),
        zips[r.env.ARTIFACT_NAME] ?? `zip of ${r.env.ARTIFACT_NAME}`
      );
    return {};
  };
}

async function start(s: Setup, yml: string) {
  await pushFiles(s, 'main', { '.github/workflows/ci.yml': yml });
  const [queued] = (await runs(s.t, s.admin)).runs;
  return queued;
}

const stepLog = async (s: Setup, jobId: string, n: number) =>
  (
    await call(
      s.t,
      `/api/repos/octocat/app/actions/runs/1/jobs/${jobId}/steps/${n}/logs`,
      { cookie: s.admin }
    )
  ).text();

const repoId = async (s: Setup) =>
  (await s.t.env.DB.prepare(
    "SELECT id FROM repositories WHERE name = 'app'"
  ).first<{ id: string }>())!.id;

describe('build artifacts', () => {
  it('uploads in one job and downloads in the next', async () => {
    const s = await setup();
    const queued = await start(
      s,
      `on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/upload-artifact@v4
        with:
          name: dist
          path: |
            dist/
            !dist/**/*.map
          retention-days: 3
      - uses: actions/upload-artifact@v4
        with:
          name: logs
          path: logs/*.txt
          if-no-files-found: error
          compression-level: 0
          include-hidden-files: true
  test:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/download-artifact@v4
        with:
          name: dist
          path: out/
      - uses: actions/download-artifact@v4
        with:
          pattern: d*
          merge-multiple: true
      - uses: actions/download-artifact@v4
      - uses: actions/download-artifact@v4
        with:
          name: missing
        continue-on-error: true
`
    );
    const h = harness(s.t, uploading(s));
    expect(await h.run(queued.id)).toBe('success');
    const { run, jobs } = await runDetail(s.t, s.admin, 1);
    const build = jobs.find((j) => j.name === 'build')!;
    const test = jobs.find((j) => j.name === 'test')!;
    const id = await repoId(s);

    const [dist, logs, one, merged, all] = h.requests;
    expect(keyOf(dist.env.ARTIFACT_URL)).toBe(
      `actions-artifacts/${id}/${run.id}/dist/${build.id}-2.zip`
    );
    expect(dist.env).toMatchObject({
      ARTIFACT_NAME: 'dist',
      ARTIFACT_PATHS: 'dist/\n!dist/**/*.map',
      ARTIFACT_IF_NO_FILES: 'warn',
      ARTIFACT_LEVEL: '6',
      ARTIFACT_HIDDEN: 'false',
    });
    expect(dist.masks).toContain(dist.env.ARTIFACT_URL);
    expect(script(dist)).toContain("python3 - <<'CLOUDFORGE_ZIP'");
    expect(script(dist)).toContain('retention-days is not used here');
    expect(script(dist)).toContain(
      `artifact-url=http://test.local/api/repos/octocat/app/actions/runs/1/artifacts/dist/zip`
    );
    expect(logs.env).toMatchObject({
      ARTIFACT_IF_NO_FILES: 'error',
      ARTIFACT_LEVEL: '0',
      ARTIFACT_HIDDEN: 'true',
    });

    // By name: straight into `path`.
    expect(keyOf(one.env.ARTIFACT_URL_0)).toBe(keyOf(dist.env.ARTIFACT_URL));
    expect(one.env.ARTIFACT_URL_1).toBeUndefined();
    expect(script(one)).toContain(
      "unzip -oq /tmp/cloudforge-artifact-0.zip -d '/workspace/out'"
    );
    expect(script(one)).toContain("'download-path=/workspace/out'");
    // A pattern, merged into the workspace.
    expect(script(merged)).toContain("-d '/workspace'\n");
    expect(merged.env.ARTIFACT_URL_1).toBeUndefined();
    // Everything: one directory per artifact.
    expect(script(all)).toContain("-d '/workspace/dist'");
    expect(script(all)).toContain("-d '/workspace/logs'");
    // Earlier signed URLs stay masked even when a later step renews the signature.
    expect([...new Set(all.masks)].sort()).toEqual(
      [
        ...new Set([
          one.env.ARTIFACT_URL_0,
          merged.env.ARTIFACT_URL_0,
          all.env.ARTIFACT_URL_0,
          all.env.ARTIFACT_URL_1,
        ]),
      ].sort()
    );
    expect(await stepLog(s, test.id, 5)).toContain(
      "Artifact 'missing' was not found in this run. It has: dist, logs."
    );
  });

  it('lists, serves and deletes a run’s artifacts over the API', async () => {
    const s = await setup();
    const queued = await start(
      s,
      `on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/upload-artifact@v4
        with:
          name: 报告 v1
          path: report.html
      - uses: actions/upload-artifact@v4
        with:
          path: out
`
    );
    await harness(s.t, uploading(s, { '报告 v1': 'PK-report' })).run(queued.id);
    const { jobs } = await runDetail(s.t, s.admin, 1);
    const base = '/api/repos/octocat/app/actions/runs/1/artifacts';
    const list = await call(s.t, base, { cookie: s.admin });
    expect(list.status).toBe(200);
    expect((await list.json()) as unknown).toMatchObject({
      artifacts: [
        { name: 'artifact', jobId: jobs[0].id },
        { name: '报告 v1', size: 'PK-report'.length, jobId: jobs[0].id },
      ],
    });

    const zip = await call(
      s.t,
      `${base}/${encodeURIComponent('报告 v1')}/zip`,
      { cookie: s.admin }
    );
    expect(zip.status).toBe(200);
    expect(zip.headers.get('Content-Type')).toBe('application/zip');
    expect(zip.headers.get('Content-Disposition')).toContain(
      `filename*=UTF-8''${encodeURIComponent('报告 v1.zip')}`
    );
    expect(await zip.text()).toBe('PK-report');
    expect(
      (await call(s.t, `${base}/nope/zip`, { cookie: s.admin })).status
    ).toBe(404);

    const del = await call(s.t, `${base}/${encodeURIComponent('报告 v1')}`, {
      cookie: s.admin,
      method: 'DELETE',
    });
    expect(del.status).toBe(200);
    const after = (await (
      await call(s.t, base, { cookie: s.admin })
    ).json()) as {
      artifacts: { name: string }[];
    };
    expect(after.artifacts.map((a) => a.name)).toEqual(['artifact']);
    const audit = await s.t.env.DB.prepare(
      "SELECT target, data FROM audit_events WHERE action = 'artifact.deleted'"
    ).first<{ target: string; data: string }>();
    expect(audit?.target).toBe('报告 v1');
    expect(JSON.parse(audit!.data)).toMatchObject({ run: 1 });

    // Deleting the repository's logs takes its artifacts too.
    await deleteRepositoryLogs(s.t.env, await repoId(s));
    expect(
      (
        await s.t.env.ACTIONS_CACHE.list({
          prefix: `actions-artifacts/${await repoId(s)}/`,
        })
      ).objects
    ).toHaveLength(0);
  });

  it('refuses a second upload of a name unless overwrite, which replaces it', async () => {
    const s = await setup();
    const queued = await start(
      s,
      `on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/upload-artifact@v4
        with:
          name: out
          path: a
      - uses: actions/upload-artifact@v4
        continue-on-error: true
        with:
          name: out
          path: b
      - uses: actions/upload-artifact@v4
        with:
          name: out
          path: c
          overwrite: true
      - uses: actions/upload-artifact@v4
        continue-on-error: true
        with:
          name: a/b
          path: c
`
    );
    const h = harness(s.t, uploading(s));
    expect(await h.run(queued.id)).toBe('success');
    expect(h.requests.map((r) => r.env.ARTIFACT_PATHS)).toEqual(['a', 'c']);
    const { run, jobs } = await runDetail(s.t, s.admin, 1);
    expect(await stepLog(s, jobs[0].id, 3)).toContain(
      "An artifact named 'out' was already uploaded in this run"
    );
    expect(await stepLog(s, jobs[0].id, 5)).toContain(
      "contains '/', which artifact names can't contain"
    );
    const left = await s.t.env.ACTIONS_CACHE.list({
      prefix: `actions-artifacts/${await repoId(s)}/${run.id}/`,
    });
    expect(left.objects.map((o) => o.key.split('/').pop())).toEqual([
      `${jobs[0].id}-4.zip`,
    ]);
  });

  it('checks names like GitHub', () => {
    expect(artifactNameError('my-artifact_1.0 (linux)')).toBeNull();
    expect(artifactNameError('')).toMatch(/empty/);
    expect(artifactNameError('a:b')).toMatch(/contains ':'/);
    expect(artifactNameError('x\ny')).toMatch(/contains '\\n'/);
  });
});
