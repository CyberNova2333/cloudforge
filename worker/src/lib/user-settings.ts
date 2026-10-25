import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { userPreferences } from '../db/app.schema';
import type { DrizzleDB } from '../db/middleware';

/**
 * A person's own settings (Settings → …), kept with their account in `user_preferences`, one row per key: the
 * personal twin of instance settings (lib/settings.ts). To add a setting, add a key here — no migration. A
 * missing row, or one that no longer validates (the rules changed), reads as the default; saving the default
 * removes the row.
 */
export const USER_SETTINGS = {
  /** Interface language; null follows the instance default (Site admin → Settings), then the browser. */
  language: {
    schema: z.enum(['zh', 'en']).nullable(),
    default: null,
  },
  /** Which notifications also arrive by email (docs/notifications.md). */
  notificationEmail: {
    schema: z.enum(['participating', 'all', 'off']),
    default: 'participating',
  },
} as const satisfies Record<string, { schema: z.ZodType; default: unknown }>;

export type UserSettingKey = keyof typeof USER_SETTINGS;
export type UserSettings = {
  [K in UserSettingKey]: z.infer<(typeof USER_SETTINGS)[K]['schema']>;
};

const KEYS = Object.keys(USER_SETTINGS) as UserSettingKey[];

/** Every personal setting of `userId`, each falling back to its default. One query. */
export async function getUserSettings(
  db: DrizzleDB,
  userId: string
): Promise<UserSettings> {
  const rows = await db
    .select({ key: userPreferences.key, value: userPreferences.value })
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .all();
  const out: Record<string, unknown> = {};
  for (const key of KEYS) {
    const def = USER_SETTINGS[key];
    const row = rows.find((r) => r.key === key);
    const parsed = row ? def.schema.safeParse(row.value) : null;
    out[key] = parsed?.success ? parsed.data : def.default;
  }
  return out as UserSettings;
}

/** Saves the settings in `patch` (others are left alone). Throws a ZodError for a value that doesn't validate. */
export async function setUserSettings(
  db: DrizzleDB,
  userId: string,
  patch: Partial<UserSettings>
): Promise<void> {
  const updatedAt = new Date();
  for (const key of KEYS) {
    if (!(key in patch)) continue;
    const def = USER_SETTINGS[key];
    const value = def.schema.parse(patch[key]);
    const row = and(
      eq(userPreferences.userId, userId),
      eq(userPreferences.key, key)
    );
    if (value === def.default) {
      await db.delete(userPreferences).where(row);
      continue;
    }
    await db
      .insert(userPreferences)
      .values({ userId, key, value, updatedAt })
      .onConflictDoUpdate({
        target: [userPreferences.userId, userPreferences.key],
        set: { value, updatedAt },
      });
  }
}
