import { Link, useOutletContext } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { TagIcon } from '@primer/octicons-react';
import { api, qk, type RepoDetail } from '@/lib/uiApi';
import { shortSha } from '@/lib/format';
import { t } from '@/lib/i18n';
import { QueryError, RowsSkeleton } from '@/components/actions/states';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHead } from '@/components/ui/PageHead';

/**
 * Tags (`/:owner/:repo/tags`): every git tag, newest name first, with the commit it points at and the release it
 * is. Tags pushed with git are listed too; only tags CloudForge cut have a release.
 */
export default function RepoTags() {
  const repo = useOutletContext<RepoDetail>();
  const o = repo.owner.username;
  const base = `/${repo.fullName}`;
  const q = useQuery({
    queryKey: qk.tags(o, repo.name),
    queryFn: () => api.tags(o, repo.name),
  });
  const tags = q.data;
  return (
    <>
      <PageHead
        icon="tag"
        crumbs={[
          { label: t('Releases'), to: `${base}/releases` },
          { label: t('Tags') },
        ]}
        title={t('Tags')}
        tab="releases"
        lede={t(
          'Every tag in the repository. A tag pushed with git is listed too, but only a release CloudForge cut counts as a version.'
        )}
        actions={
          <Link to={`${base}/releases`} className="btn">
            {t('Releases')}
          </Link>
        }
      />
      {q.isError && !tags ? (
        <div className="panel">
          <QueryError
            error={q.error}
            onRetry={() => void q.refetch()}
            title={t('The tags did not load')}
          />
        </div>
      ) : !tags ? (
        <RowsSkeleton rows={4} />
      ) : tags.length === 0 ? (
        <div className="panel">
          <EmptyState
            picture={<TagIcon size={24} />}
            title={t('No tags yet')}
            body={t(
              'Cutting a release tags the default branch; tags pushed with git show up here too.'
            )}
          />
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table rel-tags">
            <caption className="sr">{t('Tags')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('Tag')}</th>
                <th scope="col">{t('Commit')}</th>
                <th scope="col">{t('Release')}</th>
              </tr>
            </thead>
            <tbody>
              {tags.map((tag) => (
                <tr key={tag.name}>
                  <td>
                    <span className="rel-tag-name mono">
                      <TagIcon size={14} />
                      {tag.name}
                    </span>
                  </td>
                  <td>
                    <Link to={`${base}/commit/${tag.sha}`} className="mono">
                      {shortSha(tag.sha)}
                    </Link>
                  </td>
                  <td>
                    {tag.release ? (
                      <Link
                        to={`${base}/releases/${encodeURIComponent(tag.release)}`}
                      >
                        {tag.release}
                      </Link>
                    ) : (
                      <span className="muted small">
                        {t('Pushed with git')}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
