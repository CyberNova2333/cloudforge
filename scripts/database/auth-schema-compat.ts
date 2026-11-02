// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import type { BetterAuthOptions, BetterAuthPlugin } from 'better-auth';

/**
 * Preserve the deployed OAuth column constraints while replacing the retired CLI.
 * This is a generation-only profile, never a runtime authentication configuration.
 * The new CLI treats an omitted `required` as true; the old CLI left these seven
 * columns nullable. Tightening them or adding a JSON default would rebuild populated
 * D1 tables and needs its own data and foreign-key migration design.
 * Compound uniqueness and new relation names are deliberately retained.
 */
export function authSchemaCompatibilityOptions(
  options: BetterAuthOptions
): BetterAuthOptions {
  const providers = options.plugins?.filter(
    (plugin) => plugin.id === 'oauth-provider'
  );
  if (providers?.length !== 1 || !providers[0].schema)
    throw new Error(
      'Expected exactly one OAuth provider schema for generation.'
    );

  const provider = providers[0];
  const schema = { ...provider.schema };
  const nullable = {
    oauthRefreshToken: { expiresAt: 'date', createdAt: 'date' },
    oauthAccessToken: {
      token: 'string',
      expiresAt: 'date',
      createdAt: 'date',
    },
    oauthConsent: { createdAt: 'date', updatedAt: 'date' },
  } as const;

  // Refuse upstream changes to an overridden field instead of silently dropping
  // a new constraint or behavior. Fields outside this exact list pass through.
  function expectField(
    model: string,
    field: string,
    expected: Record<string, unknown>
  ) {
    const current = schema[model]?.fields[field];
    if (
      !current ||
      Object.keys(current).length !== Object.keys(expected).length ||
      Object.entries(expected).some(
        ([key, value]) =>
          JSON.stringify(current[key as keyof typeof current]) !==
          JSON.stringify(value)
      )
    )
      throw new Error(`Unexpected OAuth schema field ${model}.${field}.`);
    return current;
  }

  for (const [model, fields] of Object.entries(nullable)) {
    schema[model] = {
      ...schema[model],
      fields: { ...schema[model].fields },
    };
    for (const [field, type] of Object.entries(fields)) {
      const expected =
        model === 'oauthAccessToken' && field === 'token'
          ? { type, unique: true }
          : { type };
      const current = expectField(model, field, expected);
      schema[model].fields[field] = { ...current, required: false };
    }
  }

  const scopes = expectField('oauthClient', 'clientCredentialsScopes', {
    type: 'string[]',
    required: false,
    defaultValue: [],
  });
  const { defaultValue: _defaultValue, ...deployedScopes } = scopes;
  schema.oauthClient = {
    ...schema.oauthClient,
    fields: {
      ...schema.oauthClient.fields,
      clientCredentialsScopes: deployedScopes,
    },
  };

  if (
    !schema.oauthClientResource?.indexes?.some(
      (index) =>
        index.unique === true &&
        index.fields.length === 2 &&
        index.fields[0] === 'clientId' &&
        index.fields[1] === 'resourceId'
    )
  )
    throw new Error('Expected OAuth client/resource compound uniqueness.');

  const generationProvider: BetterAuthPlugin = { ...provider, schema };
  return {
    ...options,
    plugins: options.plugins?.map((plugin) =>
      plugin === provider ? generationProvider : plugin
    ),
  };
}
