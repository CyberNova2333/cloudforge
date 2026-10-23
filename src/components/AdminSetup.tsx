// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSE).
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  AlertFillIcon,
  CheckCircleFillIcon,
  ChecklistIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  LinkExternalIcon,
  SyncIcon,
  XCircleFillIcon,
} from '@primer/octicons-react';
import { errorMessage } from '@/lib/api';
import { timeAgo } from '@/lib/format';
import { t, tn, tServer } from '@/lib/i18n';
import {
  testAiGateway,
  useSetupChecks,
  type SetupCheck,
  type SetupStatus,
} from '@/lib/setupChecks';
import { Chip } from '@/components/ui/Chip';
import { Section } from '@/components/ui/Section';
import { PendingButton } from '@/components/ui/PendingButton';
import { LoadError, Notice } from '@/components/Notice';
import { RowsSkeleton } from '@/components/SetFrame';
import { CopyButton } from './CopyButton';

function StatusIcon({ status }: { status: SetupStatus }) {
  if (status === 'error')
    return <XCircleFillIcon className="st bad" aria-label={t('Error')} />;
  if (status === 'warning')
    return <AlertFillIcon className="st warn" aria-label={t('Warning')} />;
  return <CheckCircleFillIcon className="st ok" aria-label={t('OK')} />;
}

function AiGatewayTest() {
  const test = useMutation({ mutationFn: testAiGateway });
  return (
    <div className="gw-test">
      <div className="gw-row">
        <PendingButton
          className="small"
          pending={test.isPending}
          pendingLabel={t('Testing…')}
          onClick={() => test.mutate()}
        >
          {t('Test')}
        </PendingButton>
        <span className="small muted">
          {t(
            'Sends one tiny Workers AI request (a few tokens) through the gateway.'
          )}
        </span>
      </div>
      {test.data && (
        <Notice
          tone={
            test.data.ok && (test.data.logged || !test.data.gateway)
              ? 'ok'
              : 'warn'
          }
        >
          {tServer(test.data.detail)}
        </Notice>
      )}
      {test.error && <Notice tone="bad">{errorMessage(test.error)}</Notice>}
    </div>
  );
}

function CheckRow({ check }: { check: SetupCheck }) {
  return (
    <li className="check">
      <StatusIcon status={check.status} />
      <div className="check-body">
        <div className="check-title">
          <b className="mono">{tServer(check.title)}</b>
          <Chip tone="off">{tServer(check.category)}</Chip>
        </div>
        <p className="small muted">{tServer(check.detail)}</p>
        {check.fix.length > 0 && check.status !== 'ok' && (
          <div className="howfix">
            <b className="small">{t('How to fix')}</b>
            <ol className="small">
              {check.fix.map((s, i) => (
                <li key={i}>
                  {tServer(s.text)}
                  {s.link && (
                    <>
                      {' '}
                      <a href={s.link} target="_blank" rel="noreferrer">
                        {t('Open dashboard')} <LinkExternalIcon size={12} />
                      </a>
                    </>
                  )}
                  {s.code && (
                    <div className="codebox">
                      <pre className="mono">{s.code}</pre>
                      <CopyButton
                        text={s.code}
                        className="btn small quiet"
                        label={t('Copy command')}
                      />
                    </div>
                  )}
                </li>
              ))}
            </ol>
          </div>
        )}
        {check.status === 'ok' && check.fix.some((s) => s.link) && (
          <p className="small">
            {check.fix.map((s, i) =>
              s.link ? (
                <a key={i} href={s.link} target="_blank" rel="noreferrer">
                  {tServer(s.text).replace(/[:：]$/, '')}{' '}
                  <LinkExternalIcon size={12} />
                </a>
              ) : null
            )}
          </p>
        )}
        {check.id === 'ai-gateway' && <AiGatewayTest />}
      </div>
    </li>
  );
}

/** Site admin → Setup checks: misconfigured secrets, bindings, and variables, with steps to fix. */
export function AdminSetup() {
  const setup = useSetupChecks();
  const [showOk, setShowOk] = useState(false);
  const checks = setup.data?.checks ?? [];
  const problems = checks.filter((c) => c.status !== 'ok');
  const ok = checks.filter((c) => c.status === 'ok');
  const counts = setup.data?.counts;
  return (
    <div id="setup">
      <Section
        title={
          <>
            <ChecklistIcon size={16} /> {t('Setup checks')}
          </>
        }
        actions={
          <button
            type="button"
            className="btn small"
            disabled={setup.isFetching}
            onClick={() => setup.refetch()}
          >
            <SyncIcon size={14} />
            {setup.isFetching ? t('Checking…') : t('Re-check')}
          </button>
        }
      >
        <p className="small muted">
          {t(
            "This deployment's secrets, bindings, and variables. Secret values are never shown; only whether they're set."
          )}
        </p>
        {setup.isPending ? (
          <RowsSkeleton rows={3} />
        ) : setup.error ? (
          <LoadError
            what={t('the setup checks')}
            error={setup.error}
            onRetry={() => setup.refetch()}
          />
        ) : (
          <>
            <Notice
              tone={counts!.error ? 'bad' : counts!.warning ? 'warn' : 'ok'}
            >
              <b>
                {counts!.error
                  ? tn(counts!.error, '{n} error to fix', '{n} errors to fix')
                  : counts!.warning
                    ? t('No errors; some features are off or misconfigured')
                    : t('Everything is set up')}
              </b>
              <span className="muted small block">
                {tn(counts!.error, '{n} error', '{n} errors')} ·{' '}
                {tn(counts!.warning, '{n} warning', '{n} warnings')} ·{' '}
                {t('{n} OK', { n: counts!.ok })} ·{' '}
                {t('checked {when}', {
                  when: timeAgo(setup.data!.checkedAt),
                })}
              </span>
            </Notice>
            {problems.length > 0 && (
              <div className="panel">
                <ul className="rowlist">
                  {problems.map((c) => (
                    <CheckRow key={c.id} check={c} />
                  ))}
                </ul>
              </div>
            )}
            <div className="panel">
              <button
                type="button"
                className="fold"
                aria-expanded={showOk}
                onClick={() => setShowOk(!showOk)}
              >
                <CheckCircleFillIcon className="st ok" />
                <b className="grow">
                  {tn(ok.length, '{n} check passed', '{n} checks passed')}
                </b>
                <span className="small muted">
                  {showOk ? t('Hide') : t('Show')}
                </span>
                {showOk ? <ChevronDownIcon /> : <ChevronRightIcon />}
              </button>
              {showOk && (
                <ul className="rowlist">
                  {ok.map((c) => (
                    <CheckRow key={c.id} check={c} />
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </Section>
    </div>
  );
}
