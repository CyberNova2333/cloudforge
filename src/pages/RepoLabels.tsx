import { useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { TagIcon } from '@primer/octicons-react';
import { api, qk, type Label, type RepoDetail } from '@/lib/uiApi';
import { errorMessage } from '@/lib/api';
import { t, tn } from '@/lib/i18n';
import { issuesHref, LABEL_SWATCHES, normalizeColor } from '@/lib/issuesView';
import { PageHead } from '@/components/ui/PageHead';
import { EmptyState } from '@/components/ui/EmptyState';
import { PendingButton } from '@/components/ui/PendingButton';
import { InlineConfirm } from '@/components/InlineConfirm';
import { PanelError } from '@/components/approvals/Panels';
import { QueryError, RowsSkeleton } from '@/components/actions/states';
import { LabelChip } from '@/components/issue/IssueParts';

type Draft = { name: string; color: string; description: string };

/** Name, colour (with a few to pick from) and description of a label, previewed as it will look. */
function LabelForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: Draft;
  submitLabel: string;
  onSubmit: (d: Draft) => Promise<unknown>;
  onCancel?: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const color = normalizeColor(draft.color);
  const set = (k: keyof Draft) => (e: { target: { value: string } }) =>
    setDraft({ ...draft, [k]: e.target.value });
  return (
    <form
      className="label-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!draft.name.trim() || !color) return;
        setBusy(true);
        setError(null);
        onSubmit({ ...draft, name: draft.name.trim(), color })
          .then(() => setDraft(initial))
          .catch((err) => setError(errorMessage(err)))
          .finally(() => setBusy(false));
      }}
    >
      <div className="label-form-preview">
        <LabelChip
          label={{
            name: draft.name.trim() || t('Label preview'),
            color: color ?? 'ededed',
          }}
        />
      </div>
      <div className="label-form-fields">
        <label className="fld">
          <span className="lbl">{t('Label name')}</span>
          <input
            className="form-control"
            value={draft.name}
            maxLength={50}
            onChange={set('name')}
          />
        </label>
        <label className="fld">
          <span className="lbl">{t('Description')}</span>
          <input
            className="form-control"
            value={draft.description}
            maxLength={100}
            onChange={set('description')}
          />
        </label>
        <label className="fld">
          <span className="lbl">{t('Color')}</span>
          <input
            className="form-control mono"
            value={draft.color}
            maxLength={7}
            onChange={set('color')}
            aria-invalid={!color}
          />
        </label>
        <div
          className="label-swatches"
          role="group"
          aria-label={t('Pick a color')}
        >
          {LABEL_SWATCHES.map((c) => (
            <button
              key={c}
              type="button"
              className="label-swatch"
              aria-label={`#${c}`}
              aria-pressed={color === c}
              style={{ background: `#${c}` }}
              onClick={() => setDraft({ ...draft, color: c })}
            />
          ))}
        </div>
      </div>
      <PanelError error={error} />
      <div className="issue-edit-actions">
        {onCancel && (
          <button type="button" className="btn" onClick={onCancel}>
            {t('Cancel')}
          </button>
        )}
        <PendingButton
          type="submit"
          className="primary"
          pending={busy}
          disabled={!draft.name.trim() || !color}
        >
          {submitLabel}
        </PendingButton>
      </div>
    </form>
  );
}

function LabelRow({
  label,
  repo,
  canManage,
  refresh,
}: {
  label: Label & { openIssues: number };
  repo: RepoDetail;
  canManage: boolean;
  refresh: () => Promise<unknown>;
}) {
  const o = repo.owner.username;
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (editing)
    return (
      <li className="label-row editing">
        <LabelForm
          initial={label}
          submitLabel={t('Save')}
          onCancel={() => setEditing(false)}
          onSubmit={async (d) => {
            await api.updateLabel(o, repo.name, label.id, d);
            await refresh();
            setEditing(false);
          }}
        />
      </li>
    );
  return (
    <li className="label-row">
      <LabelChip label={label} />
      <span className="label-row-desc muted small">{label.description}</span>
      <Link
        to={issuesHref(`/${repo.fullName}`, { label: label.name })}
        className="small muted"
      >
        {tn(label.openIssues, '{n} open issue', '{n} open issues')}
      </Link>
      {canManage && (
        <span className="label-row-tools">
          <button
            type="button"
            className="btn-link small"
            onClick={() => setEditing(true)}
          >
            {t('Edit')}
          </button>
          <InlineConfirm
            label={t('Delete')}
            confirmLabel={t('Delete label')}
            pendingLabel={t('Deleting…')}
            accessibleName={t('Delete label {name}', { name: label.name })}
            pending={deleting}
            error={error}
            onConfirm={() => {
              setDeleting(true);
              setError(null);
              api
                .deleteLabel(o, repo.name, label.id)
                .then(refresh)
                .catch((e) => setError(errorMessage(e)))
                .finally(() => setDeleting(false));
            }}
          />
        </span>
      )}
    </li>
  );
}

/** A repository's labels; people with push access create, edit and delete them. */
export default function RepoLabels() {
  const repo = useOutletContext<RepoDetail>();
  const o = repo.owner.username;
  const base = `/${repo.fullName}`;
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: qk.labels(o, repo.name),
    queryFn: () => api.labels(o, repo.name),
  });
  const canManage = repo.permissions.write;
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: qk.labels(o, repo.name) }),
      queryClient.invalidateQueries({
        queryKey: ['repo', o, repo.name, 'issues'],
      }),
    ]);
  const [adding, setAdding] = useState(false);

  return (
    <>
      <PageHead
        icon="tag"
        crumbs={[
          { label: t('Issues'), to: `${base}/issues` },
          { label: t('Labels') },
        ]}
        title={t('Labels')}
        tab="issues"
        lede={t('Labels sort issues by kind, area or priority.')}
        actions={
          canManage && !adding ? (
            <button
              type="button"
              className="btn primary"
              onClick={() => setAdding(true)}
            >
              {t('New label')}
            </button>
          ) : undefined
        }
      />
      {adding && (
        <div className="panel">
          <LabelForm
            initial={{ name: '', color: LABEL_SWATCHES[6], description: '' }}
            submitLabel={t('Create label')}
            onCancel={() => setAdding(false)}
            onSubmit={async (d) => {
              await api.createLabel(o, repo.name, d);
              await refresh();
              setAdding(false);
            }}
          />
        </div>
      )}
      {query.isError && !query.data ? (
        <div className="panel">
          <QueryError
            error={query.error}
            onRetry={() => void query.refetch()}
            title={t('Labels did not load')}
          />
        </div>
      ) : !query.data ? (
        <RowsSkeleton />
      ) : !query.data.length ? (
        <div className="panel">
          <EmptyState
            picture={<TagIcon size={24} />}
            title={t('No labels yet')}
            body={
              canManage
                ? t('Create a few, such as bug, docs or good first issue.')
                : undefined
            }
          />
        </div>
      ) : (
        <ul className="label-rows panel">
          {query.data.map((l) => (
            <LabelRow
              key={l.id}
              label={l}
              repo={repo}
              canManage={canManage}
              refresh={refresh}
            />
          ))}
        </ul>
      )}
    </>
  );
}
