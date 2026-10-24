// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt).
import {
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
} from 'react';
import { AlertIcon } from '@primer/octicons-react';
import { t } from '@/lib/i18n';

/**
 * A button that shows a spinner while its action runs and keeps its width, so nothing around it moves. On
 * failure it shows the error on the button itself, with "Retry", and stays enabled. `className` adds modifiers
 * to `btn` (e.g. "primary small").
 */
export function PendingButton({
  pending,
  pendingLabel,
  error,
  className,
  disabled,
  children,
  style,
  type = 'button',
  ...rest
}: {
  pending: boolean;
  /** Shown beside the spinner, e.g. "Approving…"; the button's own label otherwise. */
  pendingLabel?: string;
  /** The last attempt's failure, in words. */
  error?: string | null;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  const ref = useRef<HTMLButtonElement>(null);
  const [restWidth, setRestWidth] = useState<number | null>(null);

  useLayoutEffect(() => {
    if (!pending && ref.current) setRestWidth(ref.current.offsetWidth);
  }, [pending, children, error]);

  const classes = ['btn', className, error && !pending ? 'is-error' : null]
    .filter(Boolean)
    .join(' ');
  return (
    <button
      {...rest}
      ref={ref}
      type={type}
      className={classes}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      style={
        pending && restWidth
          ? { ...style, minWidth: restWidth, justifyContent: 'center' }
          : style
      }
    >
      {pending ? (
        <>
          <span className="spinner" aria-hidden="true" />
          {pendingLabel ?? children}
        </>
      ) : error ? (
        <>
          <AlertIcon size={14} />
          {error} · {t('Retry')}
        </>
      ) : (
        children
      )}
    </button>
  );
}
