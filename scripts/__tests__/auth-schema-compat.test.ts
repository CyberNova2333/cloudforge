// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import { describe, expect, it } from 'vitest';
import type { BetterAuthOptions, BetterAuthPlugin } from 'better-auth';
import { oauthProvider } from '@better-auth/oauth-provider';
import { twoFactor } from 'better-auth/plugins/two-factor';
import { generateDrizzleSchema, type DBAdapter } from 'auth/api';
import {
  createSourceFile,
  isCallExpression,
  isObjectLiteralExpression,
  isPropertyAssignment,
  isVariableStatement,
  ScriptTarget,
} from 'typescript';
import { authSchemaCompatibilityOptions } from '../auth-schema-compat';

function options(): BetterAuthOptions {
  const factors: BetterAuthPlugin = twoFactor();
  // The project's custom factor plugin already enforces one factor row per user.
  factors.schema!.twoFactor.fields.userId.unique = true;
  return {
    plugins: [
      { id: 'untouched', schema: { example: { fields: {} } } },
      oauthProvider({
        loginPage: '/login',
        consentPage: '/oauth/consent',
        enforcePerClientResources: false,
      }),
      factors,
    ],
    rateLimit: { storage: 'database' },
  };
}

// The documented generator API reads adapter metadata, without any database I/O.
const noDatabaseIO = async () => {
  throw new Error('Schema generation must not access a database.');
};
const adapter: DBAdapter = {
  id: 'drizzle',
  options: {
    provider: 'sqlite',
    adapterConfig: { adapterId: 'drizzle', usePlural: true },
  },
  create: noDatabaseIO,
  findOne: noDatabaseIO,
  findMany: noDatabaseIO,
  count: noDatabaseIO,
  update: noDatabaseIO,
  updateMany: noDatabaseIO,
  delete: noDatabaseIO,
  deleteMany: noDatabaseIO,
  consumeOne: noDatabaseIO,
  incrementOne: noDatabaseIO,
  transaction: noDatabaseIO,
};

async function generatedColumns(input: BetterAuthOptions) {
  const generated = await generateDrizzleSchema({ options: input, adapter });
  const source = createSourceFile(
    'schema.ts',
    generated.code!,
    ScriptTarget.Latest,
    true
  );
  const columns: Record<string, Record<string, string>> = {};
  for (const statement of source.statements) {
    if (!isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      const initializer = declaration.initializer;
      if (!initializer || !isCallExpression(initializer)) continue;
      const fields = initializer.arguments[1];
      if (!fields || !isObjectLiteralExpression(fields)) continue;
      columns[declaration.name.getText(source)] = Object.fromEntries(
        fields.properties
          .filter(isPropertyAssignment)
          .map((field) => [
            field.name.getText(source),
            field.initializer.getText(source),
          ])
      );
    }
  }
  return { columns, code: generated.code! };
}

describe('认证生成工具的已部署列兼容边界', () => {
  it('真实新版生成器只保留七个旧nullable和无默认列，不丢复合unique及新版关系', async () => {
    const runtime = options();
    const before = await generatedColumns(runtime);
    const profile = authSchemaCompatibilityOptions(runtime);
    const after = await generatedColumns(profile);
    const expected = [
      'oauthRefreshTokens.expiresAt',
      'oauthRefreshTokens.createdAt',
      'oauthAccessTokens.token',
      'oauthAccessTokens.expiresAt',
      'oauthAccessTokens.createdAt',
      'oauthConsents.createdAt',
      'oauthConsents.updatedAt',
      'oauthClients.clientCredentialsScopes',
    ].sort();
    const changed: string[] = [];
    for (const [table, fields] of Object.entries(before.columns))
      for (const [field, value] of Object.entries(fields))
        if (after.columns[table][field] !== value)
          changed.push(`${table}.${field}`);
    expect(changed.sort()).toEqual(expected);
    for (const name of expected
      .slice()
      .filter((name) => !name.endsWith('Scopes'))) {
      const [table, field] = name.split('.');
      expect(before.columns[table][field]).toContain('.notNull()');
      expect(after.columns[table][field]).not.toContain('.notNull()');
    }
    expect(after.columns.oauthAccessTokens.token).toContain('.unique()');
    expect(after.columns.oauthClients.clientCredentialsScopes).not.toContain(
      '.default('
    );
    expect(after.code).toContain(
      'uniqueIndex("oauthClientResources_clientId_resourceId_uidx")'
    );
    expect(after.code).toMatch(/table\.clientId,\s*table\.resourceId/);
    expect(after.code).toContain('oauthClient: one(oauthClients');
    expect(after.code).toContain('twoFactors: one(twoFactors)');
  });

  it('不修改原运行时选项，其他插件和字段仍保持其原始约束', () => {
    const runtime = options();
    const provider = runtime.plugins![1];
    const original = structuredClone(provider.schema);
    const profile = authSchemaCompatibilityOptions(runtime);
    expect(profile).not.toBe(runtime);
    expect(profile.plugins).not.toBe(runtime.plugins);
    expect(profile.plugins![0]).toBe(runtime.plugins![0]);
    expect(profile.plugins![1]).not.toBe(provider);
    expect(provider.schema).toEqual(original);
    expect(profile.plugins![1].schema!.oauthRefreshToken.fields.userId).toBe(
      provider.schema!.oauthRefreshToken.fields.userId
    );
    expect(
      provider.schema!.oauthAccessToken.fields.token.required
    ).toBeUndefined();
    expect(
      provider.schema!.oauthClient.fields.clientCredentialsScopes.defaultValue
    ).toEqual([]);
  });

  it.each([
    'missing',
    'duplicate',
    'required',
    'type',
    'new-attribute',
    'default',
    'index',
  ])('上游目标声明意外变化时拒绝生成：%s', (change) => {
    const runtime = options();
    const provider = runtime.plugins![1];
    if (change === 'missing') runtime.plugins = [runtime.plugins![0]];
    if (change === 'duplicate')
      runtime.plugins = [...runtime.plugins!, provider];
    if (change === 'required')
      provider.schema!.oauthRefreshToken.fields.expiresAt.required = true;
    if (change === 'type')
      provider.schema!.oauthRefreshToken.fields.expiresAt.type = 'number';
    if (change === 'new-attribute')
      provider.schema!.oauthRefreshToken.fields.expiresAt.input = false;
    if (change === 'default')
      provider.schema!.oauthClient.fields.clientCredentialsScopes.defaultValue =
        ['new'];
    if (change === 'index') provider.schema!.oauthClientResource.indexes = [];
    expect(() => authSchemaCompatibilityOptions(runtime)).toThrow(
      /Expected|Unexpected/
    );
  });
});
