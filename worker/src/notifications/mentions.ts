// `@username` in an issue's or pull request's text and comments (docs/notifications.md): who is named. Never inside
// code, a word or an email address.
import { withoutCode } from '../shared/markdown-text';

/** Names read from one text; more are ignored. */
const MAX_MENTIONS = 50;

const MENTION =
  /(?:^|[^\w@/.`-])@([a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38})(?![\w/-])/g;

/** The usernames `text` mentions, lower-cased, each once, in order. */
export function mentionedUsernames(text: string): string[] {
  const found = new Set<string>();
  for (const m of withoutCode(text).matchAll(MENTION)) {
    found.add(m[1].toLowerCase());
    if (found.size >= MAX_MENTIONS) break;
  }
  return [...found];
}
