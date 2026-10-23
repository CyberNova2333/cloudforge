import {
  Link,
  useNavigate,
  useOutletContext,
  useSearchParams,
} from 'react-router-dom';
import type { RepoDetail } from '@/lib/uiApi';
import { t } from '@/lib/i18n';
import { parsePullsView, pullsHref, type PullsView } from '@/lib/pullsView';
import { PageHead } from '@/components/ui/PageHead';
import { Seg } from '@/components/ui/Seg';
import { PullBoard } from '@/components/PullBoard';
import { PullGraph } from '@/components/PullGraph';
import { PullList } from '@/components/PullList';

const VIEW_KEY = 'cloudforge.pulls.view';

/** The view a person last chose, so the page opens on it again. A convenience: never fails without storage. */
function storedView(): string | null {
  try {
    return localStorage.getItem(VIEW_KEY);
  } catch {
    return null;
  }
}

function rememberView(view: PullsView) {
  try {
    localStorage.setItem(VIEW_KEY, view);
  } catch {
    // Remembering the view is a convenience only.
  }
}

const VIEWS = [
  { value: 'board', label: t('Board') },
  { value: 'list', label: t('List') },
  { value: 'graph', label: t('Graph') },
] as const satisfies readonly { value: PullsView; label: string }[];

const count = (n: number) => t('{n} open', { n });

/**
 * Pull requests: a board by whose move it is (`?view=board`, the default), a list with filters and search
 * (`?view=list`, `?state=`, `?q=`, `?page=`) and the graph of how they are slated to land (`?view=graph`).
 */
export default function Pulls() {
  const repo = useOutletContext<RepoDetail>();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const base = `/${repo.fullName}`;
  const params = parsePullsView(search, storedView());
  const { view } = params;
  const open = repo.openPullCount;

  const lede =
    view === 'board'
      ? open
        ? t('{count}, sorted by who has to act next.', { count: count(open) })
        : t('Nothing is open. Merged pull requests are below.')
      : view === 'list'
        ? t(
            'Every pull request, open or closed. Filter them or search by number, title, person, branch or session.'
          )
        : t('How the open pull requests are slated to land, branch by branch.');

  return (
    <>
      <PageHead
        icon="pull"
        crumbs={[{ label: t('Pull requests') }]}
        title={t('Pull requests')}
        tab="pulls"
        lede={lede}
        actions={
          repo.permissions.write ? (
            <Link to={`${base}/compare`} className="btn primary">
              {t('New pull request')}
            </Link>
          ) : undefined
        }
      />
      <div className="pulls-bar">
        <Seg
          label={t('View')}
          options={VIEWS}
          value={view}
          onChange={(next) => {
            rememberView(next);
            navigate(pullsHref(base, { view: next }));
          }}
        />
      </div>
      {view === 'board' && <PullBoard repo={repo} />}
      {view === 'list' && <PullList repo={repo} params={params} />}
      {view === 'graph' && <PullGraph repo={repo} />}
    </>
  );
}
