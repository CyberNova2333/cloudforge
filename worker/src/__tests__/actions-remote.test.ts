import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearActionMetaCache } from '../actions/executor';
import { parseActionYaml, parseUses } from '../actions/remote';
import type { StepRequest } from '../actions/job-runner';
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

/** action.yml files GitHub would serve, by raw.githubusercontent.com path. */
let github: Record<string, string> = {};

beforeEach(() => {
  clearActionMetaCache();
  github = {};
  const real = globalThis.fetch;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    const m = /^https:\/\/raw\.githubusercontent\.com\/(.+)$/.exec(url);
    if (!m) return real(input, init);
    return m[1] in github
      ? new Response(github[m[1]])
      : new Response('404: Not Found', { status: 404 });
  });
});
afterEach(() => vi.restoreAllMocks());

async function runWorkflow(
  s: Setup,
  yml: string,
  onStep: (r: StepRequest) => Record<string, unknown> = () => ({}),
  files: Record<string, string> = {}
) {
  await pushFiles(s, 'main', { '.github/workflows/ci.yml': yml, ...files });
  const [queued] = (await runs(s.t, s.admin)).runs;
  const h = harness(s.t, onStep);
  const result = await h.run(queued.id);
  const { jobs } = await runDetail(s.t, s.admin, 1);
  const log = async (n: number) =>
    (
      await call(
        s.t,
        `/api/repos/octocat/app/actions/runs/1/jobs/${jobs[0].id}/steps/${n}/logs`,
        { cookie: s.admin }
      )
    ).text();
  return { result, h, steps: jobs[0].steps, log };
}

const SETUP_TOOL = `name: Setup tool
inputs:
  version:
    default: '1.0'
  token:
    default: \${{ github.server_url == 'https://github.com' && github.token || '' }}
outputs:
  path:
    description: Where it went
runs:
  using: node20
  main: dist/index.js
  post: dist/post.js
`;

describe('JavaScript actions from GitHub', () => {
  it('downloads and runs the action with its inputs, outputs and state, then its post step', async () => {
    const s = await setup();
    github['acme/setup-tool/v1/action.yml'] = SETUP_TOOL;
    const { result, h, steps, log } = await runWorkflow(
      s,
      `on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: acme/setup-tool@v1
        id: tool
        with:
          version: '2.0'
      - run: echo "tool at \${{ steps.tool.outputs.path }}"
`,
      (r) =>
        script(r).includes('dist/index.js')
          ? { outputs: { path: '/opt/tool' }, state: { pid: '42' } }
          : {}
    );
    expect(result).toBe('success');
    const [main, after, post] = h.requests;
    expect(script(main)).toContain(
      'https://codeload.github.com/acme/setup-tool/tar.gz/v1'
    );
    expect(script(main)).toContain(
      "node '/opt/gitorange/actions/acme/setup-tool/v1/dist/index.js'"
    );
    expect(main.env).toMatchObject({
      INPUT_VERSION: '2.0',
      // Not on github.com: the action's own expression leaves the GitHub token out.
      INPUT_TOKEN: '',
      GITHUB_ACTION: 'tool',
      GITHUB_ACTION_PATH: '/opt/gitorange/actions/acme/setup-tool/v1',
      GITHUB_ACTION_REPOSITORY: 'acme/setup-tool',
      GITHUB_ACTION_REF: 'v1',
      RUNNER_TOOL_CACHE: '/opt/hostedtoolcache',
    });
    expect(script(after)).toContain('tool at /opt/tool');
    expect(script(post)).toContain('dist/post.js');
    expect(post.env.STATE_pid).toBe('42');
    expect(steps.map((x) => [x.name, x.conclusion])).toEqual([
      ['Set up job', 'success'],
      ['Run acme/setup-tool@v1', 'success'],
      ['Run echo "tool at ${{ steps.tool.outputs.path }}"', 'success'],
      ['Post Run acme/setup-tool@v1', 'success'],
      ['Complete job', 'success'],
    ]);
    expect(await log(4)).toContain('Post job cleanup for acme/setup-tool@v1');
  });

  it('skips the post step of an action that has none, and honours post-if', async () => {
    const s = await setup();
    github['acme/plain/v2/action.yml'] =
      'runs:\n  using: node24\n  main: index.js\n';
    github['acme/on-fail/v1/action.yml'] =
      'runs:\n  using: node20\n  main: index.js\n  post: post.js\n  post-if: failure()\n';
    const { result, h, steps, log } = await runWorkflow(
      s,
      `on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: acme/plain@v2
      - uses: acme/on-fail@v1
`
    );
    expect(result).toBe('success');
    expect(h.requests).toHaveLength(2);
    expect(steps.map((x) => x.conclusion)).toEqual([
      'success',
      'success',
      'success',
      'skipped',
      'skipped',
      'success',
    ]);
    // Post steps run in reverse: on-fail's first, then plain's.
    expect(await log(4)).toContain('post-if (failure()) is false');
    expect(await log(5)).toContain('no post step');
  });

  it('fails clearly for an action GitHub doesn’t have, or one that needs Docker', async () => {
    const s = await setup();
    github['acme/docker-thing/v1/action.yml'] =
      "runs:\n  using: docker\n  image: 'Dockerfile'\n";
    const { result, h, log } = await runWorkflow(
      s,
      `on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: acme/missing@v1
        continue-on-error: true
      - uses: acme/docker-thing@v1
        continue-on-error: true
      - uses: docker://alpine:3
`
    );
    expect(result).toBe('failure');
    expect(h.requests).toHaveLength(0);
    expect(await log(2)).toContain('acme/missing@v1 was not found on GitHub');
    expect(await log(3)).toContain('is a Docker action');
    expect(await log(4)).toContain("Docker images can't run");
  });
});

