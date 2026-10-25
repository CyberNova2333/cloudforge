import { expect, it } from 'vitest';
import { checkCounts, checkTarget } from './commitChecks';
import type { CommitRuns } from './uiApi';

it('counts external-only commits and keeps errors and pending distinct', () => {
  expect(
    checkCounts({
      state: 'failure',
      runs: [],
      statuses: ['success', 'failure', 'error', 'pending'].map((state) => ({
        state,
        context: state,
        description: null,
        targetUrl: null,
        createdAt: '',
      })) as NonNullable<CommitRuns['statuses']>,
    })
  ).toEqual({ failed: 2, pending: 1, passed: 1, total: 4 });
  expect(checkCounts({ state: null, runs: [] }).total).toBe(0);
});

it('counts Actions alongside external contexts', () => {
  const runs = [
    { status: 'completed', conclusion: 'cancelled' },
    { status: 'queued', conclusion: null },
    { status: 'completed', conclusion: 'success' },
  ] as CommitRuns['runs'];
  expect(
    checkCounts({
      state: 'failure',
      runs,
      statuses: [
        {
          state: 'success',
          context: 'external',
          description: null,
          targetUrl: null,
          createdAt: '',
        },
      ],
    })
  ).toEqual({ failed: 1, pending: 1, passed: 2, total: 4 });
});

it('does not turn unsafe persisted target URLs into clickable links', () => {
  for (const url of [
    'javascript:alert(1)',
    'data:text/html,hi',
    '//evil.test',
    'https://user:pass@ci.test/',
    'not a url',
  ])
    expect(checkTarget(url)).toBeNull();
  expect(checkTarget('https://ci.example/check/1')).toBe(
    'https://ci.example/check/1'
  );
});
