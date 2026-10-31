// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from '@tanstack/react-query';
import {
  BrowserRouter,
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
} from 'react-router-dom';
import { useCurrentUser, useSession } from '@/lib/auth';
import { openWithoutAccount } from '@/lib/signIn';
import { syncLang } from '@/lib/i18n';
import { useEffect, useState } from 'react';
import { api, qk } from '@/lib/uiApi';
import { Spinner } from '@/components/Spinner';
import { LiveUpdates } from '@/lib/live';
import { RepoLayout } from '@/components/RepoLayout';
import { AppShell } from '@/components/shell/AppShell';
import { PageHeadProvider, useCurrentPageHead } from '@/components/ui/PageHead';
import Setup from './pages/Setup';
import Login from './pages/Login';
import OIDCSignIn from './pages/OIDCSignIn';
import Signup from './pages/Signup';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import AcceptInvite from './pages/AcceptInvite';
import Home from './pages/Home';
import PublicHome from './pages/PublicHome';
import Repositories from './pages/Repositories';
import Approvals from './pages/Approvals';
import Finding from './pages/Finding';
import NewRepo from './pages/NewRepo';
import Profile from './pages/Profile';
import RepoCode from './pages/RepoCode';
import RepoHealth from './pages/RepoHealth';
import RepoCommits from './pages/RepoCommits';
import CommitView from './pages/CommitView';
import Pulls from './pages/Pulls';
import PullNew from './pages/PullNew';
import PullView from './pages/PullView';
import Issues from './pages/Issues';
import IssueNew from './pages/IssueNew';
import IssueView from './pages/IssueView';
import RepoLabels from './pages/RepoLabels';
import Session from './pages/Session';
import RepoSettings from './pages/RepoSettings';
import RepoWebhooks from './pages/RepoWebhooks';
import RepoDeployTokens from './pages/RepoDeployTokens';
import RepoActions from './pages/RepoActions';
import RepoInsights from './pages/RepoInsights';
import RepoReleases from './pages/RepoReleases';
import ReleaseView from './pages/ReleaseView';
import RepoTags from './pages/RepoTags';
import { useDocumentTitle } from './lib/appName';
import SettingsMcp from './pages/SettingsMcp';
import OAuthConsent from './pages/OAuthConsent';
import RunView from './pages/RunView';
import AgentRunView from './pages/AgentRuns';
import SettingsTokens from './pages/SettingsTokens';
import SettingsEmails, { VerifyEmail } from './pages/SettingsEmails';
import SettingsLanguage from './pages/SettingsLanguage';
import SettingsNotifications from './pages/SettingsNotifications';
import SettingsSecurity from './pages/SettingsSecurity';
import Notifications from './pages/Notifications';
import Admin from './pages/Admin';
import AdminUsage from './pages/AdminUsage';
import AdminAudit from './pages/AdminAudit';
import AdminAgents from './pages/AdminAgents';
import Agents from './pages/Agents';
import AgentNew from './pages/AgentNew';
import AgentBuiltin from './pages/AgentBuiltin';
import { NotFound } from './pages/NotFound';
import {
  RecentAuthentication,
  VerifyAuthentication,
} from '@/components/RecentAuthentication';
import { useAuthenticationPolicy } from '@/lib/useAuthenticationPolicy';
import { authenticationPolicyReturn } from '@/lib/authenticationPolicy';
import { AuthShell } from '@/pages/AuthShell';
import { LoadError } from '@/components/Notice';
import { t } from '@/lib/i18n';
import { signOut } from '@/lib/auth';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      // Not found and signed out are answers, not hiccups: no retry.
      retry: (n, e: any) => e?.status !== 404 && e?.status !== 401 && n < 2,
      refetchOnWindowFocus: false,
    },
  },
});

