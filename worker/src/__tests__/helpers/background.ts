/**
 * Background work a test left behind: what the app handed to `ctx.waitUntil` in every env the test made (makeEnv
 * registers each), drained after each test by worker/test/setup.ts. Work still running when its worker shuts down
 * fails in vitest's module loader (CNB: EnvironmentTeardownError from a late LiveHub ping after the last test).
 */
const open = new Set<Promise<unknown>[]>();

export function trackBackground(waits: Promise<unknown>[]) {
  open.add(waits);
}

/**
 * Waits for every tracked env's background work, including work it starts while finishing, for up to `ms`.
 * Settled, not awaited: a test's background failures stay as unobserved as before; only their timing changes.
 */
export async function drainBackground(ms = 5_000) {
  const deadline = Date.now() + ms;
  const envs = [...open];
  open.clear();
  for (const waits of envs)
    while (waits.length && Date.now() < deadline) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        Promise.allSettled(waits.splice(0)),
        new Promise((resolve) => {
          timer = setTimeout(resolve, Math.max(0, deadline - Date.now()));
        }),
      ]);
      clearTimeout(timer);
    }
}
