// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of CloudForge and is licensed under GNU AGPLv3 with Additional Terms (see LICENSE and LICENSE-ADDITIONAL_TERMS-zh-CN.md; ref: LICENSE-ADDITIONAL_TERMS-en.md).
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