/** First run → /setup; afterwards every page needs a session, except home and public repositories. */
function Gate({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const setup = useQuery({ queryKey: qk.setup, queryFn: api.setupStatus });
  const { data: session, isPending } = useSession();
  const policy = useAuthenticationPolicy();
  const [enrollmentOwner, setEnrollmentOwner] = useState<string | null>(null);
  const userId = session?.user.id;
  useEffect(() => {
    if (policy.data?.access === 'enroll_mfa' && userId)
      setEnrollmentOwner(userId);
    else if (enrollmentOwner && enrollmentOwner !== userId)
      setEnrollmentOwner(null);
  }, [userId, policy.data?.access, enrollmentOwner]);
  if (setup.isPending || isPending) return <Spinner />;
  if (setup.data?.setupRequired) return <Navigate to="/setup" replace />;
  if (!session) {
    if (openWithoutAccount(location.pathname)) return <>{children}</>;
    return (
      <Navigate
        to={`/login?return_to=${encodeURIComponent(location.pathname + location.search)}`}
        replace
      />
    );
  }
  const returnTo = authenticationPolicyReturn(
    location.pathname,
    location.search,
    location.hash
  );
  // Enrollment rotates the cookie. Keep this account's component mounted until its one-time codes are saved.
  if (enrollmentOwner === userId || policy.data?.access === 'enroll_mfa')
    return (
      <AuthShell
        title={t('Two-factor authentication required')}
        docTitle={t('Account security')}
        wide
      >
        <SettingsSecurity
          key={userId}
          restricted
          onContinue={() => {
            window.location.assign(
              policy.data?.access === 'full'
                ? returnTo
                : `/login/verify?return_to=${encodeURIComponent(returnTo)}`
            );
          }}
        />
        <button
          type="button"
          className="btn-link"
          onClick={() =>
            void signOut().then(() => window.location.assign('/login'))
          }
        >
          {t('Sign out')}
        </button>
      </AuthShell>
    );
  if (policy.isPending) return <Spinner />;
  if (policy.isError || !policy.data)
    return (
      <AuthShell
        title={t('Verify your sign-in policy')}
        docTitle={t('Account security')}
      >
        <LoadError
          what={t('the authentication policy')}
          error={policy.error}
          onRetry={() => policy.refetch()}
        />
        <button
          type="button"
          className="btn-link"
          onClick={() =>
            void signOut().then(() => window.location.assign('/login'))
          }
        >
          {t('Sign out')}
        </button>
      </AuthShell>
    );
  if (policy.data.access === 'reauthenticate') {
    if (location.pathname === '/login/verify') return <>{children}</>;
    return (
      <Navigate
        to={`/login/verify?return_to=${encodeURIComponent(returnTo)}`}
        replace
      />
    );
  }
  if (location.pathname === '/login/verify') return <>{children}</>;
  return <LiveUpdates>{children}</LiveUpdates>;
}

/** Home: the dashboard for members, the public repositories for everyone else. */
function HomeRoute() {
  return useCurrentUser() ? <Home /> : <PublicHome />;
}

function AdminOnly({ children }: { children: React.ReactNode }) {
  const { data } = useSession();
  if ((data?.user as any)?.role !== 'admin') return <NotFound />;
  return <>{children}</>;
}

/**
 * Applies the instance default language and, for a member, the language kept with their account (both are
 * known only after the page has loaded with its first guess; see syncLang).
 */
function LanguageSync() {
  const status = useQuery({ queryKey: qk.setup, queryFn: api.setupStatus });
  const signedIn = !!useCurrentUser();
  const prefs = useQuery({
    queryKey: qk.preferences,
    queryFn: api.preferences,
    enabled: signedIn,
  });
  const instance = status.data?.defaultLanguage;
  const account = prefs.data?.language;
  const waiting = signedIn && prefs.isPending;
  useEffect(() => {
    if (instance && !waiting) syncLang(instance, account);
  }, [instance, account, waiting]);
  return null;
}

/** Sets the tab title: the page's name (from the top band) and the instance name. */
function DocumentTitle() {
  const head = useCurrentPageHead();
  useDocumentTitle(head ? (head.documentTitle ?? head.title) : null);
  return null;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <PageHeadProvider>
      <DocumentTitle />
      <LanguageSync />
      <BrowserRouter>
        <Routes>
          {/* Public and auth pages: no rail. */}
          <Route path="/setup" element={<Setup />} />
          <Route path="/login" element={<Login />} />
          <Route path="/login/oidc" element={<OIDCSignIn />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/invite/:token" element={<AcceptInvite />} />
          <Route
            element={
              <Gate>
                <Outlet />
              </Gate>
            }
          >
            {/* Signed in, but an authorization page of its own: no rail. */}
            <Route path="/oauth/consent" element={<OAuthConsent />} />
            <Route path="/login/verify" element={<VerifyAuthentication />} />
            <Route element={<AppShell />}>
              <Route path="/" element={<HomeRoute />} />
              <Route path="/repos" element={<Repositories />} />
              {/* Every member reads the agents; creating them is for site admins (the page says so). */}
              <Route path="/agents" element={<Agents />} />
              <Route path="/agents/new" element={<AgentNew />} />
              <Route path="/agents/:id" element={<AgentBuiltin />} />
              <Route path="/new" element={<NewRepo />} />
              <Route path="/approvals" element={<Approvals />} />
              <Route path="/approvals/:flagId" element={<Finding />} />
              <Route path="/settings/tokens" element={<SettingsTokens />} />
              <Route path="/settings/security" element={<SettingsSecurity />} />
              <Route path="/settings/mcp" element={<SettingsMcp />} />
              <Route path="/settings/emails" element={<SettingsEmails />} />
              <Route path="/settings/language" element={<SettingsLanguage />} />
              <Route
                path="/settings/notifications"
                element={<SettingsNotifications />}
              />
              <Route path="/notifications" element={<Notifications />} />
              <Route path="/settings/emails/verify" element={<VerifyEmail />} />
              <Route
                path="/admin"
                element={
                  <AdminOnly>
                    <Admin />
                  </AdminOnly>
                }
              />
              <Route
                path="/admin/usage"
                element={
                  <AdminOnly>
                    <AdminUsage />
                  </AdminOnly>
                }
              />
              <Route
                path="/admin/audit"
                element={
                  <AdminOnly>
                    <AdminAudit />
                  </AdminOnly>
                }
              />
              <Route
                path="/admin/agents"
                element={
                  <AdminOnly>
                    <AdminAgents />
                  </AdminOnly>
                }
              />
              <Route path="/:owner" element={<Profile />} />
              <Route path="/:owner/:repo" element={<RepoLayout />}>
                <Route index element={<RepoCode />} />
                <Route path="tree/*" element={<RepoCode />} />
                <Route path="blob/*" element={<RepoCode />} />
                <Route path="commits/*" element={<RepoCommits />} />
                <Route path="commit/:sha" element={<CommitView />} />
                <Route path="health" element={<RepoHealth />} />
                <Route path="issues" element={<Issues />} />
                <Route path="issues/new" element={<IssueNew />} />
                <Route path="issues/:number" element={<IssueView />} />
                <Route path="labels" element={<RepoLabels />} />
                <Route path="pulls" element={<Pulls />} />
                <Route path="compare" element={<PullNew />} />
                <Route path="compare/*" element={<PullNew />} />
                <Route path="pull/:number" element={<PullView />} />
                <Route path="pull/:number/:tab" element={<PullView />} />
                <Route path="session/:id" element={<Session />} />
                <Route path="releases" element={<RepoReleases />} />
                <Route path="releases/:tag" element={<ReleaseView />} />
                <Route path="tags" element={<RepoTags />} />
                <Route path="actions" element={<RepoActions />} />
                <Route path="actions/runs/:number" element={<RunView />} />
                <Route path="actions/agent/:id" element={<AgentRunView />} />
                <Route
                  path="actions/runs/:number/job/:jobId"
                  element={<RunView />}
                />
                <Route path="insights" element={<RepoInsights />} />
                <Route path="settings" element={<RepoSettings />} />
                <Route path="settings/webhooks" element={<RepoWebhooks />} />
                <Route
                  path="settings/deploy-tokens"
                  element={<RepoDeployTokens />}
                />
                <Route path="*" element={<NotFound />} />
              </Route>
              <Route path="*" element={<NotFound />} />
            </Route>
          </Route>
        </Routes>
        <RecentAuthentication />
      </BrowserRouter>
    </PageHeadProvider>
  </QueryClientProvider>
);

export default App;
