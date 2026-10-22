import { lang, t } from './i18n';

/**
 * The seven reviewer presets' own English text (worker/src/agents/presets.ts), by handle. An agent made from a
 * preset keeps that text in its AGENT.md, so the API sends it in English whatever the interface language.
 */
export const PRESET_TEXT: Record<
  string,
  { name: string; bio: string; ask: string }
> = {
  securityagent: {
    name: 'Security',
    bio: 'Makes sure nobody gets in who shouldn’t, and nothing leaks.',
    ask: 'Could this change affect security: authentication, sessions, tokens, permissions or who can see what, user input reaching HTML, SQL, shell or URLs, secrets, file serving, or outbound requests?',
  },
  dataagent: {
    name: 'Data',
    bio: 'Makes sure your saved data survives every change.',
    ask: 'Does this change how data is stored: the database schema, a migration, what columns or JSON fields hold, or how existing rows are read or rewritten?',
  },
  speedagent: {
    name: 'Speed',
    bio: 'Watches how fast your app loads and answers.',
    ask: 'Could this change make a page or request slower: queries, loops over data, bundle size, images or caching?',
  },
  featuresagent: {
    name: 'Features',
    bio: 'Notices when something people use is removed or broken.',
    ask: 'Does this change what people or agents can do with the product: remove, rename or change a page, route, API field, MCP tool, setting or behaviour, or add a new one?',
  },
  reliabilityagent: {
    name: 'Reliability',
    bio: 'Checks what happens when something goes wrong.',
    ask: 'Does this change how failures are handled: errors, retries, timeouts, queues or calls to other services?',
  },
  privacyagent: {
    name: 'Privacy',
    bio: 'Keeps people’s personal details private.',
    ask: 'Does this change collect, store, log, share or delete personal information about people?',
  },
  shippingagent: {
    name: 'Shipping',
    bio: 'Lists what must happen before a change goes live.',
    ask: 'Will deploying this change need anything beyond a normal deploy: a migration, a new or changed binding, secret or environment variable, a dependency change, or a specific deploy order?',
  },
};

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** One object: a preset agent (or the preset itself) gets its default name, bio and trigger question translated. */
function localizeOne(o: Json, tr: (english: string) => string) {
  const id = typeof o.username === 'string' ? o.username : o.handle;
  const p = typeof id === 'string' ? PRESET_TEXT[id.toLowerCase()] : undefined;
  if (!p) return;
  // Only the preset's own words: a name or bio someone wrote in AGENT.md is shown as written.
  if (o.name === p.name) o.name = tr(p.name);
  if (o.displayName === p.name) o.displayName = tr(p.name);
  if (o.bio === p.bio) o.bio = tr(p.bio);
  if (o.triggerAsk === p.ask) o.triggerAsk = tr(p.ask);
  if (isObject(o.trigger) && o.trigger.ask === p.ask) o.trigger.ask = tr(p.ask);
}

/** localizeAgents with the translation given (for tests): walks `body` in place and returns it. */
export function localizeAgentsWith<T>(
  body: T,
  tr: (english: string) => string
): T {
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (isObject(v)) {
      localizeOne(v, tr);
      for (const k in v) {
        const child = v[k];
        if (typeof child === 'object' && child !== null) walk(child);
      }
    }
  };
  walk(body);
  return body;
}

/**
 * In Chinese, translates the preset reviewer agents' default name, bio and trigger question wherever an API
 * response carries them (agent lists, profiles, presets, reviewers on pull requests, commit authors…). Works in
 * place on freshly parsed JSON and returns it; does nothing in English.
 */
export function localizeAgents<T>(body: T): T {
  return lang === 'zh' ? localizeAgentsWith(body, (s) => t(s)) : body;
}
