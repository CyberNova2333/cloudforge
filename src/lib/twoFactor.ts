import { t } from './i18n';

/** Only display a TOTP secret, never turn the enrollment URI into an external image or link. */
export function enrollmentSecret(uri: string): string | null {
  try {
    const url = new URL(uri);
    const secret = url.searchParams.get('secret');
    return url.protocol === 'otpauth:' &&
      url.hostname === 'totp' &&
      secret &&
      /^[A-Z2-7]+$/i.test(secret)
      ? secret
      : null;
  } catch {
    return null;
  }
}

export function factorError(error: { code?: string; status?: number }): string {
  if (error.code === 'TOTP_ALREADY_USED')
    return t(
      'This code was already used. Wait for the next code in your authenticator, then try again.'
    );
  if (error.status === 429 || error.code === 'TOO_MANY_REQUESTS')
    return t('Too many attempts. Wait a moment before trying again.');
  return t(
    'Verification failed or expired. Check your password and code, then try again.'
  );
}
