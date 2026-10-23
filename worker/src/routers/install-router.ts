// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSE).
import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { schema } from '../db/schema';
import type { AppEnv } from '../variables';

/** Public: what `yarn cloudforge install` reads to recognise an existing installation. Never the nonce. */
export const installRouter = new Hono<AppEnv>();

function installationIdOf(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const id = (JSON.parse(raw) as { installationId?: unknown }).installationId;
    return typeof id === 'string' && id ? id : null;
  } catch {
    return null;
  }
}

function schemaDigestOf(manifestJson: string | null | undefined) {
  if (!manifestJson) return null;
  try {
    const d = (JSON.parse(manifestJson) as { schemaDigest?: unknown })
      .schemaDigest;
    return typeof d === 'string' ? d : null;
  } catch {
    return null;
  }
}

installRouter.get('/.well-known/cloudforge', async (c) => {
  const installationId = installationIdOf(c.env.CLOUDFORGE_INSTALLATION);
  let schemaDigest: string | null = null;
  if (installationId) {
    const row = await drizzle(c.env.DB, { schema })
      .select({ manifestJson: schema.installState.manifestJson })
      .from(schema.installState)
      .where(eq(schema.installState.installationId, installationId))
      .get();
    schemaDigest = schemaDigestOf(row?.manifestJson);
  }
  return c.json({
    installationId,
    version: c.env.CLOUDFORGE_VERSION || null,
    schemaDigest,
  });
});
