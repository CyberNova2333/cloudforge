const LOCK_NAME = 'cloudforge.sign-in';

export type SignInSession = { userId: string; sessionId: string };
export class SignInError extends Error {
  constructor(
    public readonly code:
      | 'SIGN_IN_UNSUPPORTED'
      | 'SESSION_CHANGED'
      | 'SIGN_IN_CHECK_FAILED'
      | 'SIGN_IN_CANCELLED'
  ) {
    super(
      code === 'SIGN_IN_UNSUPPORTED'
        ? 'This browser cannot safely coordinate single sign-on. Use your password instead.'
        : code === 'SESSION_CHANGED'
          ? 'The signed-in session changed. Reload and try again.'
          : code === 'SIGN_IN_CANCELLED'
            ? 'Sign-in was cancelled.'
            : 'Could not check the current sign-in. Reload and try again.'
    );
  }
}
export function supportsSignInLock() {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.locks?.request === 'function'
  );
}

/** Never use the client store to decide whether a new session may replace this browser's cookie. */
export async function readSignInSession(
  signal?: AbortSignal
): Promise<SignInSession | null> {
  const response = await fetch(
    '/api/auth/get-session?disableCookieCache=true&disableRefresh=true',
    { credentials: 'include', cache: 'no-store', signal }
  );
  if (!response.ok) throw new SignInError('SIGN_IN_CHECK_FAILED');
  const value = (await response.json().catch(() => undefined)) as
    { user?: { id?: unknown }; session?: { id?: unknown } } | null | undefined;
  if (value === null) return null;
  if (
    typeof value?.user?.id !== 'string' ||
    !value.user.id ||
    typeof value.session?.id !== 'string' ||
    !value.session.id
  )
    throw new SignInError('SIGN_IN_CHECK_FAILED');
  return { userId: value.user.id, sessionId: value.session.id };
}

/** Hold only around actual sign-in requests and receipt checks, never around a recent-authentication modal. */
export async function withSignInLock<T>(
  operation: () => Promise<T>,
  options: { signal?: AbortSignal; required?: boolean } = {}
): Promise<T> {
  if (options.signal?.aborted) throw new SignInError('SIGN_IN_CANCELLED');
  if (!supportsSignInLock()) {
    if (options.required) throw new SignInError('SIGN_IN_UNSUPPORTED');
    return operation();
  }
  return navigator.locks.request(
    LOCK_NAME,
    { mode: 'exclusive', signal: options.signal },
    async () => {
      if (options.signal?.aborted) throw new SignInError('SIGN_IN_CANCELLED');
      return operation();
    }
  );
}

/** All ordinary exported password sign-ins share the same origin lock as SSO completion. */
export async function nativeSignIn<T>(
  operation: () => Promise<T>,
  signal?: AbortSignal
): Promise<
  | T
  | {
      data: null;
      error: {
        code: string;
        message: string;
        status: number;
        statusText: string;
      };
    }
> {
  try {
    return await withSignInLock(
      async () => {
        if (await readSignInSession(signal))
          throw new SignInError('SESSION_CHANGED');
        return operation();
      },
      { signal }
    );
  } catch (error) {
    const safe =
      error instanceof SignInError
        ? error
        : new SignInError(
            signal?.aborted ? 'SIGN_IN_CANCELLED' : 'SIGN_IN_CHECK_FAILED'
          );
    return {
      data: null,
      error: {
        code: safe.code,
        message: safe.message,
        status: 409,
        statusText: 'Conflict',
      },
    };
  }
}
