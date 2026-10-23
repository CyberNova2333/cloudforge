import { describe, expect, it } from 'vitest';
import {
  evaluate,
  evaluateCondition,
  interpolate,
  type Value,
} from '../actions/expressions';
import { mask, parseKeyValueFile, workflowCommands } from '../actions/commands';
import {
  expandMatrix,
  instanceTypeFor,
  matchesPatterns,
  planJobs,
  pullRequestMatches,
  pushMatches,
} from '../actions/plan';
import { parseWorkflow, WorkflowFileError } from '../actions/workflow-file';

const ctx = {
  github: {
    ref: 'refs/heads/main',
    sha: 'abc123',
    event_name: 'push',
    labels: ['bug', 'ci'],
  },
  matrix: { node: 20, os: 'linux' },
  env: { MODE: 'prod' },
  steps: { build: { outputs: { version: '1.2.3' }, outcome: 'success' } },
};

describe('expressions', () => {
  it('reads contexts, case-insensitively, with dots and brackets', () => {
    expect(evaluate('github.sha', ctx)).toBe('abc123');
    expect(evaluate("GitHub['REF']", ctx)).toBe('refs/heads/main');
    expect(evaluate('steps.build.outputs.version', ctx)).toBe('1.2.3');
    expect(evaluate('steps.missing.outputs.x', ctx)).toBe(null);
  });

  it('compares strings case-insensitively and coerces mismatched types', () => {
    expect(evaluate("github.ref == 'REFS/HEADS/MAIN'", ctx)).toBe(true);
    expect(evaluate("matrix.node == '20'", ctx)).toBe(true);
    expect(evaluate('matrix.node >= 18 && matrix.node < 22', ctx)).toBe(true);
    expect(evaluate('!(1 == 1) || null', ctx)).toBe(null);
    expect(evaluate("'' || 'fallback'", ctx)).toBe('fallback');
  });

  it('supports the common functions', () => {
    expect(evaluate("contains(github.labels, 'CI')", ctx)).toBe(true);
    expect(evaluate("startsWith(github.ref, 'refs/heads/')", ctx)).toBe(true);
    expect(evaluate("format('{0}-{1}', matrix.os, matrix.node)", ctx)).toBe(
      'linux-20'
    );
    expect(evaluate("join(github.labels, ', ')", ctx)).toBe('bug, ci');
    expect(evaluate("fromJSON('[1,2]')[1]", ctx)).toBe(2);
  });

  it('interpolates ${{ }} templates', () => {
    expect(interpolate('node-${{ matrix.node }} on ${{ env.MODE }}', ctx)).toBe(
      'node-20 on prod'
    );
  });

  it('rejects unknown contexts and functions', () => {
    expect(() => evaluate('secretz.X', ctx)).toThrow(/Unrecognized/);
    expect(() => evaluate("hashFiles('**/*.lock')", ctx)).toThrow(
      /Unsupported function/
    );
  });

  it('applies the implicit success() to conditions', () => {
    expect(evaluateCondition(undefined, ctx)).toBe(true);
    expect(evaluateCondition(undefined, ctx, { status: 'failure' })).toBe(
      false
    );
    expect(
      evaluateCondition("github.event_name == 'push'", ctx, {
        status: 'failure',
      })
    ).toBe(false);
    expect(
      evaluateCondition('${{ failure() }}', ctx, { status: 'failure' })
    ).toBe(true);
    expect(
      evaluateCondition('always() && matrix.node == 20', ctx, {
        status: 'cancelled',
      })
    ).toBe(true);
  });

  it('lets a job-level if: read a gate job: hyphenated outputs, its result, and always()', () => {
    const cond =
      "always() && needs.build.result == 'success' && (needs.gate.result == 'skipped' || needs.gate.outputs.run-merge-queue == 'true')";
    const needs = (gate: Value, build = 'success') => ({
      needs: { build: { result: build, outputs: {} }, gate },
    });
    const ran = { result: 'success', outputs: { 'run-merge-queue': 'true' } };
    const skipped = {
      result: 'success',
      outputs: { 'run-merge-queue': 'false' },
    };
    expect(evaluateCondition(cond, needs(ran), { status: 'success' })).toBe(
      true
    );
    expect(evaluateCondition(cond, needs(skipped), { status: 'success' })).toBe(
      false
    );
    // On GitHub the gate itself is skipped (no outputs): every module runs.
    expect(
      evaluateCondition(cond, needs({ result: 'skipped', outputs: {} }), {
        status: 'cancelled',
      })
    ).toBe(true);
    // A failed build skips the tests even though always() is there.
    expect(
      evaluateCondition(cond, needs(ran, 'failure'), { status: 'failure' })
    ).toBe(false);
  });
});

