import { t } from '@/lib/i18n';

/** Shared factor field; never persist the code or offer a trusted-device bypass. */
export function FactorCode({
  id,
  value,
  onChange,
  recovery = false,
  onRecoveryChange,
  disabled = false,
  autoFocus = false,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  recovery?: boolean;
  onRecoveryChange?: (value: boolean) => void;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  return (
    <div className="fld">
      <label htmlFor={id}>
        {recovery ? t('Recovery code') : t('Authenticator code')}
      </label>
      <input
        id={id}
        type="text"
        className="form-control security-code"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete="one-time-code"
        autoCapitalize="none"
        spellCheck={false}
        inputMode={recovery ? 'text' : 'numeric'}
        pattern={recovery ? undefined : '[0-9]{6}'}
        maxLength={recovery ? 64 : 6}
        required
        disabled={disabled}
        autoFocus={autoFocus}
        aria-describedby={`${id}-hint`}
      />
      <p id={`${id}-hint`} className="hint">
        {recovery
          ? t('Each recovery code works once. Enter an unused code you saved.')
          : t('Enter the six-digit code from your authenticator app.')}
      </p>
      {onRecoveryChange && (
        <button
          type="button"
          className="btn-link security-code-switch"
          disabled={disabled}
          onClick={() => onRecoveryChange(!recovery)}
        >
          {recovery ? t('Use an authenticator code') : t('Use a recovery code')}
        </button>
      )}
    </div>
  );
}
