import { memo, type ReactNode } from 'react';

export const SampleState = memo(function SampleState({ kind = 'empty', title, description, compact = false, children }: {
  kind?: 'empty' | 'loading' | 'error' | 'select' | 'failed';
  title: string; description?: string; compact?: boolean; children?: ReactNode;
}) {
  const warning = kind === 'error' || kind === 'failed';
  return <div className={`sample-placeholder is-${kind}${compact ? ' is-compact' : ''}`}
    aria-busy={kind === 'loading' || undefined}>
    <svg className="sample-placeholder-art" viewBox="0 0 120 88" fill="none" aria-hidden="true" focusable="false">
      <ellipse cx="57" cy="75" rx="43" ry="7" fill="currentColor" opacity=".06" />
      <rect x="29" y="12" width="54" height="58" rx="8" fill="var(--surface)" stroke="currentColor" opacity=".2" transform="rotate(-9 29 12)" />
      <rect x="35" y="14" width="54" height="58" rx="8" fill="var(--surface)" stroke="currentColor" strokeWidth="1.5" />
      <path d="M47 30h29M47 40h22M47 50h15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity=".3" />
      <circle cx="87" cy="62" r="17" fill="var(--surface)" stroke="currentColor" strokeWidth="1.5" />
      {warning ? <path d="M87 53v10m0 7v.2" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
        : kind === 'loading' ? <path d="M87 52v11l6 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          : kind === 'select' ? <path d="M81 62h12m-5-5 5 5-5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            : <path d="M81 62h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />}
    </svg>
    <div className="sample-placeholder-copy"><strong>{title}</strong>
      {description && <p>{description}</p>}{children && <div className="sample-placeholder-actions">{children}</div>}</div>
  </div>;
});
