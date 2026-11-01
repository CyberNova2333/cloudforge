// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { describe, expect, it } from 'vitest';
import {
  confirmingCancel,
  focusStep,
  isErrorLine,
  runLabel,
  runTone,
  stepLabel,
} from './runs';

describe('isErrorLine：识别错误行', () => {
  it('标记以 Error 或 ##[error] 开头的行', () => {
    expect(isErrorLine('Error: something broke')).toBe(true);
    expect(isErrorLine('##[error]Process completed with exit code 1')).toBe(
      true
    );
  });
  it('其余内容保持普通样式', () => {
    expect(isErrorLine('  Error in the middle')).toBe(false);
    expect(isErrorLine('error lowercase')).toBe(false);
    expect(isErrorLine('')).toBe(false);
  });
});

describe('focusStep：聚焦步骤', () => {
  const s = (
    number: number,
    status: 'queued' | 'in_progress' | 'completed',
    conclusion: 'success' | 'failure' | null = null
  ) => ({ number, status, conclusion });
  it('展开正在运行的步骤', () => {
    expect(
      focusStep([
        s(1, 'completed', 'success'),
        s(2, 'in_progress'),
        s(3, 'queued'),
      ])
    ).toBe(2);
  });
  it('否则展开首个失败步骤', () => {
    expect(
      focusStep([
        s(1, 'completed', 'success'),
        s(2, 'completed', 'failure'),
        s(3, 'completed', 'failure'),
      ])
    ).toBe(2);
  });
  it('正在运行的步骤优先于较早的失败步骤', () => {
    expect(focusStep([s(1, 'completed', 'failure'), s(2, 'in_progress')])).toBe(
      2
    );
  });
  it('无需关注时返回 null', () => {
    expect(focusStep([s(1, 'completed', 'success')])).toBeNull();
    expect(focusStep([])).toBeNull();
  });
});

describe('runTone：运行色调', () => {
  it('将运行、作业或步骤映射到标签色调', () => {
    expect(runTone('queued', null)).toBe('off');
    expect(runTone('in_progress', null)).toBe('info');
    expect(runTone('completed', 'success')).toBe('good');
    expect(runTone('completed', 'failure')).toBe('critical');
    expect(runTone('completed', 'cancelled')).toBe('off');
    expect(runTone('completed', 'skipped')).toBe('off');
    expect(runTone('completed', null)).toBe('off');
  });
});

describe('stepLabel：步骤标签', () => {
  it('与日志标题使用相同的步骤措辞', () => {
    expect(stepLabel('queued', null)).toBe('Waiting to start');
    expect(stepLabel('in_progress', null)).toBe('Running');
    expect(stepLabel('completed', 'failure')).toBe('Failed');
    expect(stepLabel('completed', 'success')).toBe('Passed');
    expect(stepLabel('completed', 'skipped')).toBe('Skipped');
    expect(stepLabel('completed', 'cancelled')).toBe('Cancelled');
  });
});

describe('runLabel：运行标签', () => {
  it('标签使用易懂文字', () => {
    expect(runLabel('queued', null)).toBe('Queued');
    expect(runLabel('in_progress', null)).toBe('In progress');
    expect(runLabel('completed', 'success')).toBe('Passed');
    expect(runLabel('completed', 'failure')).toBe('Failed');
    expect(runLabel('completed', 'cancelled')).toBe('Cancelled');
    expect(runLabel('completed', null)).toBe('Skipped');
  });
});

describe('confirmingCancel：取消确认', () => {
  it('仅在仍在运行的任务上点击取消后显示确认步骤', () => {
    expect(confirmingCancel(true, 'in_progress')).toBe(true);
    expect(confirmingCancel(true, 'queued')).toBe(true);
    expect(confirmingCancel(false, 'in_progress')).toBe(false);
  });
  it('运行完成后移除确认步骤，避免一次点击就取消已完成运行', () => {
    expect(confirmingCancel(true, 'completed')).toBe(false);
  });
});
