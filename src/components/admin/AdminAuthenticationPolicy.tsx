import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSession } from '@/lib/auth/auth';
import { apiFetch, errorMessage, ApiError } from '@/lib/api/api';
import {
  currentPolicyPreview,
  notifyAuthenticationPolicyChanged,
  type AuthenticationPolicy,
  type AuthenticationPolicyPreview,
} from '@/lib/auth/authenticationPolicy';
import { t } from '@/lib/i18n/i18n';
import { Section } from '@/components/ui/Section';
import { PendingButton } from '@/components/ui/PendingButton';
import { LoadError, Notice } from '@/components/ui/Notice';
import { RowsSkeleton } from '@/components/shell/SetFrame';

export function AdminAuthenticationPolicy() {
  const { data: session } = useSession();
  return (
    <PolicyForm
      key={`${session?.user.id ?? ''}:${session?.session.id ?? ''}`}
    />
  );
}

function PolicyForm() {
  const { data: session } = useSession();
  const client = useQueryClient();
  const userId = session?.user.id;
  const sessionId = session?.session.id;
  const key = ['admin-authentication-policy', userId, sessionId];
  const state = useQuery({
    queryKey: key,
    enabled: !!sessionId,
    queryFn: ({ signal }) =>
      apiFetch<{ policy: AuthenticationPolicy }>(
        '/api/admin/authentication-policy',
        { cache: 'no-store', signal }
      ),
    staleTime: 0,
    retry: false,
  });
  const [target, setTarget] = useState<boolean | null>(null);
  const [preview, setPreview] = useState<AuthenticationPolicyPreview | null>(
    null
  );
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState<'preview' | 'apply' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needsEnrollment, setNeedsEnrollment] = useState(false);
  const [saved, setSaved] = useState(false);
  const generation = useRef(0);
  const pendingRequest = useRef<AbortController | null>(null);
  const clearPreview = () => {
    setPreview(null);
    setAcknowledged(false);
  };
  useEffect(() => {
    const clear = () => {
      generation.current++;
      pendingRequest.current?.abort();
      pendingRequest.current = null;
      setTarget(null);
      clearPreview();
      setBusy(null);
      setError(null);
      setNeedsEnrollment(false);
      setSaved(false);
    };
    const restore = (event: PageTransitionEvent) => {
      if (event.persisted)
        void client.invalidateQueries({
          queryKey: ['admin-authentication-policy', userId, sessionId],
          exact: true,
        });
    };
    clear();
    // A cached document must not retain its acknowledgement or accept a late preview.
    window.addEventListener('pagehide', clear);
    window.addEventListener('pageshow', restore);
    return () => {
      generation.current++;
      pendingRequest.current?.abort();
      pendingRequest.current = null;
      window.removeEventListener('pagehide', clear);
      window.removeEventListener('pageshow', restore);
    };
  }, [client, userId, sessionId, state.data?.policy.version]);
  useEffect(() => {
    if (!preview) return;
    const remaining = Date.parse(preview.expiresAt) - Date.now();
    if (!Number.isFinite(remaining) || remaining <= 0) {
      clearPreview();
      return;
    }
    const timeout = window.setTimeout(clearPreview, remaining);
    return () => window.clearTimeout(timeout);
  }, [preview]);
  const requireMfa = target ?? state.data?.policy.requireMfa ?? false;
  const valid = currentPolicyPreview(
    preview,
    requireMfa,
    state.data?.policy.version ?? -1
  );
  const run = async (operation: 'preview' | 'apply') => {
    if (busy || !sessionId || !state.data) return;
    if (operation === 'apply' && (!valid || !acknowledged)) return;
    const requestGeneration = generation.current;
    const controller = new AbortController();
    pendingRequest.current = controller;
    setBusy(operation);
    setError(null);
    setNeedsEnrollment(false);
    setSaved(false);
    try {
      if (operation === 'preview') {
        clearPreview();
        const result = await apiFetch<AuthenticationPolicyPreview>(
          '/api/admin/authentication-policy/preview',
          {
            method: 'POST',
            json: { requireMfa },
            headers: { 'X-CloudForge-Session': sessionId },
            signal: controller.signal,
          }
        );
        if (generation.current !== requestGeneration) return;
        if (
          !currentPolicyPreview(result, requireMfa, state.data.policy.version)
        )
          throw new Error(
            'This preview expired or the policy changed. Preview again.'
          );
        setPreview(result);
      } else {
        await apiFetch<{ policy: AuthenticationPolicy }>(
          '/api/admin/authentication-policy/apply',
          {
            method: 'POST',
            json: {
              previewId: preview!.previewId,
              digest: preview!.digest,
              recoveryAcknowledged: true,
            },
            headers: { 'X-CloudForge-Session': sessionId },
            signal: controller.signal,
          }
        );
        if (generation.current !== requestGeneration) return;
        clearPreview();
        setSaved(true);
        notifyAuthenticationPolicyChanged(sessionId);
        await client.invalidateQueries({ queryKey: key, exact: true });
      }
    } catch (caught) {
      if (generation.current !== requestGeneration) return;
      clearPreview();
      setNeedsEnrollment(
        caught instanceof ApiError &&
          caught.body?.code === 'MFA_ENROLLMENT_REQUIRED'
      );
      setError(errorMessage(caught));
    } finally {
      if (pendingRequest.current === controller) pendingRequest.current = null;
      if (generation.current === requestGeneration) setBusy(null);
    }
  };
  return (
    <Section title={t('Authentication policy')}>
      {state.isPending ? (
        <RowsSkeleton rows={3} />
      ) : state.isError ? (
        <LoadError
          what={t('the authentication policy')}
          error={state.error}
          onRetry={() => state.refetch()}
        />
      ) : (
        <>
          <p>
            {state.data.policy.requireMfa
              ? t('Two-factor authentication is required for every member.')
              : t(
                  'Members currently choose whether to enable two-factor authentication.'
                )}
          </p>
          <p className="small muted">
            {t(
              'Changing this policy requires a recent password and second-factor verification. Preview the impact before confirming.'
            )}
          </p>
          {error && (
            <Notice tone="bad">
              {error}
              {needsEnrollment && (
                <>
                  {' '}
                  <Link to="/settings/security">
                    {t('Set up authenticator app')}
                  </Link>
                </>
              )}
            </Notice>
          )}
          {saved && (
            <Notice tone="ok">{t('Authentication policy updated.')}</Notice>
          )}
          <label className="security-saved">
            <input
              type="checkbox"
              checked={requireMfa}
              disabled={!!busy}
              onChange={(event) => {
                generation.current++;
                setTarget(event.target.checked);
                clearPreview();
                setSaved(false);
                setError(null);
              }}
            />{' '}
            {t('Require two-factor authentication for all members')}
          </label>
          <div className="security-actions">
            <PendingButton
              pending={busy === 'preview'}
              disabled={!!busy || requireMfa === state.data.policy.requireMfa}
              pendingLabel={t('Preparing preview…')}
              onClick={() => void run('preview')}
            >
              {t('Preview policy change')}
            </PendingButton>
          </div>
          {valid && preview && (
            <section
              className="panel formpad policy-preview"
              aria-label={t('Policy change preview')}
            >
              <h3>{t('Policy change preview')}</h3>
              <dl className="policy-impact">
                <dt>{t('Members')}</dt>
                <dd>{preview.impact.members}</dd>
                <dt>{t('Members needing enrollment')}</dt>
                <dd>{preview.impact.unenrolledMembers}</dd>
                <dt>{t('Other browser sessions requiring verification')}</dt>
                <dd>{preview.impact.sessionsToReverify}</dd>
                <dt>{t('OAuth connections to disconnect')}</dt>
                <dd>{preview.impact.oauthConnections}</dd>
                <dt>{t('Existing personal access tokens kept active')}</dt>
                <dd>{preview.impact.personalTokens}</dd>
                <dt>{t('Existing deployment tokens kept active')}</dt>
                <dd>{preview.impact.deployTokens}</dd>
              </dl>
              <Notice tone="warn">
                {t(
                  'Every policy change disconnects existing OAuth applications. Members must connect them again. Existing personal access tokens and deployment tokens keep their current permissions and expiry.'
                )}
              </Notice>
              <p>
                {t(
                  'Keep authenticator recovery codes outside this browser. If the last administrator loses all factors, an operator with Cloudflare management access must use the independent cloudforge reset-mfa command with an explicit target and audited reason.'
                )}
              </p>
              <p className="small muted">
                {t(
                  'This preview is temporary. Changes to the policy, your sign-in or the affected accounts may require another preview.'
                )}
              </p>
              <label className="security-saved">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  disabled={!!busy}
                  onChange={(event) => setAcknowledged(event.target.checked)}
                />{' '}
                {t(
                  'I understand the impact and have an independent recovery path for the last administrator.'
                )}
              </label>
              <div className="security-actions">
                <PendingButton
                  className="primary"
                  pending={busy === 'apply'}
                  disabled={!!busy || !acknowledged}
                  pendingLabel={t('Applying…')}
                  onClick={() => void run('apply')}
                >
                  {t('Confirm policy change')}
                </PendingButton>
                <button
                  type="button"
                  className="btn"
                  disabled={!!busy}
                  onClick={clearPreview}
                >
                  {t('Cancel')}
                </button>
              </div>
            </section>
          )}
        </>
      )}
    </Section>
  );
}
