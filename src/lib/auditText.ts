// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import type { AuditEvent } from './uiApi';
import { lang, t, tn } from './i18n';
import { reasonText } from './pullState';

// The audit log in words: every event as one sentence ("mahmoud paused merging on octocat/cloudforge"), a second
// line for the facts that matter (the reason, the note, what a setting was), a link and a category. Pure, so the
// instance-wide log (Site admin → Audit log), a repository's own log and the Live page all say it the same way.

/** Where the sentence is read: a repository's own log leaves the repository out, the instance log names it. */
export type AuditScope = 'repo' | 'instance';

export interface AuditOptions {
  scope?: AuditScope;
  /** Agent handle → display name, for pages that know the crew ("speedagent" → "Speed"). */
  agentNames?: Record<string, string>;
}

/** A piece of a sentence: plain text, who did it, or a repository or pull request the page can link. */
export type AuditPart =
  | { kind: 'text'; text: string }
  | { kind: 'who'; text: string }
  | { kind: 'repo'; text: string; to: string }
  | { kind: 'pull'; text: string; to: string | null };

/** Every `audit_events` action (spec: audit_events actions). Pull request timeline entries arrive as `pull.<kind>`. */
export const AUDIT_ACTIONS = [
  'settings.changed',
  'collaborator.added',
  'collaborator.removed',
  'agent.invited',
  'agent.removed',
  'agent.created',
  'agent.deleted',
  'agent.restored',
  'branch.deleted',
  'branches.cleaned',
  'merging.paused',
  'merging.resumed',
  'pull.merged',
  'pull.reverted',
  'pull.approved',
  'finding.approved',
  'finding.changes_requested',
  'finding.assigned',
  'finding.delegated',
  'finding.undone',
  'finding.taught',
  'token.created',
  'token.deleted',
  'deploy_token.created',
  'deploy_token.deleted',
  'deploy_token.pushed',
  'visibility.changed',
  'repository.created',
  'repository.deleted',
  'instance.settings',
  'instance.oidc_configuration',
  'user.oidc_linked',
  'user.oidc_revoked',
  'user.oidc_signed_in',
  'release.created',
  'release.updated',
  'pull.version_bump',
  'artifact.deleted',
  'secret.saved',
  'secret.deleted',
  'secret.repositories',
  'variable.saved',
  'variable.deleted',
  'user.password_reset',
  'user.password_reset_link',
  'user.password_set',
  'issue.deleted',
  'issue.comment_deleted',
  'label.created',
  'label.updated',
  'label.deleted',
  'webhook.created',
  'webhook.updated',
  'webhook.deleted',
] as const;

type Data = Record<string, unknown>;
type Actor = AuditEvent['actor'];

const str = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() ? v : null;
const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;
const record = (v: unknown): Data | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Data) : null;

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const clip = (s: string, max = 200) =>
  s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;

/** "a", "a and b", "a, b and c" (Chinese: "a、b和c"). */
const list = (xs: string[]) =>
  xs.length < 2
    ? (xs[0] ?? '')
    : lang === 'zh'
      ? `${xs.slice(0, -1).join('、')}和${xs[xs.length - 1]}`
      : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;

const possessive = (name: string) =>
  lang === 'zh' ? `${name} 的` : /s$/i.test(name) ? `${name}'` : `${name}'s`;

/** Between the facts of a detail line: ". " (Chinese "。"). */
const SENTENCE_SEP = lang === 'zh' ? '。' : '. ';
/** Between reasons: "; " (Chinese "；"). */
const LIST_SEP = lang === 'zh' ? '；' : '; ';

const VISIBILITY_WORD: Record<string, string> = {
  private: t('private'),
  internal: t('internal'),
  public: t('public'),
};

const visibilityWord = (v: string) => VISIBILITY_WORD[v] ?? v;

const ACRONYMS: Record<string, string> = { ai: 'AI', id: 'ID', url: 'URL' };

/** "actions.retention_days" → ["actions", "retention", "days"]. */
const words = (key: string) =>
  key
    .split(/[._\-\s]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());

/** A setting key in words: "actions.retention_days" → "Actions retention days", "ai.review_model" → "AI review model". */
function settingLabel(key: string): string {
  const ws = words(key).map((w) => ACRONYMS[w] ?? w);
  return ws.length
    ? cap(ws[0]) + (ws.length > 1 ? ` ${ws.slice(1).join(' ')}` : '')
    : key;
}

