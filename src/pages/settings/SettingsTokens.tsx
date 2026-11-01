// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyIcon } from '@primer/octicons-react';
import { api, qk, type Token } from '@/lib/api/uiApi';
import { errorMessage } from '@/lib/api/api';
import { timeAgo } from '@/lib/utils/format';
import { t, tx } from '@/lib/i18n/i18n';
import { PageHead } from '@/components/ui/PageHead';
import { EmptyState } from '@/components/ui/EmptyState';
import { PendingButton } from '@/components/ui/PendingButton';
import { CopyButton } from '@/components/ui/CopyButton';
import { InlineConfirm } from '@/components/ui/InlineConfirm';
import { LoadError } from '@/components/ui/Notice';
import { RowsSkeleton, SettingsFrame } from '@/components/shell/SetFrame';

/** "Expires Nov 4, 2026", "Expired" or "No expiration". */
function expiryText(token: Token): string {
  if (!token.expiresAt) return t('No expiration');
  const at = new Date(token.expiresAt);
  return at < new Date()
    ? t('Expired')
    : t('Expires {date}', { date: at.toLocaleDateString() });
}

function TokenRow({ token }: { token: Token }) {
  const qc = useQueryClient();
  const remove = useMutation({
    mutationFn: () => api.deleteToken(token.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.tokens }),
  });
  return (
    <li>
      <KeyIcon className="ic" />
      <div className="grow">
        <b>{token.name}</b>
        <span className="muted small">
          {token.lastUsedAt
            ? t('Last used {when}', { when: timeAgo(token.lastUsedAt) })
            : t('Never used')}
          {' · '}
          {expiryText(token)}
          {' · '}
          {token.scope === 'read' ? t('Read only') : t('Read and write')}
        </span>
      </div>
      <div className="ctl">
        <InlineConfirm
          label={t('Delete')}
          confirmLabel={t('Delete token')}
          pendingLabel={t('Deleting…')}
          accessibleName={t('Delete token {name}', { name: token.name })}
          pending={remove.isPending}
          error={remove.isError ? errorMessage(remove.error) : null}
          onConfirm={() => remove.mutate()}
        />
      </div>
    </li>
  );
}

/** Settings → Access tokens: generate a personal access token and delete the ones you no longer need. */
export default function SettingsTokens() {
  const qc = useQueryClient();
  const tokens = useQuery({ queryKey: qk.tokens, queryFn: api.tokens });
  const [name, setName] = useState('');
  const [days, setDays] = useState('30');
  const [scope, setScope] = useState<Token['scope']>('write');
  const [created, setCreated] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () =>
      api.createToken({
        name: name.trim(),
        expiresInDays: days === 'never' ? null : Number(days),
        scope,
      }),
    onSuccess: (r) => {
      setCreated(r.plaintext);
      setName('');
      return qc.invalidateQueries({ queryKey: qk.tokens });
    },
  });

  return (
    <>
      <PageHead
        icon="key"
        crumbs={[
          { label: t('Settings'), to: '/settings/tokens' },
          { label: t('Personal access tokens') },
        ]}
        title={t('Personal access tokens')}
        lede={t(
          'Use a token for git over HTTPS, Git LFS, or the commit status API (Authorization: Bearer). A read-only token can read but cannot push or report statuses.'
        )}
      />
      <SettingsFrame>
        <section className="panel" aria-label={t('Your tokens')}>
          <div className="pad">
            <h2>{t('Your tokens')}</h2>
            <p className="small muted">
              {t(
                'Tokens you have generated. A deleted token stops working at once.'
              )}
            </p>
          </div>
          {tokens.isPending ? (
            <div className="pad">
              <RowsSkeleton rows={2} />
            </div>
          ) : tokens.isError ? (
            <div className="pad">
              <LoadError
                what={t('your tokens')}
                error={tokens.error}
                onRetry={() => tokens.refetch()}
              />
            </div>
          ) : tokens.data.length === 0 ? (
            <EmptyState
              picture={<KeyIcon size={20} />}
              title={t('You have no personal access tokens.')}
              body={t('Generate one below to use git over HTTPS.')}
            />
          ) : (
            <ul className="rowlist">
              {tokens.data.map((token) => (
                <TokenRow key={token.id} token={token} />
              ))}
            </ul>
          )}

          {created && (
            <div className="newtoken" role="status">
              <p>
                {tx("{bold} You won't be able to see it again.", {
                  bold: <b>{t('Copy your new token now.')}</b>,
                })}
              </p>
              <div className="copyrow">
                <input
                  className="form-control"
                  readOnly
                  value={created}
                  aria-label={t('Your new token')}
                  onFocus={(e) => e.currentTarget.select()}
                />
                <CopyButton
                  text={created}
                  className="btn small"
                  label={t('Copy the token')}
                />
              </div>
            </div>
          )}

          <form
            className="formpad"
            onSubmit={(e) => {
              e.preventDefault();
              setCreated(null);
              create.mutate();
            }}
          >
            <h3 className="formtitle">{t('Generate a new token')}</h3>
            <div className="frow">
              <div className="fld grow2">
                <label htmlFor="tok-name">{t('Note')}</label>
                <input
                  id="tok-name"
                  className="form-control"
                  required
                  placeholder={t('What is this token for?')}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="fld">
                <label htmlFor="tok-exp">{t('Expiration')}</label>
                <select
                  id="tok-exp"
                  className="form-select"
                  value={days}
                  onChange={(e) => setDays(e.target.value)}
                >
                  <option value="7">{t('7 days')}</option>
                  <option value="30">{t('30 days')}</option>
                  <option value="90">{t('90 days')}</option>
                  <option value="366">{t('1 year')}</option>
                  <option value="never">{t('No expiration')}</option>
                </select>
              </div>
              <div className="fld">
                <label htmlFor="tok-scope">{t('Access')}</label>
                <select
                  id="tok-scope"
                  className="form-select"
                  value={scope}
                  onChange={(e) => setScope(e.target.value as Token['scope'])}
                >
                  <option value="write">{t('Read and write')}</option>
                  <option value="read">{t('Read only')}</option>
                </select>
              </div>
              <PendingButton
                type="submit"
                className="primary"
                pending={create.isPending}
                pendingLabel={t('Generating…')}
                error={create.isError ? errorMessage(create.error) : null}
              >
                {t('Generate token')}
              </PendingButton>
            </div>
          </form>
        </section>
      </SettingsFrame>
    </>
  );
}
