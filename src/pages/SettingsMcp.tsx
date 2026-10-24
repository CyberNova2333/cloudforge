// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertIcon,
  EyeIcon,
  PencilIcon,
  PlugIcon,
  ShieldCheckIcon,
  SparkleFillIcon,
} from '@primer/octicons-react';
import { api, qk, type McpConnection, type McpTool } from '@/lib/uiApi';
import { errorMessage } from '@/lib/api';
import { timeAgo } from '@/lib/format';
import { t, tx } from '@/lib/i18n';
import { PageHead } from '@/components/ui/PageHead';
import { Chip } from '@/components/ui/Chip';
import { EmptyState } from '@/components/ui/EmptyState';
import { Seg } from '@/components/ui/Seg';
import { Section } from '@/components/ui/Section';
import { PendingButton } from '@/components/ui/PendingButton';
import { CopyButton } from '@/components/CopyButton';
import { InlineConfirm } from '@/components/InlineConfirm';
import { LoadError, Notice } from '@/components/Notice';
import { RowsSkeleton, SettingsFrame } from '@/components/SetFrame';
import { useAppName } from '@/lib/appName';

type Client = 'claude-code' | 'claude' | 'cursor' | 'codex' | 'other';
const CLIENTS: { value: Client; label: string }[] = [
  { value: 'claude-code', label: 'Claude Code' },
  { value: 'claude', label: 'Claude.ai & Desktop' },
  { value: 'cursor', label: 'Cursor' },
  { value: 'codex', label: 'Codex' },
  { value: 'other', label: t('Other clients') },
];

function Snippet({ text, label }: { text: string; label?: string }) {
  return (
    <div className="snippet">
      <div className="snippet-head">
        <span className="mono muted">{label ?? t('Terminal')}</span>
        <CopyButton text={text} className="btn small quiet" />
      </div>
      <pre className="mono">{text}</pre>
    </div>
  );
}

function SetupSteps({
  client,
  url,
  serverName,
  appName,
}: {
  client: Client;
  url: string;
  serverName: string;
  appName: string;
}) {
  if (client === 'claude-code')
    return (
      <>
        <p>{t('Add the server from your terminal:')}</p>
        <Snippet
          text={`claude mcp add --transport http ${serverName} ${url}`}
        />
        <p>
          {tx(
            'Then start Claude Code, run {command}, choose {server}, and select {auth}. Your browser opens {app}: sign in and allow access.',
            {
              command: <code>/mcp</code>,
              server: <b>{serverName}</b>,
              auth: <b>{t('Authenticate')}</b>,
              app: appName,
            }
          )}
        </p>
      </>
    );
  if (client === 'claude')
    return (
      <ol>
        <li>
          {tx('Open {link} (in Claude.ai or the Claude desktop app).', {
            link: (
              <a
                href="https://claude.ai/customize/connectors?modal=add-custom-connector"
                target="_blank"
                rel="noreferrer"
              >
                Settings → Connectors → Add custom connector
              </a>
            ),
          })}
        </li>
        <li>
          {tx('Name it {name} and paste the server URL {url}.', {
            name: <b>{appName}</b>,
            url: <code>{url}</code>,
          })}
        </li>
        <li>
          {tx(
            'Select {connect}, sign in to {app}, and allow access. The connector then works in Claude on the web, desktop, and mobile.',
            { connect: <b>{t('Connect')}</b>, app: appName }
          )}
        </li>
      </ol>
    );
  if (client === 'cursor') {
    const config = btoa(JSON.stringify({ url }));
    return (
      <>
        <p>
          <a
            className="btn small primary"
            href={`cursor://anysphere.cursor-deeplink/mcp/install?name=${serverName}&config=${encodeURIComponent(config)}`}
          >
            {t('Add to Cursor')}
          </a>
        </p>
        <p>
          {tx("Or add it to {user} (or a project's {project}):", {
            user: <code>~/.cursor/mcp.json</code>,
            project: <code>.cursor/mcp.json</code>,
          })}
        </p>
        <Snippet
          label="mcp.json"
          text={JSON.stringify(
            { mcpServers: { [serverName]: { url } } },
            null,
            2
          )}
        />
        <p>
          {tx(
            'Cursor shows {needsLogin} next to the server in Settings → MCP; select it to sign in to {app}.',
            { needsLogin: <b>{t('Needs login')}</b>, app: appName }
          )}
        </p>
      </>
    );
  }
  if (client === 'codex')
    return (
      <>
        <p>{t('Add the server from your terminal, then sign in:')}</p>
        <Snippet
          text={`codex mcp add ${serverName} --url ${url}\ncodex mcp login ${serverName}`}
        />
        <p>
          {tx('Or add it to {file} under {section} with {setting}.', {
            file: <code>~/.codex/config.toml</code>,
            section: <code>[mcp_servers.{serverName}]</code>,
            setting: <code>url = &quot;{url}&quot;</code>,
          })}
        </p>
      </>
    );
  return (
    <p>
      {tx(
        "Any MCP client that supports remote servers works. Add a {transport} server with the URL {url}. The client discovers {app}'s sign-in automatically (OAuth 2.1 with PKCE and dynamic client registration), so there's no token to copy: you sign in and approve access in your browser.",
        {
          transport: <b>Streamable HTTP</b>,
          url: <code>{url}</code>,
          app: appName,
        }
      )}
    </p>
  );
}

