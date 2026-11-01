// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { GraphIcon, SyncIcon } from '@primer/octicons-react';
import { api, qk, type UsageLine, type UsageReport } from '@/lib/api/uiApi';
import { errorMessage } from '@/lib/api/api';
import { timeAgo } from '@/lib/utils/format';
import { t, tx } from '@/lib/i18n/i18n';
import { PageHead } from '@/components/ui/PageHead';
import { Chip } from '@/components/ui/Chip';
import { Section } from '@/components/ui/Section';
import { PendingButton } from '@/components/ui/PendingButton';
import { LoadError, Notice } from '@/components/ui/Notice';
import { AdminFrame, RowsSkeleton } from '@/components/shell/SetFrame';

const thisMonth = () => new Date().toISOString().slice(0, 7);

/** Dollars, with more precision for small amounts. */
export function usd(n: number) {
  if (n === 0) return '$0.00';
  if (Math.abs(n) < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
const qty = (n: number) =>
  n.toLocaleString('en-US', { maximumFractionDigits: n < 10 ? 3 : 0 });

const SOURCE_LABEL: Record<UsageLine['source'], string> = {
  cloudflare: 'Cloudflare analytics',
  cloudforge: 'Recorded by CloudForge',
  estimate: 'Estimate',
};

function Card({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="stat">
      <span>{label}</span>
      <b>{value}</b>
      <span>{detail}</span>
    </div>
  );
}

/** Estimated CloudForge cost per day, one bar per day (hover a bar for its value). */
function DailyChart({ report }: { report: UsageReport }) {
  const byDay = new Map(
    report.daily.map((d) => [
      d.date,
      Object.values(d.costs).reduce((n, c) => n + c, 0),
    ])
  );
  const days: string[] = [];
  for (let i = 0; i < report.daysInMonth; i++) {
    const d = new Date(`${report.from}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + i);
    days.push(d.toISOString().slice(0, 10));
  }
  const max = Math.max(0, ...byDay.values());
  const W = 720;
  const H = 140;
  const gap = 2;
  const bw = W / days.length - gap;
  return (
    <figure className="daily">
      <svg
        viewBox={`0 0 ${W} ${H + 18}`}
        width="100%"
        role="img"
        aria-label={t('Estimated cost per day')}
      >
        <line x1={0} x2={W} y1={H} y2={H} className="axis" />
        {days.map((d, i) => {
          const v = byDay.get(d) ?? 0;
          const h = max > 0 ? Math.max(v > 0 ? 2 : 0, (v / max) * (H - 4)) : 0;
          const x = i * (bw + gap);
          return (
            <g key={d}>
              <rect x={x} y={0} width={bw + gap} height={H} fill="transparent">
                <title>{`${d}: ${usd(v)}`}</title>
              </rect>
              {h > 0 && (
                <rect
                  x={x}
                  y={H - h}
                  width={bw}
                  height={h}
                  rx={Math.min(4, bw / 2)}
                  className="bar"
                  pointerEvents="none"
                />
              )}
              {(i === 0 || (i + 1) % 7 === 0) && (
                <text
                  x={x + bw / 2}
                  y={H + 14}
                  textAnchor="middle"
                  fontSize={10}
                  className="tick"
                >
                  {Number(d.slice(8))}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <figcaption className="small muted">
        {t(
          'Highest day: {amount}. Days without a bar have no recorded cost yet.',
          { amount: usd(max) }
        )}
      </figcaption>
    </figure>
  );
}

function StatusLabel({ line }: { line: UsageLine }) {
  if (line.status === 'measured')
    return <Chip tone="off">{t(SOURCE_LABEL[line.source])}</Chip>;
  return (
    <Chip tone="warn">
      {line.status === 'not-configured'
        ? t('Not configured')
        : t('Unavailable')}
    </Chip>
  );
}

function LinesTable({ lines }: { lines: UsageLine[] }) {
  const products = [...new Set(lines.map((l) => l.productLabel))];
  return (
    <div className="table-wrap">
      <table className="table usage">
        <thead>
          <tr>
            <th>{t('Metric')}</th>
            <th className="r">{t('CloudForge usage')}</th>
            <th>{t('Included (whole account)')}</th>
            <th className="r">{t('List price')}</th>
            <th className="r">{t('With allowance')}</th>
            <th className="r">{t('Projected')}</th>
          </tr>
        </thead>
        {products.map((p) => (
          <tbody key={p}>
            <tr className="group">
              <th colSpan={6}>{p}</th>
            </tr>
            {lines
              .filter((l) => l.productLabel === p)
              .map((l) => (
                <tr key={l.metric}>
                  <td className="metric">
                    <div>{l.label}</div>
                    <div className="note">
                      <StatusLabel line={l} />
                    </div>
                    {l.reason && (
                      <div className="note attention">{l.reason}</div>
                    )}
                    {l.note && <div className="note muted">{l.note}</div>}
                    {l.billedFrom && (
                      <div className="note muted">
                        {t('Cloudflare bills this from {source}.', {
                          source: l.billedFrom,
                        })}
                      </div>
                    )}
                    {l.resources.length > 1 && (
                      <div className="note muted">
                        {l.resources
                          .map((r) => `${r.resource}: ${qty(r.quantity)}`)
                          .join(' · ')}
                      </div>
                    )}
                  </td>
                  <td className="r mono">
                    {l.status === 'measured'
                      ? `${qty(l.quantity)} ${l.unit}`
                      : '—'}
                  </td>
                  <td className="muted">{l.includedLabel}</td>
                  <td className="r mono">{usd(l.listCost)}</td>
                  <td className="r mono">{usd(l.dedicatedCost)}</td>
                  <td className="r mono">{usd(l.projectedListCost)}</td>
                </tr>
              ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}

function Breakdown({
  title,
  rows,
  empty,
}: {
  title: string;
  rows: { key: string; detail: string; cost: number }[];
  empty: string;
}) {
  return (
    <div className="panel">
      <div className="pad">
        <h3 className="group-title">{title}</h3>
      </div>
      {rows.length === 0 ? (
        <p className="pad topline small muted">{empty}</p>
      ) : (
        <ul className="rowlist">
          {rows.map((r) => (
            <li key={r.key} className="split">
              <div className="grow">
                <span className="wrap">{r.key}</span>
                <span className="small muted">{r.detail}</span>
              </div>
              <span className="mono">{usd(r.cost)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Site admin → Usage and cost: what this deployment uses on Cloudflare, and what that would cost. */
export default function AdminUsage() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const month = params.get('month') || thisMonth();
  const report = useQuery({
    queryKey: qk.usage(month),
    queryFn: () => api.usage(month),
    placeholderData: keepPreviousData,
  });
  const [syncMsg, setSyncMsg] = useState<{
    kind: 'ok' | 'bad';
    text: string;
  } | null>(null);
  const sync = useMutation({
    mutationFn: api.syncUsage,
    onSuccess: (r) => {
      const failed = Object.values(r.errors).some((e) =>
        Object.keys(e).some((k) => !k.endsWith(':unconfigured'))
      );
      setSyncMsg({
        kind: 'ok',
        text: failed
          ? t('Synced {n} days; some metrics were unavailable (see below).', {
              n: r.days.length,
            })
          : t('Synced {n} days.', { n: r.days.length }),
      });
      qc.invalidateQueries({ queryKey: ['usage'] });
    },
    onError: (e) => setSyncMsg({ kind: 'bad', text: errorMessage(e) }),
  });
  const r = report.data;

  return (
    <>
      <PageHead
        icon="shield"
        crumbs={[
          { label: t('Site admin'), to: '/admin' },
          { label: t('Usage and cost') },
        ]}
        title={t('Usage and cost')}
        lede={
          <>
            {t(
              'What this CloudForge deployment uses on Cloudflare, and what it would cost. Estimates from Cloudflare analytics (filtered to this deployment’s own Worker, Durable Objects, Workflows, D1 database, R2 buckets, and Artifacts namespace) and from CloudForge’s own records. Not an invoice: Cloudflare’s Billing → Billable Usage page has the exact account total.'
            )}
            {r?.lastSync?.completedAt && (
              <>
                {' '}
                {t('Cloudflare analytics last synced {when}.', {
                  when: timeAgo(r.lastSync.completedAt),
                })}
              </>
            )}
          </>
        }
        actions={
          <>
            <input
              type="month"
              className="form-control"
              aria-label={t('Month')}
              value={month}
              max={thisMonth()}
              onChange={(e) =>
                e.target.value && setParams({ month: e.target.value })
              }
            />
            <PendingButton
              className="small"
              pending={sync.isPending}
              pendingLabel={t('Syncing…')}
              disabled={r ? !r.analyticsConfigured : false}
              onClick={() => {
                setSyncMsg(null);
                sync.mutate();
              }}
            >
              <SyncIcon size={14} /> {t('Sync now')}
            </PendingButton>
          </>
        }
      />
      <AdminFrame>
        {syncMsg && <Notice tone={syncMsg.kind}>{syncMsg.text}</Notice>}
        {report.isPending ? (
          <RowsSkeleton rows={4} />
        ) : report.isError ? (
          <LoadError
            what={t('the usage report')}
            error={report.error}
            onRetry={() => report.refetch()}
          />
        ) : r ? (
          <>
            {!r.analyticsConfigured && (
              <Notice tone="warn">
                {tx(
                  'Cloudflare analytics are not set up, so only what CloudForge records itself (Actions runners, Workers AI calls, emails) is shown. Add the {secret} secret: an account API token with {scope}.',
                  {
                    secret: <code>CF_ANALYTICS_TOKEN</code>,
                    scope: <b>Account Analytics: Read</b>,
                  }
                )}
              </Notice>
            )}
            <div className="stats">
              <Card
                label={t('CloudForge usage at list price')}
                value={usd(r.totals.listCost)}
                detail={t('Every unit priced, no allowances')}
              />
              <Card
                label={t('If CloudForge had the allowances to itself')}
                value={usd(r.totals.dedicatedCost)}
                detail={t('Usage above the included amounts')}
              />
              <Card
                label={t('Projected for the month')}
                value={usd(r.totals.projectedListCost)}
                detail={t('{amount} with allowances', {
                  amount: usd(r.totals.projectedDedicatedCost),
                })}
              />
              <Card
                label={t('Workers Paid plan fee')}
                value={usd(r.prices.planFee)}
                detail={t('Per account, not counted above')}
              />
            </div>
            <Notice tone="info">
              {t(
                'Included allowances and the plan fee belong to the whole Cloudflare account. If anything else runs on it, the allowances are shared and the real bill for CloudForge’s usage is somewhere between the two figures above.'
              )}
            </Notice>

            <Section
              title={
                <>
                  <GraphIcon size={16} /> {t('Estimated cost per day')}
                </>
              }
            >
              <div className="panel pad">
                <DailyChart report={r} />
              </div>
            </Section>

            <Section title={t('By product')}>
              <LinesTable lines={r.lines} />
            </Section>

            <div className="usage-cols">
              <Section
                title={t('Actions: {minutes} runner minutes, {cost}', {
                  minutes: qty(r.actions.minutes),
                  cost: usd(r.actions.cost),
                })}
              >
                {r.actions.running > 0 && (
                  <p className="small muted">
                    {t(
                      '{n} runner(s) running now are counted up to this moment.',
                      { n: r.actions.running }
                    )}
                  </p>
                )}
                <Breakdown
                  title={t('By repository')}
                  empty={t('No Actions jobs ran this month.')}
                  rows={r.actions.byRepository.map((x) => ({
                    key: x.repository,
                    detail: t('{n} minutes', { n: qty(x.minutes) }),
                    cost: x.cost,
                  }))}
                />
                <Breakdown
                  title={t('By runner size')}
                  empty={t('No Actions jobs ran this month.')}
                  rows={r.actions.byInstance.map((x) => ({
                    key: x.instanceType,
                    detail: t('{n} minutes', { n: qty(x.minutes) }),
                    cost: x.cost,
                  }))}
                />
              </Section>
              <Section
                title={t('Workers AI: {calls} calls, {cost}', {
                  calls: qty(r.ai.requests),
                  cost: usd(r.ai.cost),
                })}
              >
                {r.ai.unreportedRequests > 0 && (
                  <p className="small muted">
                    {t(
                      '{n} call(s) reported no token counts and are not priced.',
                      { n: r.ai.unreportedRequests }
                    )}
                  </p>
                )}
                <Breakdown
                  title={t('By feature')}
                  empty={t('No AI calls this month.')}
                  rows={r.ai.byFeature.map((x) => ({
                    key: x.key,
                    detail: t('{calls} calls · {in} in · {out} out tokens', {
                      calls: qty(x.requests),
                      in: qty(x.tokensIn),
                      out: qty(x.tokensOut),
                    }),
                    cost: x.cost,
                  }))}
                />
                <Breakdown
                  title={t('By repository')}
                  empty={t('No AI calls this month.')}
                  rows={r.ai.byRepository.map((x) => ({
                    key: x.key,
                    detail: t('{n} calls', { n: qty(x.requests) }),
                    cost: x.cost,
                  }))}
                />
              </Section>
            </div>

            {r.gateway && (
              <Section
                title={tx('AI Gateway {id} (whole gateway)', {
                  id: <code>{r.gateway.id}</code>,
                })}
              >
                <div className="panel pad small">
                  {r.gateway.status === 'measured' ? (
                    <p>
                      {r.gateway.estimatedCost !== null
                        ? tx(
                            '{requests} requests, {cost} by the gateway’s own estimate.',
                            {
                              requests: qty(r.gateway.requests ?? 0),
                              cost: usd(r.gateway.estimatedCost),
                            }
                          )
                        : t('{requests} requests.', {
                            requests: qty(r.gateway.requests ?? 0),
                          })}
                    </p>
                  ) : (
                    <p className="attention">
                      {r.gateway.status === 'not-configured'
                        ? t('Not configured.')
                        : t('Unavailable.')}{' '}
                      {r.gateway.reason}
                    </p>
                  )}
                  <p className="muted">
                    {t(
                      'For the whole gateway, which other apps or a dev instance may share; not added to CloudForge’s totals. CloudForge’s own AI cost is the Workers AI section above.'
                    )}
                  </p>
                </div>
              </Section>
            )}

            <Section title={t('Not measured')}>
              <ul className="plain-bullets small muted">
                {r.notMeasured.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
              <p className="small muted">
                {tx(
                  'Workers Paid list prices, last checked {date}: {sources}.',
                  {
                    date: r.prices.checkedOn,
                    sources: (
                      <>
                        {r.prices.sources.map((s, i) => (
                          <span key={s}>
                            {i > 0 && ', '}
                            <a href={s} target="_blank" rel="noreferrer">
                              {
                                new URL(s).pathname
                                  .split('/')
                                  .filter(Boolean)[0]
                              }
                            </a>
                          </span>
                        ))}
                      </>
                    ),
                  }
                )}
              </p>
            </Section>
          </>
        ) : null}
      </AdminFrame>
    </>
  );
}
