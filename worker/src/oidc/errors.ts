/** Public protocol failures never contain provider responses, tokens or deployment secrets. */
export class OidcError extends Error {
  constructor(
    public readonly code: string,
    public readonly status = 400
  ) {
    super(
      'The identity request could not be completed. Start again or contact an administrator.'
    );
    this.name = 'OidcError';
  }
}