describe('composite actions', () => {
  it('runs a local composite action’s steps with its inputs, and maps its outputs', async () => {
    const s = await setup();
    const { result, h, steps } = await runWorkflow(
      s,
      `on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: ./.github/actions/greet
        id: greet
        with:
          name: Ada
      - run: echo "said \${{ steps.greet.outputs.greeting }}"
`,
      (r) =>
        script(r).includes('hello Ada')
          ? { outputs: { text: 'hello Ada!' }, envAdds: { GREETED: 'yes' } }
          : {},
      {
        '.github/actions/greet/action.yml': `name: Greet
inputs:
  name:
    default: world
  punctuation:
    default: '!'
outputs:
  greeting:
    value: \${{ steps.hello.outputs.text }}
runs:
  using: composite
  steps:
    - id: hello
      run: echo "hello \${{ inputs.name }}\${{ inputs.punctuation }}"
      shell: bash
    - run: echo "greeted=$GREETED from \${{ github.action_path }}"
      shell: bash
    - run: echo never
      if: \${{ inputs.name == 'nobody' }}
      shell: bash
`,
      }
    );
    expect(result).toBe('success');
    const scripts = h.requests.map(script);
    expect(scripts[1]).toContain('hello Ada!');
    expect(scripts[2]).toContain(
      'greeted=$GREETED from /workspace/.github/actions/greet'
    );
    expect(h.requests[2].env.GREETED).toBe('yes');
    expect(scripts.some((x) => x.includes('echo never'))).toBe(false);
    expect(scripts[3]).toContain('said hello Ada!');
    // A local action gets no Post step.
    expect(steps.map((x) => x.name)).toEqual([
      'Set up job',
      'Run actions/checkout@v4',
      'Run ./.github/actions/greet',
      'Run echo "said ${{ steps.greet.outputs.greeting }}"',
      'Complete job',
    ]);
  });

  it('downloads a GitHub composite action first, and fails when one of its steps fails', async () => {
    const s = await setup();
    github['acme/tools/v3/lint/action.yml'] = `runs:
  using: composite
  steps:
    - run: \${{ github.action_path }}/lint.sh
      shell: bash
    - run: echo unreachable
      shell: bash
`;
    const { result, h, steps } = await runWorkflow(
      s,
      `on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: acme/tools/lint@v3
`,
      (r) => (script(r).includes('lint.sh') ? { exitCode: 2 } : {})
    );
    expect(result).toBe('failure');
    const scripts = h.requests.map(script);
    expect(scripts[0]).toContain(
      'https://codeload.github.com/acme/tools/tar.gz/v3'
    );
    expect(scripts[1]).toContain(
      '/opt/gitorange/actions/acme/tools/v3/lint/lint.sh'
    );
    expect(scripts.some((x) => x.includes('unreachable'))).toBe(false);
    expect(steps[1].conclusion).toBe('failure');
  });
});

describe('reading uses: and action.yml', () => {
  it('tells built-in, GitHub and local actions apart', () => {
    expect(parseUses('actions/checkout@v4')).toBeNull();
    expect(parseUses('actions/upload-artifact@v4')).toBeNull();
    expect(parseUses('actions/setup-python@v5')).toEqual({
      kind: 'github',
      owner: 'actions',
      repo: 'setup-python',
      path: '',
      ref: 'v5',
    });
    expect(parseUses('acme/tools/lint@release/2')).toMatchObject({
      path: 'lint',
      ref: 'release/2',
    });
    expect(parseUses('./.github/actions/x')).toEqual({
      kind: 'local',
      path: '.github/actions/x',
    });
    for (const bad of ['acme/tools', './../etc', 'acme/x@v1;rm', 'a/b@..'])
      expect(() => parseUses(bad), bad).toThrow();
  });

  it('reads inputs, entry points and composite steps', () => {
    const js = parseActionYaml(SETUP_TOOL, 'acme/setup-tool@v1');
    expect(js).toMatchObject({
      using: 'node',
      main: 'dist/index.js',
      post: 'dist/post.js',
      postIf: 'always()',
      inputs: { version: { default: '1.0', required: false } },
    });
    expect(() => parseActionYaml('runs:\n  using: node20\n', 'x')).toThrow(
      /no runs.main/
    );
  });
});
