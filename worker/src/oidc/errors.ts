// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of CloudForge and is licensed under GNU AGPLv3 with Additional Terms (see LICENSE and LICENSE-ADDITIONAL_TERMS-zh-CN.md; ref: LICENSE-ADDITIONAL_TERMS-en.md).
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