describe('workflow files', () => {
  const ci = `
name: CI
on:
  push:
    branches: [main, 'release/**']
  pull_request:
env:
  NODE_ENV: test
jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node: [20, 22]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: \${{ matrix.node }}
      - run: npm ci
      - name: Test
        run: npm test
  deploy:
    needs: test
    if: github.ref == 'refs/heads/main'
    runs-on: gitorange-standard-2
    steps:
      - run: echo deploying
`;

  it('parses the common syntax', () => {
    const wf = parseWorkflow(ci);
    expect(wf.name).toBe('CI');
    expect(wf.on.push?.branches).toEqual(['main', 'release/**']);
    expect(wf.on.pullRequest).toEqual({});
    expect(wf.env).toEqual({ NODE_ENV: 'test' });
    expect(wf.jobs.map((j) => j.key)).toEqual(['test', 'deploy']);
    expect(wf.jobs[0].matrix).toEqual({
      axes: { node: [20, 22] },
      include: [],
      exclude: [],
    });
    expect(wf.jobs[1].needs).toEqual(['test']);
  });

  it('plans matrix jobs with GitHub-style step names', () => {
    const jobs = planJobs(parseWorkflow(ci), { ref: 'refs/heads/main' });
    expect(jobs.map((j) => j.name)).toEqual([
      'test (20)',
      'test (22)',
      'deploy',
    ]);
    expect(jobs[0].steps.map((s) => s.name)).toEqual([
      'Set up job',
      'Run actions/checkout@v4',
      'Run actions/setup-node@v4',
      'Run npm ci',
      'Test',
      'Complete job',
    ]);
    expect(jobs[0].matrix).toEqual({ node: 20 });
  });

  it('accepts on as a string or a list', () => {
    const base =
      'jobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - run: "true"\n';
    expect(parseWorkflow(`on: push\n${base}`).on).toEqual({ push: {} });
    expect(parseWorkflow(`on: [push, pull_request]\n${base}`).on).toEqual({
      push: {},
      pullRequest: {},
    });
  });

  it.each([
    ['on: push\njobs: {}', /at least one job/],
    [
      'on: push\njobs:\n  a:\n    runs-on: ubuntu-latest\n    needs: b\n    steps:\n      - run: x',
      /unknown job 'b'/,
    ],
    [
      'on: push\njobs:\n  a:\n    runs-on: ubuntu-latest\n    needs: b\n    steps:\n      - run: x\n  b:\n    runs-on: ubuntu-latest\n    needs: a\n    steps:\n      - run: x',
      /dependency cycle/,
    ],
    [
      'on: push\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - run: x\n        uses: actions/checkout@v4',
      /exactly one of run or uses/,
    ],
    [
      'on: push\njobs:\n  a:\n    runs-on: ubuntu-latest\n    services:\n      db:\n        image: postgres\n    steps:\n      - run: x',
      /service containers/,
    ],
    ['on: push\njobs:\n  a: [', /Invalid YAML/],
  ])('rejects invalid files with a clear message (%#)', (text, msg) => {
    expect(() => parseWorkflow(text)).toThrow(WorkflowFileError);
    expect(() => parseWorkflow(text)).toThrow(msg);
  });

  it('refuses non-Linux runners and caps matrix size', () => {
    expect(instanceTypeFor('ubuntu-latest')).toBe('standard-2');
    expect(instanceTypeFor('standard-4')).toBe('standard-4');
    expect(() => instanceTypeFor('macos-latest')).toThrow(/Linux jobs only/);
    const big = parseWorkflow(
      'on: push\njobs:\n  a:\n    runs-on: ubuntu-latest\n    strategy:\n      matrix:\n        x: [1,2,3,4,5]\n        y: [1,2,3,4,5]\n    steps:\n      - run: x'
    );
    expect(() => planJobs(big, {})).toThrow(/expands to 25 jobs/);
  });
  it('evaluates runs-on expressions with the github and matrix contexts', () => {
    const wf = parseWorkflow(
      [
        'on: push',
        'jobs:',
        '  a:',
        "    runs-on: ${{ github.server_url == 'https://github.com' && 'ubuntu-latest' || 'gitorange-standard-4' }}",
        '    steps:',
        '      - run: x',
        '  b:',
        '    runs-on: ${{ matrix.size }}',
        '    strategy:',
        '      matrix:',
        '        size: [standard-1, standard-3]',
        '    steps:',
        '      - run: x',
      ].join('\n')
    );
    const here = planJobs(wf, { server_url: 'https://git.example.com' });
    expect(here.map((j) => j.runsOn)).toEqual([
      'gitorange-standard-4',
      'standard-1',
      'standard-3',
    ]);
    expect(here.map((j) => instanceTypeFor(j.runsOn))).toEqual([
      'standard-4',
      'standard-1',
      'standard-3',
    ]);
    const gh = planJobs(wf, { server_url: 'https://github.com' });
    expect(gh[0].runsOn).toBe('ubuntu-latest');
    const mac = parseWorkflow(
      "on: push\njobs:\n  a:\n    runs-on: ${{ 'macos-latest' }}\n    steps:\n      - run: x"
    );
    expect(() => planJobs(mac, {})).toThrow(/Linux jobs only/);
  });
});