/**
 * A reviewer agent's name from its handle: "speedagent" → "Speed". Custom handles stay as they are. A page that
 * knows the real names passes them in `names`.
 */
export function agentLabel(
  handle: string,
  names?: Record<string, string>
): string {
  const known = names?.[handle];
  if (known) return known;
  const m = /^(.+?)agent$/i.exec(handle);
  return m ? cap(m[1]) : handle;
}

/** Who did it, as a name: a person's username, an agent's name, "CloudForge AI" or "System". */
export function actorName(
  actor: Actor,
  names?: Record<string, string>
): string {
  switch (actor.kind) {
    case 'ai':
      return 'CloudForge AI';
    case 'system':
      // Not t('System'): the theme menu uses that key for "follow the system" (跟随系统).
      return lang === 'zh' ? '系统' : 'System';
    case 'agent':
      return actor.login
        ? agentLabel(actor.login, names)
        : actor.name || t('A reviewer agent');
    default:
      return actor.login || actor.name || t('A former member');
  }
}

type Piece = string | AuditPart | null | false | undefined;

/**
 * A translated sentence template (from `t()`) as pieces for `build`: each `{name}` becomes `vars[name]`, which may
 * be a linkable part, so a translation can move the links where its language puts them.
 */
function parts(template: string, vars: Record<string, Piece>): Piece[] {
  const out: Piece[] = [];
  let last = 0;
  for (const m of template.matchAll(/\{(\w+)\}/g)) {
    if (!(m[1] in vars)) continue;
    out.push(template.slice(last, m.index), vars[m[1]]);
    last = m.index + m[0].length;
  }
  out.push(template.slice(last));
  return out;
}

/** Joins strings and parts into parts, merging neighbouring text and dropping what is empty. */
function build(...xs: Piece[]) {
  const out: AuditPart[] = [];
  for (const x of xs) {
    if (!x) continue;
    const part: AuditPart =
      typeof x === 'string' ? { kind: 'text', text: x } : x;
    const last = out[out.length - 1];
    if (part.kind === 'text' && last?.kind === 'text') last.text += part.text;
    else out.push(part);
  }
  return out;
}

const STATE_PHRASE: Record<string, string> = {
  agent_followup: t('waiting on an agent'),
  human_review: t('waiting on a person'),
  waiting: t('waiting for checks'),
  ready: t('ready to merge'),
};

const SETTING_LABEL: Record<string, string> = {
  name: t('the name'),
  description: t('the description'),
  defaultBranch: t('the default branch'),
  protectedBranches: t('the protected branches'),
  deleteMergedBranches: t('automatic branch clean-up'),
};
const SETTING_DETAIL: Record<string, string> = {
  name: t('Name'),
  description: t('Description'),
  defaultBranch: t('Default branch'),
  protectedBranches: t('Protected branches'),
  deleteMergedBranches: t('Automatic branch clean-up'),
};

