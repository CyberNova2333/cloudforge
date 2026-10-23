/** Only an internal path can be used after sign-in, including after URL normalization. */
export function safeReturnTo(value: string | null): string {
  if (
    !value?.startsWith('/') ||
    value.startsWith('//') ||
    /[\\\u0000-\u0020\u007f]/.test(value)
  )
    return '/';
  try {
    const base = 'https://return-to.invalid';
    const url = new URL(value, base);
    if (url.origin !== base || url.pathname.startsWith('//')) return '/';
    return url.pathname + url.search + url.hash;
  } catch {
    return '/';
  }
}
