// Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSE).
import { useState } from 'react';
import { t } from '@/lib/i18n';
import { Markdown } from './Markdown';

export function MarkdownEditor({
  value,
  onChange,
  placeholder = t('Leave a comment'),
  minHeight = 100,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  minHeight?: number;
}) {
  const [tab, setTab] = useState<'write' | 'preview'>('write');
  return (
    <div className="Box" style={{ overflow: 'hidden' }}>
      <div
        className="d-flex border-bottom color-bg-subtle px-2 pt-2"
        style={{ gap: 4 }}
      >
        {(['write', 'preview'] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            onClick={() => setTab(mode)}
            className="btn-link f6 px-3 py-2"
            style={{
              border: '1px solid',
              borderColor:
                tab === mode ? 'var(--borderColor-default)' : 'transparent',
              borderBottom: 0,
              borderRadius: '6px 6px 0 0',
              marginBottom: -1,
              background:
                tab === mode ? 'var(--bgColor-default)' : 'transparent',
              color:
                tab === mode
                  ? 'var(--fgColor-default)'
                  : 'var(--fgColor-muted)',
              textDecoration: 'none',
            }}
          >
            {mode === 'write' ? t('Write') : t('Preview')}
          </button>
        ))}
      </div>
      <div className="p-2">
        {tab === 'write' ? (
          <textarea
            className="form-control width-full"
            style={{ minHeight, resize: 'vertical' }}
            placeholder={placeholder}
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
        ) : (
          <div className="p-2" style={{ minHeight }}>
            {value.trim() ? (
              <Markdown source={value} />
            ) : (
              <p className="color-fg-muted">{t('Nothing to preview')}</p>
            )}
          </div>
        )}
        <p className="f6 color-fg-muted mt-1 mb-0">
          {t('Markdown is supported')}
        </p>
      </div>
    </div>
  );
}