/** The pieces of one event's sentence, so a page can link the repository and the pull request. */
export function auditParts(
  e: AuditEvent,
  opts: AuditOptions = {}
): AuditPart[] {
  const scope = opts.scope ?? 'instance';
  const names = opts.agentNames;
  const d: Data = record(e.data) ?? {};
  const who: AuditPart = { kind: 'who', text: actorName(e.actor, names) };
  const here = scope === 'instance' ? e.repo : null;

  const repoPart = (): AuditPart | null =>
    e.repo ? { kind: 'repo', text: e.repo, to: `/${e.repo}` } : null;
  /** " on owner/name": the repository the event was in, when the log is not that repository's own. */
  const tail = (prep: 'on' | 'in' | 'of') => {
    const r = here ? repoPart() : null;
    if (!r) return [];
    const word =
      prep === 'on' ? t(' on ') : prep === 'in' ? t(' in ') : t(' of ');
    return [word, r];
  };
  /** The repository as the object of the sentence: a link, or "this repository" in its own log. */
  const repoObject = (): string | AuditPart =>
    here ? (repoPart() ?? e.target) : t('this repository');
  /** A pull request: "#74" in its repository's log, "owner/name#74" instance-wide. */
  const pull = (n: number | null = e.pull): AuditPart | null =>
    n === null
      ? null
      : {
          kind: 'pull',
          text: scope === 'instance' && e.repo ? `${e.repo}#${n}` : `#${n}`,
          to: e.repo ? `/${e.repo}/pull/${n}` : null,
        };
  const on = (n: number | null = e.pull) => {
    const p = pull(n);
    return p ? [t(' on '), p] : [];
  };
  const agent = str(d.agent);
  const agentName = agent ? agentLabel(agent, names) : null;
  const findingOf = (kind: unknown) =>
    str(kind) === 'change_requested' ? t('change request') : t('finding');
  /** "Speed's finding", or "a finding" when it names no agent. */
  const finding = () =>
    agentName
      ? `${possessive(agentName)} ${findingOf(d.kind)}`
      : t('a {finding}', { finding: findingOf(d.kind) });
  /** " via Claude Code": the app a person acted through (CloudForge AI is already the actor). */
  const via = () =>
    e.via && e.actor.kind !== 'ai' ? t(' via {app}', { app: e.via }) : '';
  const forPerson = () =>
    e.actor.kind === 'ai' && e.actor.login
      ? t(' for {person}', { person: e.actor.login })
      : '';

  const say = (...xs: (string | AuditPart | null | false | undefined)[]) =>
    build(who, ...xs);

  switch (e.action) {
    case 'settings.changed': {
      const changes = record(d.changes);
      const labels = changes
        ? Object.keys(changes).map(
            (k) => SETTING_LABEL[k] ?? words(k).join(' ')
          )
        : [];
      return say(
        t(' changed '),
        labels.length ? list(labels) : t('settings'),
        ...tail('on'),
        via()
      );
    }
    case 'visibility.changed': {
      const to = str(d.to);
      return to
        ? say(t(' made '), repoObject(), ' ', visibilityWord(to), via())
        : say(t(' changed the visibility of '), repoObject(), via());
    }
    case 'collaborator.added':
      return say(
        t(' added '),
        e.target,
        t(' as a collaborator'),
        ...tail('on'),
        via()
      );
    case 'collaborator.removed':
      return say(
        t(' removed '),
        e.target,
        t(' as a collaborator'),
        ...tail('on'),
        via()
      );
    case 'agent.invited':
      return say(
        t(' invited '),
        agentLabel(e.target, names),
        t(' to review '),
        repoObject(),
        via()
      );
    case 'agent.removed':
      return say(
        t(' removed '),
        agentLabel(e.target, names),
        t(' as a reviewer on '),
        repoObject(),
        via()
      );
    case 'agent.created':
      return say(
        t(' created the reviewer '),
        str(d.name) ?? agentLabel(e.target, names),
        via()
      );
    case 'agent.deleted':
      return say(
        t(' deleted the reviewer '),
        agentLabel(e.target, names),
        via()
      );
    case 'agent.restored':
      return say(
        t(' restored the reviewer '),
        agentLabel(e.target, names),
        via()
      );
    case 'branch.deleted':
      // CloudForge deletes a branch once its pull request has landed; a person deletes one by hand.
      if (e.pull !== null)
        return say(
          t(' deleted branch '),
          e.target,
          t(' after '),
          pull(),
          t(' merged'),
          via()
        );
      return say(
        t(' deleted branch '),
        e.target,
        d.merged === true && t(' after it merged'),
        ...tail('in'),
        via()
      );
    case 'secret.saved':
    case 'secret.deleted':
    case 'variable.saved':
    case 'variable.deleted': {
      const secret = e.action.startsWith('secret.');
      const deleted = e.action.endsWith('.deleted');
      const created = d.created === true;
      const verb = deleted
        ? secret
          ? t(' deleted the Actions secret ')
          : t(' deleted the Actions variable ')
        : created
          ? secret
            ? t(' added the Actions secret ')
            : t(' added the Actions variable ')
          : secret
            ? t(' updated the Actions secret ')
            : t(' updated the Actions variable ');
      return say(
        verb,
        e.target,
        // An instance-wide secret reaches only the repositories listed for it; a variable reaches all of them.
        d.scope === 'instance'
          ? secret
            ? t(' for the instance')
            : t(' for every repository')
          : false,
        ...(d.scope === 'instance' ? [] : tail('in')),
        via()
      );
    }
    case 'secret.repositories': {
      const names = (v: unknown) =>
        Array.isArray(v)
          ? v.filter((x): x is string => typeof x === 'string')
          : [];
      const added = names(d.added);
      const removed = names(d.removed);
      return say(
        t(' changed which repositories the instance secret '),
        e.target,
        t(' reaches'),
        added.length > 0 && t(': added {repos}', { repos: list(added) }),
        removed.length > 0 &&
          (added.length > 0
            ? t('; removed {repos}', { repos: list(removed) })
            : t(': removed {repos}', { repos: list(removed) })),
        via()
      );
    }
    case 'artifact.deleted':
      return say(
        t(' deleted the artifact '),
        e.target,
        typeof d.run === 'number' && t(' of run #{n}', { n: d.run }),
        ...tail('in'),
        via()
      );
    case 'branches.cleaned': {
      const branches = Array.isArray(d.branches) ? d.branches.length : null;
      const n = branches ?? (parseInt(e.target, 10) || null);
      return say(
        t(' cleaned up '),
        n
          ? tn(n, '{n} merged branch', '{n} merged branches')
          : t('merged branches'),
        ...tail('in'),
        via()
      );
    }
    case 'merging.paused':
      return say(t(' paused merging'), ...tail('on'), via());
    case 'merging.resumed':
      return say(t(' resumed merging'), ...tail('on'), via());
    case 'pull.merged': {
      const title = str(d.title);
      const into = str(d.into);
      return say(
        t(' merged '),
        pull(),
        title && ` “${title}”`,
        into && t(' into '),
        into,
        via()
      );
    }
    case 'pull.reverted': {
      const next = num(d.revert) ?? num(d.revertPull) ?? num(d.number);
      return say(
        t(' reverted '),
        pull(),
        next !== null && t(' with '),
        next !== null && pull(next),
        via()
      );
    }
    case 'pull.approved':
      return say(t(' approved '), pull(), via());
    case 'finding.approved':
      return say(
        str(d.kind) === 'change_requested' ? t(' dismissed ') : t(' approved '),
        finding(),
        ...on(),
        via()
      );
    case 'finding.changes_requested':
      return say(t(' asked for changes on '), finding(), ...on(), via());
    case 'finding.assigned': {
      const to = str(d.assignee);
      return to
        ? say(
            t(' assigned '),
            finding(),
            ...on(),
            t(' to {person}', { person: to }),
            via()
          )
        : say(t(' unassigned '), finding(), ...on(), via());
    }
    case 'finding.delegated': {
      const decision = str(d.decision);
      const what =
        decision === 'approve'
          ? str(d.kind) === 'change_requested'
            ? t(' dismissed ')
            : t(' approved ')
          : decision === 'request_changes'
            ? t(' asked for changes on ')
            : decision === 'leave'
              ? t(' left ')
              : t(' answered ');
      return say(
        what,
        finding(),
        ...on(),
        forPerson(),
        decision === 'leave' && forPerson() ? t(' to decide') : '',
        via()
      );
    }
    case 'finding.undone': {
      const was = str(d.via);
      return say(
        ...(was
          ? parts(t(" undid {who}'s decision on {finding}"), {
              who: was,
              finding: finding(),
            })
          : [t(' reopened '), finding()]),
        ...on(),
        via()
      );
    }
    case 'finding.taught':
      return say(
        ...(agentName
          ? [
              t(' taught '),
              agentName,
              t(' a rule from its '),
              findingOf(d.kind),
            ]
          : [t(' taught a reviewer a rule from a finding')]),
        ...on(),
        via()
      );
    case 'user.password_reset':
      return say(t(' set a new password with a reset link'), via());
    case 'instance.oidc_configuration':
      return say(
        t(' published the OIDC provider configuration for '),
        e.target,
        via()
      );
    case 'user.oidc_linked':
      return say(t(' linked an external identity through '), e.target, via());
    case 'user.oidc_signed_in':
      return say(t(' signed in through the OIDC provider '), e.target, via());
    case 'user.oidc_revoked':
      return say(
        t(' revoked an external identity binding for '),
        e.target,
        via()
      );
    case 'user.password_set':
      return say(t(' set a new password for '), e.target, via());
    case 'user.password_reset_link':
      return say(
        t(' created a password reset link for '),
        e.target,
        d.emailed === true && t(' and emailed it'),
        via()
      );
    case 'issue.deleted':
      return say(t(' deleted issue '), e.target, ...tail('in'), via());
    case 'issue.comment_deleted':
      return say(
        t(" deleted someone's comment on issue "),
        e.target,
        ...tail('in'),
        via()
      );
    case 'label.created':
      return say(
        t(' created the label “'),
        e.target,
        '”',
        ...tail('in'),
        via()
      );
    case 'label.updated':
      return say(t(' edited the label “'), e.target, '”', ...tail('in'), via());
    case 'label.deleted':
      return say(
        t(' deleted the label “'),
        e.target,
        '”',
        ...tail('in'),
        via()
      );
    case 'webhook.created':
      return say(t(' added a webhook for '), e.target, ...tail('in'), via());
    case 'webhook.updated':
      return say(t(' edited the webhook for '), e.target, ...tail('in'), via());
    case 'webhook.deleted':
      return say(
        t(' deleted the webhook for '),
        e.target,
        ...tail('in'),
        via()
      );
    case 'token.created':
      return say(t(' created the access token “'), e.target, '”', via());
    case 'token.deleted':
      return say(t(' deleted the access token “'), e.target, '”', via());
    case 'deploy_token.created':
      return say(
        t(' created the deploy token “'),
        e.target,
        '”',
        ...tail('in'),
        via()
      );
    case 'deploy_token.deleted':
      return say(
        t(' revoked the deploy token “'),
        e.target,
        '”',
        ...tail('in'),
        via()
      );
    case 'deploy_token.pushed':
      return say(
        t(' pushed with deploy token “{token}”', { token: e.target }),
        ...tail('in'),
        via()
      );
    case 'repository.created': {
      const visibility = str(d.visibility);
      return say(
        t(' created '),
        repoObject(),
        visibility && ' (',
        visibility && visibilityWord(visibility),
        visibility && ')',
        via()
      );
    }
    case 'repository.deleted':
      return say(t(' deleted '), e.target, via());
    case 'release.created':
      return say(
        t(' released '),
        e.target || t('a version'),
        ...tail('of'),
        via()
      );
    case 'release.updated': {
      const fields = Array.isArray(d.fields)
        ? d.fields.filter((f): f is string => f === 'title' || f === 'notes')
        : [];
      const fieldWords = fields.map((f) =>
        f === 'title' ? t('title') : t('notes')
      );
      return say(
        t(' edited '),
        fieldWords.length
          ? t('the {fields} of ', { fields: list(fieldWords) })
          : '',
        e.target ? t('release {tag}', { tag: e.target }) : t('release'),
        ...tail('in'),
        via()
      );
    }
    case 'pull.version_bump': {
      const from = str(d.from);
      const to = str(d.to);
      if (!to) return say(t(' cleared the version bump'), ...on(), via());
      return say(
        ...(from
          ? [
              t(' changed the version bump from '),
              from,
              t(' to {version}', { version: to }),
            ]
          : [t(' set the version bump to {version}', { version: to })]),
        ...on(),
        via()
      );
    }
    case 'instance.settings':
      return d.reset === true
        ? say(
            ...parts(
              t(' reset the instance setting {setting} to its default'),
              { setting: settingLabel(e.target) }
            ),
            via()
          )
        : say(
            ...parts(t(' changed the instance setting {setting}'), {
              setting: settingLabel(e.target),
            }),
            via()
          );
  }

  // The pull request timeline (`pull.<kind>`), merged into the same log.
  if (e.action.startsWith('pull.')) {
    const kind = e.action.slice('pull.'.length);
    const other = num(d.pr);
    switch (kind) {
      case 'state_changed': {
        const state = str(d.state);
        return say(
          t(' marked '),
          pull(),
          t(' as '),
          (state && STATE_PHRASE[state]) ?? state ?? t('changed')
        );
      }
      case 'stacked':
        return say(
          t(' stacked '),
          pull(),
          other !== null && t(' on '),
          other !== null && pull(other)
        );
      case 'unstacked':
        return say(
          t(' unstacked '),
          pull(),
          other !== null && t(' from '),
          other !== null && pull(other)
        );
      case 'ordered': {
        // Recorded on the pull request that lands later (`e.pull`); `before` lands first; `for_pr` is a third
        // pull request that builds on both.
        const before = num(d.before);
        const forPr = num(d.for_pr);
        return say(
          t(' set '),
          pull(),
          before !== null ? t(' to land after ') : t(' to land in order'),
          before !== null && pull(before),
          forPr !== null && forPr !== e.pull && t(', so '),
          forPr !== null && forPr !== e.pull && pull(forPr),
          forPr !== null && forPr !== e.pull && t(' can build on both')
        );
      }
      case 'must_account_for':
        return say(
          t(' flagged '),
          pull(),
          t(' as needing to account for '),
          pull(other)
        );
      case 'accounted_for':
        return say(t(' marked '), pull(), t(' as accounted for '), pull(other));
      case 'dismissed':
        return say(
          t(' dismissed the dependency of '),
          pull(),
          other !== null && t(' on '),
          other !== null && pull(other)
        );
      case 'withdrawn':
        return say(t(' withdrew their approval of '), pull());
      case 'learned': {
        const n = num(d.findings);
        return say(
          t(' learned from '),
          n ? tn(n, '{n} dismissed finding', '{n} dismissed findings') : '',
          n ? t(' on ') : '',
          pull()
        );
      }
      case 'rebased':
        return say(
          t(' rebased '),
          pull(),
          t(' onto {onto}', { onto: str(d.onto) ?? t('its base') })
        );
      default:
        return say(t(' recorded '), words(kind).join(' '), t(' on '), pull());
    }
  }

  // An action this build has not heard of: still one honest sentence.
  return say(` ${words(e.action).join(' ')}`, e.target ? ` ${e.target}` : '');
}

