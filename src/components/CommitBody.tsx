// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSE).
import { Link } from 'react-router-dom';
import {
  coAuthors,
  type ParsedMessage,
  type Trailer,
} from '@/lib/commitMessage';
import { t, tx } from '@/lib/i18n';

// A finding's id, as a `Dismissed-Finding` trailer carries it: safe to put in a path.
const FINDING_ID = /^[A-Za-z0-9_-]+$/;

function TrailerValue({ trailer }: { trailer: Trailer }) {
  if (
    trailer.key.toLowerCase() === 'dismissed-finding' &&
    FINDING_ID.test(trailer.value)
  )
    return (
      <Link to={`/approvals/${trailer.value}`} title={t('Open the finding')}>
        {trailer.value}
      </Link>
    );
  return <>{trailer.value}</>;
}

/**
 * A commit's trailers (`Dismissed-Finding: …`, `Co-Authored-By: …`) as a quiet block of their own: they describe
 * the commit, they are not part of what its author wrote.
 */
export function CommitTrailers({ trailers }: { trailers: Trailer[] }) {
  if (!trailers.length) return null;
  return (
    <dl className="trailers" aria-label={t('Trailers')}>
      {trailers.map((tr, i) => (
        <div key={i}>
          <dt>{tr.key}</dt>
          <dd>
            <TrailerValue trailer={tr} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** "with Claude" after an author, from `Co-Authored-By` trailers; nothing without any. */
export function CoAuthored({ trailers }: { trailers: Trailer[] }) {
  const names = coAuthors(trailers).map((c) => c.name);
  if (!names.length) return null;
  return (
    <span className="color-fg-muted">
      {' '}
      {tx('with {names}', {
        names: <span className="co-authors">{names.join(', ')}</span>,
      })}
    </span>
  );
}

/** The rest of a commit message under its subject: the prose, then the trailers. */
export function CommitBody({ message }: { message: ParsedMessage }) {
  return (
    <>
      {message.body && <pre className="commit-body">{message.body}</pre>}
      <CommitTrailers trailers={message.trailers} />
    </>
  );
}
