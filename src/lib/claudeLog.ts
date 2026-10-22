/**
 * Sentences for GitOrange AI's answers ("Let Claude decide", shown as Claude) and for one finding's history.
 * A small local stand-in until the shared audit sentences (`auditText.ts`, crew redesign C12) land; the final
 * review may fold these into it.
 */
import { lang, t } from './i18n';
import { withVia } from './via';
import type { AuditEvent, DelegatedEvent, PersonRef } from './uiApi';

/** How GitOrange AI's decisions are recorded (`decidedVia`, `audit.via`). */
export const AI_VIA = 'GitOrange AI';
/** What the interface calls GitOrange AI. */
export const AI_NAME = 'Claude';

export const isAiVia = (via: string | null | undefined) => via === AI_VIA;

/** "Data’s", "Features’" ("Data 的" in Chinese). */
export function possessive(name: string): string {
  if (lang === 'zh') return `${name} 的`;
  return /s$/i.test(name) ? `${name}’` : `${name}’s`;
}

/** The time of day an event happened, as "09:05" (the viewer's clock). */
export function clockTime(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** One line of "What Claude did today". */
export function delegatedText(e: DelegatedEvent, agentName: string): string {
  const vars = {
    ai: AI_NAME,
    whose: possessive(agentName),
    pr: `#${e.pull ?? '?'}`,
  };
  switch (e.data.decision) {
    case 'approve':
      return t('{ai} approved {whose} finding on {pr}', vars);
    case 'request_changes':
      return t('{ai} requested changes on {pr} for {whose} finding', vars);
    default:
      return t('{ai} left {whose} finding on {pr} for you', vars);
  }
}

const same = (a: string | null | undefined, b: string | null | undefined) =>
  !!a && !!b && a.toLowerCase() === b.toLowerCase();

/** A person as the sentence names them: "you", their name, or @login. */
function named(
  p: { login: string | null; name: string | null } | null,
  me: string | null
): string {
  if (!p || (!p.login && !p.name)) return t('someone');
  if (same(p.login, me)) return t('you');
  return p.name || `@${p.login}`;
}

/** Who made a decision: "you", "Cho", "Cho via Claude Mod", or "Claude for you". */
export function decidedByText(
  by: PersonRef | null,
  via: string | null,
  me: string | null
): string {
  const who = named(by, me);
  if (isAiVia(via)) return t('{ai} for {who}', { ai: AI_NAME, who });
  return withVia(who, via);
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** Ends `s` like a sentence, with the language's full stop. */
const sentence = (s: string) =>
  /[.!?”"。！？]$/.test(s) ? s : `${s}${lang === 'zh' ? '。' : '.'}`;
const str = (v: unknown) =>
  typeof v === 'string' && v.trim() ? v.trim() : null;

/** What an undo took back, by the decision it undid. */
function undid(kind: string): string {
  switch (kind) {
    case 'approved':
      return t('approval');
    case 'dismissed':
      return t('dismissal');
    case 'changes_requested':
      return t('request for changes');
    default:
      return t('decision');
  }
}

/** One entry of a finding's history, as a sentence. */
export function findingEventText(
  e: AuditEvent,
  ctx: { me: string | null; agentName: string }
): string {
  const actor =
    e.actor.kind === 'system' ? 'GitOrange' : capital(named(e.actor, ctx.me));
  const who = isAiVia(e.via) ? actor : withVia(actor, e.via);
  const forWhom = named(e.actor, ctx.me);
  const d = e.data;
  switch (e.action) {
    case 'finding.approved': {
      const reason = str(d.reason);
      const dismissed = d.kind === 'change_requested';
      return sentence(
        reason
          ? dismissed
            ? t('{who} dismissed it. Reason: {reason}', { who, reason })
            : t('{who} approved it. Reason: {reason}', { who, reason })
          : dismissed
            ? t('{who} dismissed it', { who })
            : t('{who} approved it', { who })
      );
    }
    case 'finding.changes_requested': {
      const note = str(d.note);
      return note
        ? t('{who} requested changes: “{note}”', { who, note })
        : t('{who} requested changes.', { who });
    }
    case 'finding.assigned': {
      const to = str(d.assignee);
      if (!to) return t('{who} took the question back.', { who });
      return t('{who} asked {whom} to decide.', {
        who,
        whom: same(to, ctx.me) ? t('you') : `@${to}`,
      });
    }
    case 'finding.delegated': {
      const reason = str(d.reason);
      const vars = { ai: AI_NAME, whom: forWhom };
      const what =
        d.decision === 'approve'
          ? t('{ai} approved it for {whom}', vars)
          : d.decision === 'request_changes'
            ? t('{ai} requested changes for {whom}', vars)
            : t('{ai} left it for {whom}', vars);
      return sentence(reason ? t('{what}: {reason}', { what, reason }) : what);
    }
    case 'finding.undone': {
      const thing = undid(String(d.undid));
      return isAiVia(str(d.via))
        ? t('{who} undid {whose} {thing}.', {
            who,
            whose: possessive(AI_NAME),
            thing,
          })
        : t('{who} undid the {thing}.', { who, thing });
    }
    case 'finding.taught': {
      const teach = str(d.teach);
      return teach
        ? t('{who} taught {agent}: “{teach}”', {
            who,
            agent: ctx.agentName,
            teach,
          })
        : t('{who} taught {agent}.', { who, agent: ctx.agentName });
    }
    default:
      return sentence(t('{who}: {action}', { who, action: e.action }));
  }
}
