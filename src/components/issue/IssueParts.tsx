// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of CloudForge and is licensed under GNU AGPLv3 with Additional Terms (see LICENSE and LICENSE-ADDITIONAL_TERMS-zh-CN.md; ref: LICENSE-ADDITIONAL_TERMS-en.md).
import {
  IssueClosedIcon,
  IssueOpenedIcon,
  SkipIcon,
} from '@primer/octicons-react';
import { labelInk, normalizeColor } from '@/lib/issues/issuesView';
import { t } from '@/lib/i18n/i18n';
import type { Issue, Label } from '@/lib/api/uiApi';

/** A label in its own colour, with text that reads on it. */
export function LabelChip({
  label,
  title,
}: {
  label: Pick<Label, 'name' | 'color'> & { description?: string };
  title?: string;
}) {
  const color = normalizeColor(label.color) ?? 'ededed';
  return (
    <span
      className="label-chip"
      title={title ?? (label.description || undefined)}
      style={{ background: `#${color}`, color: labelInk(color) }}
    >
      {label.name}
    </span>
  );
}

/** Open, closed as completed, or closed as not planned. */
export function IssueStateIcon({
  issue,
  size = 16,
}: {
  issue: Pick<Issue, 'state' | 'stateReason'>;
  size?: number;
}) {
  if (issue.state === 'open')
    return (
      <span className="issue-icon open" title={t('Open')}>
        <IssueOpenedIcon size={size} />
      </span>
    );
  if (issue.stateReason === 'not_planned')
    return (
      <span
        className="issue-icon not-planned"
        title={t('Closed as not planned')}
      >
        <SkipIcon size={size} />
      </span>
    );
  return (
    <span className="issue-icon done" title={t('Closed as completed')}>
      <IssueClosedIcon size={size} />
    </span>
  );
}

/** The state as a pill, for the issue's own page. */
export function IssueStatePill({
  issue,
}: {
  issue: Pick<Issue, 'state' | 'stateReason'>;
}) {
  const tone =
    issue.state === 'open'
      ? 'open'
      : issue.stateReason === 'not_planned'
        ? 'not-planned'
        : 'done';
  return (
    <span className={`issue-pill ${tone}`}>
      <IssueStateIcon issue={issue} size={14} />
      {issue.state === 'open'
        ? t('Open')
        : issue.stateReason === 'not_planned'
          ? t('Not planned')
          : t('Closed')}
    </span>
  );
}
