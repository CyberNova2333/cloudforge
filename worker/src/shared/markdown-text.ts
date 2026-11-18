// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of CloudForge and is licensed under GNU AGPLv3 with Additional Terms (see LICENSE and ADDITIONAL_TERMS.zh-CN.md; ref: ADDITIONAL_TERMS.en.md).
// Markdown read as plain text, for finding references (`#12`, `@ada`) in what people wrote.

/** Markdown without its fenced code blocks and inline code: a `#12` or `@ada` inside them is code, not a reference. */
export function withoutCode(text: string): string {
  return text
    .replace(
      /^ {0,3}(```|~~~)[^\n]*\n[\s\S]*?(?:^ {0,3}\1[^\n]*$|(?![\s\S]))/gm,
      ' '
    )
    .replace(/(`+)[\s\S]*?\1/g, ' ');
}