describe('trigger filters', () => {
  it('matches GitHub glob patterns, last match wins', () => {
    expect(matchesPatterns('release/1.0', ['release/*'])).toBe(true);
    expect(matchesPatterns('release/1.0/hotfix', ['release/*'])).toBe(false);
    expect(matchesPatterns('release/1.0/hotfix', ['release/**'])).toBe(true);
    expect(matchesPatterns('docs/a.md', ['**.md'])).toBe(true);
    expect(
      matchesPatterns('release/beta', ['release/**', '!release/beta'])
    ).toBe(false);
  });

  it('filters pushes by branch, tag, and path', () => {
    const f = { branches: ['main'], paths: ['src/**'] };
    expect(pushMatches(f, 'refs/heads/main', ['src/a.ts'])).toBe(true);
    expect(pushMatches(f, 'refs/heads/main', ['README.md'])).toBe(false);
    expect(pushMatches(f, 'refs/heads/main', null)).toBe(true);
    expect(pushMatches(f, 'refs/heads/dev', ['src/a.ts'])).toBe(false);
    expect(pushMatches({ tags: ['v*'] }, 'refs/heads/main', null)).toBe(false);
    expect(pushMatches({ tags: ['v*'] }, 'refs/tags/v1.0', null)).toBe(true);
    expect(pushMatches({}, 'refs/tags/v1.0', null)).toBe(true);
    expect(
      pushMatches({ pathsIgnore: ['docs/**'] }, 'refs/heads/x', ['docs/a.md'])
    ).toBe(false);
  });

  it('filters pull requests by base branch', () => {
    expect(pullRequestMatches({ branches: ['main'] }, 'main', null)).toBe(true);
    expect(pullRequestMatches({ branches: ['main'] }, 'dev', null)).toBe(false);
  });
});

describe('runner command files', () => {
  it('parses NAME=value lines and heredocs', () => {
    expect(
      parseKeyValueFile('A=1\nB=x=y\nNOTES<<EOF\nline 1\nline 2\nEOF\nC=3\n')
    ).toEqual({ A: '1', B: 'x=y', NOTES: 'line 1\nline 2', C: '3' });
  });

  it('masks secrets in logs', () => {
    expect(mask('token art_secret123 done', ['art_secret123'])).toBe(
      'token *** done'
    );
  });
});

