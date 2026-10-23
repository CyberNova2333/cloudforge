import { decryptSecret, encryptSecret } from './secrets';

/** Durable step state can contain inputs, generated credentials and command-file values. */
export type SealedState =
  | { sealed: string }
  | { key: string }
  | { unavailable: true; preparation?: true };

/** Persist a small, non-secret failure marker if saving an executed command's result fails.
 * Returning it (instead of throwing inside step.do) survives Workflow replay without rerunning side effects.
 */
export async function persistState(
  save: () => Promise<SealedState>
): Promise<SealedState> {
  try {
    return await save();
  } catch {
    return { unavailable: true };
  }
}

/** A completed command's saved result is unavailable; rerunning the command is unsafe. */
export class StateHydrationError extends Error {
  override name = 'StateHydrationError';
}

const stateKey = (repoId: string, runId: string, stepName: string) =>
  `actions/${repoId}/${runId}/state/${encodeURIComponent(stepName)}.enc`;

function stateEnv(env: CloudflareBindings): CloudflareBindings {
  const key = env.ACTIONS_SECRETS_KEY || env.BETTER_AUTH_SECRET;
  if (!key) throw new Error('Actions state encryption needs a server secret.');
  // A distinct HKDF input separates workflow state from stored Actions secrets.
  return { ...env, ACTIONS_SECRETS_KEY: `cloudforge-workflow-state-v1:${key}` };
}

export async function sealState(
  env: CloudflareBindings,
  repoId: string,
  runId: string,
  stepName: string,
  value: unknown
): Promise<SealedState> {
  const sealed = await encryptSecret(
    stateEnv(env),
    `${repoId}/${runId}`,
    stepName,
    JSON.stringify(value)
  );
  // Workflows has a 1 MiB non-stream result limit. Large state stays encrypted
  // under the run's existing retention prefix; the durable result is only a key.
  if (sealed.length <= 512 * 1024) return { sealed };
  const key = stateKey(repoId, runId, stepName);
  await env.ACTIONS_LOGS.put(key, sealed, {
    httpMetadata: { contentType: 'application/octet-stream' },
  });
  return { key };
}

export async function openState<T>(
  env: CloudflareBindings,
  repoId: string,
  runId: string,
  stepName: string,
  state: SealedState
): Promise<T> {
  if (!state || typeof state !== 'object')
    throw new StateHydrationError(
      'Actions step state is invalid; re-run this workflow.'
    );
  if ('unavailable' in state)
    throw new StateHydrationError(
      state.preparation
        ? 'Actions step preparation failed; completed commands were not retried. Re-run this workflow only after checking their effects.'
        : 'Actions step state or log could not be saved; completed commands were not retried. Re-run this workflow only after checking their effects.'
    );
  let sealed: string;
  if ('sealed' in state) sealed = state.sealed;
  else {
    if (state.key !== stateKey(repoId, runId, stepName))
      throw new StateHydrationError(
        'Actions step state reference does not match this run.'
      );
    sealed = await readStoredState(env, state.key);
  }
  let value: string | null;
  try {
    value = await decryptSecret(
      stateEnv(env),
      `${repoId}/${runId}`,
      stepName,
      sealed
    );
  } catch {
    throw new StateHydrationError(
      'Actions step state could not be decrypted; re-run this workflow.'
    );
  }
  if (value === null)
    throw new StateHydrationError(
      'Actions step state could not be decrypted. The server encryption key may have changed; re-run this workflow.'
    );
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new StateHydrationError(
      'Actions step state is invalid; re-run this workflow.'
    );
  }
}

async function readStoredState(
  env: CloudflareBindings,
  key: string
): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    try {
      const object = await env.ACTIONS_LOGS.get(key);
      if (!object)
        throw new StateHydrationError(
          'Actions step state is no longer available; re-run this workflow.'
        );
      return await object.text();
    } catch (error) {
      if (error instanceof StateHydrationError) throw error;
      if (attempt === 2)
        throw new StateHydrationError(
          'Actions step state could not be read after 3 attempts; re-run this workflow.'
        );
      await new Promise((resolve) => setTimeout(resolve, 100 * 2 ** attempt));
    }
  }
}
