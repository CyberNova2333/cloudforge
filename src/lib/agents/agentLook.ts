// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
/**
 * How reviewer agents look: their colour, head shape, status words and what their robot avatar does.
 *
 * The avatar is `agent-robot-avatar` 0.5.x, bundled from npm. The mockup used 0.3.2 from a CDN; every attribute
 * and method it used still exists unchanged in 0.5.x (`size`, `color`, `auto-sleep`, `wake-on`, `motion`;
 * `play()`, `input()`, `startWaiting()`/`stopWaiting()`, `sleep()`/`wake()`, `reset()`, `setPointerFollow()`,
 * `setHeadRoundness()`), so nothing is renamed. Two differences:
 * - The mockup's `data-state` attribute was its own bookkeeping, not the element's; `AgentAvatar` drives the
 *   element from `avatarScript` instead.
 * - 0.4 added press-and-hold squeezing and antenna dragging (on by default). They are playful, so `AgentAvatar`
 *   turns both off (`press-squeeze="false"`, `antenna-drag="false"`), which keeps the mockup's behaviour.
 */
import { t } from '../i18n/i18n';
import { fnv1a } from '../ui/identicon';
import type { ReviewerStatus } from '../api/uiApi';

/** The validated agent palette, in its categorical order (Clef, Fixer, then the seven facets). */
export const AGENT_PALETTE = [
  '#0C5CAB',
  '#0a4a8a',
  '#397db9',
  '#538ec2',
  '#71a5d1',
  '#97bddf',
  '#164574',
  '#225b94',
  '#626263',
] as const;

type Preset = { color: string; round: number };
/** Built-ins and presets by handle. Round 0–100: squarer heads check rules, rounder heads weigh judgement. */
const CLEF: Preset = { color: '#0C5CAB', round: 100 };
const FIXER: Preset = { color: '#0a4a8a', round: 70 };
const SECURITY: Preset = { color: '#397db9', round: 15 };
const DATA: Preset = { color: '#538ec2', round: 45 };
const SPEED: Preset = { color: '#71a5d1', round: 85 };
const FEATURES: Preset = { color: '#97bddf', round: 60 };
const RELIABILITY: Preset = { color: '#164574', round: 30 };
const PRIVACY: Preset = { color: '#225b94', round: 95 };
const SHIPPING: Preset = { color: '#626263', round: 5 };
const PRESETS: Record<string, Preset> = {
  clef: CLEF,
  fixer: FIXER,
  securityagent: SECURITY,
  dataagent: DATA,
  speedagent: SPEED,
  // The live Features agent is @featureagent; a preset named after its facet is @featuresagent.
  featureagent: FEATURES,
  featuresagent: FEATURES,
  reliabilityagent: RELIABILITY,
  privacyagent: PRIVACY,
  shippingagent: SHIPPING,
};

const normal = (handle: string) =>
  handle.trim().replace(/^@/, '').toLowerCase();
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** The agent's colour: the one it declares (AGENT.md), else its preset's, else a stable hash into the palette. */
export function agentColor(handle: string, color?: string | null): string {
  if (color && HEX.test(color)) return color;
  const h = normal(handle);
  return PRESETS[h]?.color ?? AGENT_PALETTE[fnv1a(h) % AGENT_PALETTE.length];
}

/** Head roundness (0 square – 100 round) for `setHeadRoundness`; 50 for agents without a preset. */
export function agentRoundness(handle: string): number {
  return PRESETS[normal(handle)]?.round ?? 50;
}

/** Everything a caller may know about an agent's status: a reviewer row's status or a crew state. */
export type AgentStatus =
  ReviewerStatus | 'idle' | 'needs' | 'running' | 'learned' | 'off';

/** The crew states the interface draws. */
export type AgentState =
  | 'clear'
  | 'needs'
  | 'asked'
  | 'reviewing'
  | 'running'
  | 'learned'
  | 'skipped'
  | 'off'
  | 'failed'
  | 'idle';

const STATE_OF: Record<AgentStatus, AgentState> = {
  approved: 'clear',
  flagged: 'needs',
  needs: 'needs',
  changes_requested: 'asked',
  reviewing: 'reviewing',
  running: 'running',
  learned: 'learned',
  not_needed: 'skipped',
  off: 'off',
  failed: 'failed',
  idle: 'idle',
};

export function agentState(status: AgentStatus): AgentState {
  return STATE_OF[status] ?? 'idle';
}

/** Status pill tones (`.chip.<tone>`, `.verdict.<tone>`). */
export type Tone = 'good' | 'warn' | 'serious' | 'critical' | 'info' | 'off';

/** Words and tone for each state: chips always carry the label, so colour is never the only signal. */
export const STATE_LOOK: Record<AgentState, { label: string; tone: Tone }> = {
  clear: { label: t('Passed'), tone: 'good' },
  needs: { label: t('Needs a person'), tone: 'warn' },
  asked: { label: t('Changes requested'), tone: 'serious' },
  reviewing: { label: t('Checking'), tone: 'info' },
  running: { label: t('Working'), tone: 'info' },
  learned: { label: t('Rule saved'), tone: 'good' },
  skipped: { label: t('Not needed'), tone: 'off' },
  off: { label: t('Off for this project'), tone: 'off' },
  failed: { label: t('Review failed'), tone: 'critical' },
  idle: { label: t('Ready'), tone: 'off' },
};

/** What the avatar shows, named after the element's action or method (spec, "Agent avatar"). */
export type AvatarState =
  | 'success'
  | 'input'
  | 'send'
  | 'inspect'
  | 'startWaiting'
  | 'surprise'
  | 'sleep'
  | 'error'
  | 'idle';

const AVATAR_OF: Record<AgentState, AvatarState> = {
  clear: 'success',
  needs: 'input',
  asked: 'send',
  reviewing: 'inspect',
  running: 'startWaiting',
  learned: 'surprise',
  skipped: 'sleep',
  off: 'sleep',
  // Not in the spec's table: a review that could not run is a system failure, which the element calls `error`.
  failed: 'error',
  idle: 'idle',
};

export function avatarState(status: AgentStatus): AvatarState {
  return AVATAR_OF[agentState(status)];
}

/** Element actions `AgentAvatar` plays (a subset of `agent-robot-avatar`'s `AgentRobotAvatarAction`). */
export type AvatarAction =
  'success' | 'send' | 'inspect' | 'surprise' | 'error';

/**
 * How to drive the element for a state: `hold` keeps an expression (`input(true)` or `startWaiting()`), `play`
 * runs actions in order, `sleep` puts it to sleep; an empty script resets it to idle.
 */
export interface AvatarScript {
  hold?: 'input' | 'waiting';
  play?: AvatarAction[];
  sleep?: true;
}

export function avatarScript(state: AvatarState): AvatarScript {
  switch (state) {
    case 'input':
      return { hold: 'input' };
    case 'startWaiting':
      return { hold: 'waiting' };
    case 'surprise':
      return { play: ['surprise', 'send'] };
    case 'sleep':
      return { sleep: true };
    case 'idle':
      return {};
    default:
      return { play: [state] };
  }
}

/** States that draw the moving ring around the halo: checking, waiting on a person, working. */
export function avatarIsLive(state: AvatarState): boolean {
  return state === 'inspect' || state === 'input' || state === 'startWaiting';
}
