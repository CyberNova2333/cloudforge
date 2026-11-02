// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { auth as runtimeAuth } from '../../worker/src/auth/index';
import { authSchemaCompatibilityOptions } from './auth-schema-compat';

// CLI generate consumes only `options`. Deliberately expose no handler or context:
// the compatibility profile must never be served as a runtime auth instance.
export const auth = {
  options: authSchemaCompatibilityOptions(runtimeAuth.options),
};