/** One event as a sentence: "mahmoud paused merging on octocat/cloudforge". */
export function auditText(e: AuditEvent, opts: AuditOptions = {}): string {
  return auditParts(e, opts)
    .map((p) => p.text)
    .join('');
}

/** A value from a settings change, as a few words. */
function show(v: unknown): string {
  if (v === null || v === undefined || v === '') return t('none');
  if (Array.isArray(v)) return v.length ? v.map(String).join(', ') : t('none');
  if (typeof v === 'boolean') return v ? t('on') : t('off');
  return String(v);
}

const UNDID: Record<string, string> = {
  approved: t('an approval'),
  dismissed: t('a dismissal'),
  changes_requested: t('a request for changes'),
};

/** The facts worth a second line (the finding, the reason, the note, what changed), or null for a plain event. */
export function auditDetail(e: AuditEvent): string | null {
  const d: Data = record(e.data) ?? {};
  const title = e.target ? `“${clip(e.target)}”` : null;
  const join = (...xs: (string | null | false)[]) => {
    const parts = xs.filter((x): x is string => !!x);
    return parts.length ? parts.join(SENTENCE_SEP) : null;
  };
  const labelled = (label: string, v: unknown) => {
    const s = str(v);
    return s ? `${label}: ${clip(s)}` : null;
  };
  switch (e.action) {
    case 'finding.approved':
      return join(title, labelled(t('Reason'), d.reason));
    case 'finding.changes_requested':
      return join(title, labelled(t('Note'), d.note));
    case 'finding.delegated':
      return join(title, labelled(t('Why'), d.reason));
    case 'finding.taught':
      return join(title, labelled(t('Taught'), d.teach));
    case 'finding.assigned':
      return join(title);
    case 'merging.paused':
      return labelled(t('Reason'), d.reason);
    case 'finding.undone': {
      const undid = str(d.undid);
      return join(title, undid && UNDID[undid] && t('Undid ') + UNDID[undid]);
    }
    case 'settings.changed': {
      const changes = record(d.changes);
      if (!changes) return null;
      const rows = Object.entries(changes).flatMap(([k, v]) => {
        const c = record(v);
        return c
          ? [
              `${SETTING_DETAIL[k] ?? cap(words(k).join(' '))}: ${clip(show(c.from), 60)} → ${clip(show(c.to), 60)}`,
            ]
          : [];
      });
      return rows.length ? rows.join(SENTENCE_SEP) : null;
    }
    case 'branches.cleaned': {
      const branches = Array.isArray(d.branches)
        ? d.branches.filter((b): b is string => typeof b === 'string')
        : [];
      return branches.length ? clip(branches.join(', '), 240) : null;
    }
    case 'instance.settings':
      return d.reset === true || d.value === undefined
        ? null
        : t('Now: {value}', { value: clip(show(d.value)) });
    case 'token.created':
    case 'deploy_token.created': {
      if (!('expiresAt' in d)) return null;
      const at = num(d.expiresAt);
      return at === null
        ? t('Never expires')
        : t('Expires {date}', {
            date: new Date(at).toISOString().slice(0, 10),
          });
    }
    case 'pull.merged':
      return d.automatic === true ? t('Merged automatically') : null;
    case 'issue.deleted': {
      const title = str(d.title);
      return title ? clip(title) : null;
    }
    case 'label.updated': {
      const name = record(d.name);
      const to = name && str(name.to);
      return to ? t('Renamed to “{name}”', { name: to }) : null;
    }
    case 'release.created': {
      const n = num(d.pulls);
      return n ? tn(n, '{n} pull request', '{n} pull requests') : null;
    }
    case 'pull.state_changed': {
      const reasons = Array.isArray(d.reasons)
        ? d.reasons.filter(
            (r): r is { kind: string } =>
              !!r && typeof (r as { kind?: unknown }).kind === 'string'
          )
        : [];
      const text = reasons
        .filter((r) => r.kind !== 'stacked_on' && r.kind !== 'waits_on')
        .map((r) => reasonText(r))
        .join(LIST_SEP);
      return text || null;
    }
    case 'pull.rebased': {
      const from = str(d.from);
      const to = str(d.to);
      return from && to ? `${from.slice(0, 7)} → ${to.slice(0, 7)}` : null;
    }
  }
  return null;
}