function ToolRow({ tool }: { tool: McpTool }) {
  const params = Object.entries(tool.inputSchema.properties ?? {});
  const required = new Set(tool.inputSchema.required ?? []);
  return (
    <li className="mcp-tool">
      <div className="mcp-tool-head">
        <b>{tool.title}</b>
        <code className="muted">{tool.name}</code>
        {tool.annotations.readOnlyHint ? (
          <Chip tone="off" icon={<EyeIcon size={12} />}>
            {t('Read-only')}
          </Chip>
        ) : (
          <Chip tone="warn" icon={<PencilIcon size={12} />}>
            {t('Makes changes')}
          </Chip>
        )}
      </div>
      <p className="small muted">{tool.description}</p>
      {params.length > 0 && (
        <ul className="params small muted">
          {params.map(([name, p]) => (
            <li key={name}>
              <code>{name}</code>
              {required.has(name) ? t(' (required)') : ''}
              {p.enum
                ? t(' — one of {values}', { values: p.enum.join(', ') })
                : ''}
              {p.description ? `: ${p.description}` : ''}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/** A short client-id fragment and where the app's sign-in redirects, to tell apps of the same name apart. */
function AppIdentity({ app }: { app: McpConnection }) {
  return (
    <>
      <span className="mono" title={app.clientId}>
        {app.clientId.slice(0, 8)}
      </span>
      {app.redirectHost && (
        <>{t(', redirects to {host}', { host: app.redirectHost })}</>
      )}
    </>
  );
}

/** Settings → MCP server: connect an AI tool, see what it can do, and manage the apps you connected. */
export default function SettingsMcp() {
  const qc = useQueryClient();
  const appName = useAppName();
  const info = useQuery({ queryKey: qk.mcp, queryFn: api.mcp });
  const connections = useQuery({
    queryKey: qk.mcpConnections,
    queryFn: api.mcpConnections,
  });
  const [client, setClient] = useState<Client>('claude-code');
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  // The app just made a moderator: its tool list is fetched on connect, so it needs reconnecting.
  const [enabled, setEnabled] = useState<string | null>(null);
  const moderator = useMutation({
    mutationFn: ({ clientId, on }: { clientId: string; on: boolean }) =>
      api.setMcpModerator(clientId, on),
    onMutate: () => setError(null),
    onSuccess: (_, { clientId, on }) => {
      setError(null);
      setConfirming(null);
      setEnabled(on ? clientId : null);
      return qc.invalidateQueries({ queryKey: qk.mcpConnections });
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const disconnect = useMutation({
    mutationFn: (clientId: string) => api.disconnectMcp(clientId),
    onMutate: () => setError(null),
    onSuccess: () => {
      setError(null);
      return qc.invalidateQueries({ queryKey: qk.mcpConnections });
    },
    onError: (e) => setError(errorMessage(e)),
  });

  return (
    <>
      <PageHead
        icon="plug"
        crumbs={[
          { label: t('Settings'), to: '/settings/tokens' },
          { label: t('MCP server') },
        ]}
        title={t('MCP server')}
        lede={t(
          'Connect Claude, Cursor and other AI tools to {app} through the Model Context Protocol. They act as you, so they see the repositories you can see, and they can create repositories for you.',
          { app: appName }
        )}
      />
      <SettingsFrame>
        <Section title={t('Connected apps')} className="mcp-apps">
          {error && <Notice tone="bad">{error}</Notice>}
          <div className="panel">
            {connections.isPending ? (
              <div className="pad">
                <RowsSkeleton rows={2} />
              </div>
            ) : connections.isError ? (
              <div className="pad">
                <LoadError
                  what={t('your connected apps')}
                  error={connections.error}
                  onRetry={() => connections.refetch()}
                />
              </div>
            ) : connections.data.length === 0 ? (
              <EmptyState
                picture={<PlugIcon size={20} />}
                title={t('No apps are connected yet.')}
                body={t(
                  'Apps appear here after you allow them access. Set one up below.'
                )}
              />
            ) : (
              <ul className="rowlist">
                {connections.data.map((c) => (
                  <li key={c.clientId} className="wrap-row">
                    <span
                      className={`mono-tile${/codex/i.test(c.name) ? ' codex' : ''}`}
                      aria-hidden="true"
                    >
                      {c.name.trim().charAt(0).toUpperCase() || '?'}
                    </span>
                    <div className="grow">
                      <b>
                        {c.name}
                        {c.moderator && (
                          <>
                            {' '}
                            <Chip tone="warn">{t('Moderator')}</Chip>
                          </>
                        )}
                      </b>
                      <span className="muted small">
                        {c.connectedAt
                          ? t('Connected {when}', {
                              when: timeAgo(c.connectedAt),
                            })
                          : t('Connected')}
                        {' · '}
                        <AppIdentity app={c} />
                      </span>
                    </div>
                    <div className="ctl">
                      <label className="tgl">
                        <span className="small">{t('Moderator')}</span>
                        <input
                          type="checkbox"
                          role="switch"
                          checked={c.moderator}
                          disabled={moderator.isPending}
                          aria-label={t('{app} is a moderator', {
                            app: c.name,
                          })}
                          onChange={(e) => {
                            if (e.target.checked) setConfirming(c.clientId);
                            else {
                              setConfirming(null);
                              moderator.mutate({
                                clientId: c.clientId,
                                on: false,
                              });
                            }
                          }}
                        />
                      </label>
                      <InlineConfirm
                        label={t('Disconnect')}
                        confirmLabel={t('Disconnect {app}', { app: c.name })}
                        pendingLabel={t('Disconnecting…')}
                        accessibleName={t('Disconnect {app}', {
                          app: c.name,
                        })}
                        pending={
                          disconnect.isPending &&
                          disconnect.variables === c.clientId
                        }
                        onConfirm={() => disconnect.mutate(c.clientId)}
                      />
                    </div>
                    {c.moderator && enabled === c.clientId && (
                      <p className="sub small muted" role="status">
                        {t('Reconnect the app to see the moderator tools.')}
                      </p>
                    )}
                    {confirming === c.clientId && !c.moderator && (
                      <div
                        className="sub"
                        role="group"
                        aria-label={t('Make {app} a moderator', {
                          app: c.name,
                        })}
                        aria-describedby={`moderator-confirm-${c.clientId}`}
                      >
                        <Notice
                          tone="warn"
                          action={
                            <span className="confirm">
                              <PendingButton
                                className="small danger"
                                // Moves focus into the confirmation as it opens.
                                autoFocus
                                pending={moderator.isPending}
                                pendingLabel={t('Making moderator…')}
                                onClick={() =>
                                  moderator.mutate({
                                    clientId: c.clientId,
                                    on: true,
                                  })
                                }
                              >
                                {t('Make moderator')}
                              </PendingButton>
                              <button
                                type="button"
                                className="btn small"
                                onClick={() => setConfirming(null)}
                              >
                                {t('Cancel')}
                              </button>
                            </span>
                          }
                        >
                          <span id={`moderator-confirm-${c.clientId}`}>
                            {tx(
                              'Make {app} ({identity}) a moderator? A moderator can approve agent findings and pull requests as you.',
                              {
                                app: <b>{c.name}</b>,
                                identity: <AppIdentity app={c} />,
                              }
                            )}
                          </span>
                        </Notice>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <p className="foot small muted">
            <ShieldCheckIcon size={14} />{' '}
            {t(
              'Disconnecting stops an app immediately; it has to ask for your approval again to reconnect.'
            )}
          </p>
          <p className="foot small attention">
            <AlertIcon size={14} />{' '}
            {t(
              'A moderator can approve agent findings and pull requests as you.'
            )}
          </p>
        </Section>

        <section className="panel pad delegate" aria-labelledby="mcp-delegate">
          <h2 id="mcp-delegate">
            <SparkleFillIcon size={16} /> {t('Letting Claude answer for you')}
          </h2>
          <p>
            {tx(
              'A {moderatorApp} (above) is a tool you connected, such as Claude Code. It can approve agent findings and pull requests as you. Findings from Security and Data need your own written reason, so the app has to ask you for it.',
              { moderatorApp: <b>{t('moderator app')}</b> }
            )}
          </p>
          <p>
            {tx(
              "{letClaudeDecide} is different: {app}'s own AI can answer reviewer findings on your pull requests for you, one reviewer at a time, and you can undo any answer while the pull request is open. {securityAndData}",
              {
                letClaudeDecide: <b>{t('Let Claude decide')}</b>,
                app: appName,
                securityAndData: (
                  <b>{t('Security and Data always come to you.')}</b>
                ),
              }
            )}
          </p>
          <div className="actions">
            <Link to="/approvals" className="btn small">
              {t('Turn it on in Approvals')}
            </Link>
          </div>
        </section>

        <Section title={t('Set it up')}>
          {info.isPending ? (
            <RowsSkeleton rows={2} />
          ) : info.isError ? (
            <LoadError
              what={t('the server details')}
              error={info.error}
              onRetry={() => info.refetch()}
            />
          ) : (
            <div className="panel">
              <div className="pad">
                <label className="lbl" htmlFor="mcp-url">
                  {t('Server URL')}
                </label>
                <div className="copyrow">
                  <input
                    id="mcp-url"
                    className="form-control mono"
                    readOnly
                    value={info.data.serverUrl}
                    onFocus={(e) => e.currentTarget.select()}
                  />
                  <CopyButton
                    text={info.data.serverUrl}
                    className="btn small"
                    label={t('Copy the server URL')}
                  />
                </div>
              </div>
              <div className="pad topline">
                <div className="segscroll">
                  <Seg<Client>
                    label={t('MCP client')}
                    options={CLIENTS}
                    value={client}
                    onChange={setClient}
                  />
                </div>
                <div className="steps">
                  <SetupSteps
                    client={client}
                    url={info.data.serverUrl}
                    serverName={info.data.serverName}
                    appName={appName}
                  />
                </div>
              </div>
              <div className="pad topline small muted">
                {tx(
                  'To check it works, ask: {question} Naming the server makes the AI call it instead of guessing.',
                  {
                    question: (
                      <em>
                        {t(
                          '“Which repositories do I have on {app}? Use the {server} MCP server.”',
                          {
                            app: appName,
                            server: info.data.serverName,
                          }
                        )}
                      </em>
                    ),
                  }
                )}
              </div>
            </div>
          )}
        </Section>

        {info.data && (
          <>
            <Section title={t('Tools')}>
              <div className="panel">
                <ul className="rowlist">
                  {info.data.tools.map((tool) => (
                    <ToolRow key={tool.name} tool={tool} />
                  ))}
                </ul>
              </div>
            </Section>
            <Section title={t('Moderator tools')}>
              <p className="small muted">
                {t('Only apps you mark as a moderator above see these.')}
              </p>
              <div className="panel">
                <ul className="rowlist">
                  {info.data.moderatorTools.map((tool) => (
                    <ToolRow key={tool.name} tool={tool} />
                  ))}
                </ul>
              </div>
            </Section>
          </>
        )}
      </SettingsFrame>
    </>
  );
}
