import { OpenAPIHono, z } from '@hono/zod-openapi';
import { requireAdmin } from '../guards';
import { applyPolicy, previewPolicy } from '../policy-management';
import { readPolicy } from '../policy';
import type { AppEnv } from '../../variables';
import { RECENT_AUTHENTICATION_REQUIRED } from '../recent';

export const authenticationPolicyRouter = new OpenAPIHono<AppEnv>();
authenticationPolicyRouter.use('*', requireAdmin);
authenticationPolicyRouter.use('*', async (c, next) => {
  c.header('Cache-Control', 'no-store');
  await next();
});
authenticationPolicyRouter.get('/', async (c) =>
  c.json({ policy: await readPolicy(c.env) })
);
authenticationPolicyRouter.post('/preview', async (c) => {
  const parsed = z
    .object({ requireMfa: z.boolean() })
    .strict()
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success)
    return c.json({ error: 'Choose whether MFA is required.' }, 400);
  const browser = c.get('browserSession');
  if (!browser) return c.json({ error: 'Unauthorized' }, 401);
  const policy = await readPolicy(c.env);
  if (policy.requireMfa === parsed.data.requireMfa)
    return c.json({ error: 'The policy already has that value.' }, 409);
  if (!browser.policy.enrolled)
    return c.json(
      {
        code: 'MFA_ENROLLMENT_REQUIRED',
        error:
          'Set up two-factor authentication before changing the instance policy.',
      },
      403
    );
  const preview = await previewPolicy(
    c.env,
    browser.id,
    c.get('user')!.id,
    parsed.data.requireMfa
  );
  if (!preview)
    return c.json(
      {
        code: RECENT_AUTHENTICATION_REQUIRED,
        sessionId: browser.id,
        error: 'Verify your password and second factor again.',
      },
      403
    );
  return c.json(preview);
});
authenticationPolicyRouter.post('/apply', async (c) => {
  const parsed = z
    .object({
      previewId: z.string().uuid(),
      digest: z.string().regex(/^[a-f0-9]{64}$/),
      recoveryAcknowledged: z.literal(true),
    })
    .strict()
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success)
    return c.json(
      { error: 'Confirm the recovery procedure and a current policy preview.' },
      400
    );
  const browser = c.get('browserSession');
  if (!browser) return c.json({ error: 'Unauthorized' }, 401);
  const policy = await applyPolicy(
    c.env,
    browser.id,
    c.get('user')!.id,
    parsed.data.previewId,
    parsed.data.digest
  );
  if (!policy)
    return c.json(
      {
        code: 'AUTHENTICATION_POLICY_PREVIEW_CHANGED',
        error:
          'The preview, authentication or affected accounts changed. Preview again.',
      },
      409
    );
  return c.json({ policy });
});