/** Where the event leads: its pull request or release, else its repository, else nowhere. */
export function auditLink(e: AuditEvent): string | null {
  if (!e.repo) return null;
  if (e.action.startsWith('release.') && e.target)
    return `/${e.repo}/releases/${encodeURIComponent(e.target)}`;
  if (e.action.startsWith('label.')) return `/${e.repo}/labels`;
  if (e.action.startsWith('webhook.')) return `/${e.repo}/settings`;
  if (e.action.startsWith('deploy_token.'))
    return `/${e.repo}/settings/deploy-tokens`;
  if (e.action === 'issue.deleted') return `/${e.repo}/issues`;
  const issue = /^#(\d+)$/.exec(e.target);
  if (e.action === 'issue.comment_deleted' && issue)
    return `/${e.repo}/issues/${issue[1]}`;
  return e.pull !== null ? `/${e.repo}/pull/${e.pull}` : `/${e.repo}`;
}

export type AuditCategory =
  'merging' | 'decisions' | 'access' | 'settings' | 'activity';

export const AUDIT_CATEGORIES: { id: AuditCategory; label: string }[] = [
  { id: 'merging', label: t('Merging') },
  { id: 'decisions', label: t('Decisions') },
  { id: 'access', label: t('Access and agents') },
  { id: 'settings', label: t('Settings') },
  { id: 'activity', label: t('Pull request activity') },
];

