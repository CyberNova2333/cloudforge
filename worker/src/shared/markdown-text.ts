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