describe('matrix include and exclude', () => {
  const matrixOf = (yaml: string) => {
    const wf = parseWorkflow(
      `on: push\njobs:\n  t:\n    runs-on: ubuntu-latest\n    strategy:\n      matrix:\n${yaml
        .split('\n')
        .map((l) => `        ${l}`)
        .join('\n')}\n    steps:\n      - run: x`
    );
    return wf;
  };

  it('follows GitHub’s documented include example', () => {
    const wf = matrixOf(`fruit: [apple, pear]
animal: [cat, dog]
include:
  - color: green
  - color: pink
    animal: cat
  - fruit: apple
    shape: circle
  - fruit: banana
  - fruit: banana
    animal: cat`);
    expect(expandMatrix(wf.jobs[0].matrix!)).toEqual([
      { fruit: 'apple', animal: 'cat', color: 'pink', shape: 'circle' },
      { fruit: 'apple', animal: 'dog', color: 'green', shape: 'circle' },
      { fruit: 'pear', animal: 'cat', color: 'pink' },
      { fruit: 'pear', animal: 'dog', color: 'green' },
      { fruit: 'banana' },
      { fruit: 'banana', animal: 'cat' },
    ]);
    expect(planJobs(wf, {}).map((j) => j.name)).toEqual([
      't (apple, cat, pink, circle)',
      't (apple, dog, green, circle)',
      't (pear, cat, pink)',
      't (pear, dog, green)',
      't (banana)',
      't (banana, cat)',
    ]);
  });

  it('removes excluded combinations before adding includes, matching objects partially', () => {
    const wf = matrixOf(`os: [ubuntu-22.04, ubuntu-24.04]
node:
  - { version: 20, lts: true }
  - { version: 22, lts: true }
exclude:
  - os: ubuntu-22.04
    node: { version: 22 }
include:
  - os: ubuntu-22.04
    node: { version: 22, lts: true }
    experimental: true`);
    expect(expandMatrix(wf.jobs[0].matrix!)).toEqual([
      { os: 'ubuntu-22.04', node: { version: 20, lts: true } },
      { os: 'ubuntu-24.04', node: { version: 20, lts: true } },
      { os: 'ubuntu-24.04', node: { version: 22, lts: true } },
      {
        os: 'ubuntu-22.04',
        node: { version: 22, lts: true },
        experimental: true,
      },
    ]);
    expect(planJobs(wf, {})[0].name).toBe(
      't (ubuntu-22.04, {"version":20,"lts":true})'
    );
  });

  it('runs one job per include entry when the matrix has no lists', () => {
    const wf = matrixOf(`include:
  - target: web
  - target: worker
    size: standard-2`);
    expect(planJobs(wf, {}).map((j) => j.matrix)).toEqual([
      { target: 'web' },
      { target: 'worker', size: 'standard-2' },
    ]);
  });

  it.each([
    ['x: [1]\nexclude:\n  - os: linux', /'os' is not one of the matrix's keys/],
    ['x: [1]\nexclude: [ x ]', /must be a non-empty mapping/],
    ['x: []', /must be a non-empty list/],
    ['x: [1, ~]', /must have a value/],
    ['include: \${{ fromJSON(needs.a.outputs.m) }}', /not supported yet/],
  ])('rejects bad matrices (%#)', (yaml, msg) => {
    expect(() => matrixOf(yaml)).toThrow(msg);
  });

  it('refuses a matrix that exclude empties', () => {
    const wf = matrixOf('x: [1]\nexclude:\n  - x: 1');
    expect(() => planJobs(wf, {})).toThrow(/exclude leaves no jobs/);
  });
});

describe('workflow commands in logs', () => {
  it('masks add-mask values, keeps groups as headings and drops debug lines', () => {
    const out = workflowCommands(
      [
        '::add-mask::hunter22',
        '::group::Install',
        'npm ci',
        '::endgroup::',
        '::debug::noise',
        '::warning file=a.ts,line=1::Deprecated%0Asecond line',
        'password is hunter22',
        '::set-output name=x::y',
      ].join('\n')
    );
    expect(out.masks).toEqual(['hunter22']);
    expect(mask(out.text, out.masks)).toBe(
      [
        '▸ Install',
        'npm ci',
        'Warning: Deprecated\nsecond line',
        'password is ***',
        '::set-output name=x::y',
      ].join('\n')
    );
  });
});