/** The filter an action belongs to. Pull request timeline entries (and anything new) are "activity". */
export function auditCategory(action: string): AuditCategory {
  switch (action) {
    case 'pull.merged':
    case 'pull.reverted':
    case 'release.created':
    case 'release.updated':
    case 'merging.paused':
    case 'merging.resumed':
    case 'branch.deleted':
    case 'branches.cleaned':
      return 'merging';
    case 'pull.approved':
    case 'pull.dismissed':
    case 'pull.withdrawn':
    case 'finding.approved':
    case 'finding.changes_requested':
    case 'finding.assigned':
    case 'finding.delegated':
    case 'finding.undone':
    case 'finding.taught':
      return 'decisions';
    case 'collaborator.added':
    case 'collaborator.removed':
    case 'agent.invited':
    case 'agent.removed':
    case 'agent.created':
    case 'agent.deleted':
    case 'agent.restored':
    case 'token.created':
    case 'token.deleted':
    case 'deploy_token.created':
    case 'deploy_token.deleted':
    case 'deploy_token.pushed':
    case 'visibility.changed':
    case 'user.password_reset':
    case 'user.password_reset_link':
    case 'user.password_set':
      return 'access';
    case 'instance.oidc_configuration':
    case 'user.oidc_linked':
    case 'user.oidc_revoked':
      return 'access';
    case 'user.oidc_signed_in':
      return 'access';
    case 'settings.changed':
    case 'instance.settings':
    case 'repository.created':
    case 'repository.deleted':
    case 'artifact.deleted':
    case 'secret.saved':
    case 'secret.deleted':
    case 'secret.repositories':
    case 'variable.saved':
    case 'variable.deleted':
    case 'issue.deleted':
    case 'issue.comment_deleted':
    case 'label.created':
    case 'label.updated':
    case 'label.deleted':
    case 'webhook.created':
    case 'webhook.updated':
    case 'webhook.deleted':
      return 'settings';
    default:
      return 'activity';
  }
}
