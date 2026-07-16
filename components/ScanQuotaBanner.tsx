import React from 'react';
import { ScanQuota } from '../types';

export type QuotaTone = 'exhausted' | 'low' | 'normal';

export function quotaTone(quota: ScanQuota): QuotaTone {
  if (quota.remaining === 0) return 'exhausted';
  if (quota.remaining <= 2) return 'low';
  return 'normal';
}

/** Text colour for the remaining-count badge shown in the Scan header. */
export const QUOTA_TEXT_TONE_CLASSES: Record<QuotaTone, string> = {
  exhausted: 'text-red-300',
  low: 'text-amber-300',
  normal: 'text-gray-400',
};

interface ScanQuotaBannerProps {
  quota: ScanQuota;
  onViewHistory: () => void;
}

/** Nudge toward reusing a past scan or searching manually — both cost
 * nothing against the allowance — shown once the daily AI-scan allowance is
 * running low or exhausted. The remaining count itself lives in the Scan
 * header (Scanner.tsx), not here. */
export const ScanQuotaBanner: React.FC<ScanQuotaBannerProps> = ({ quota, onViewHistory }) => {
  const tone = quotaTone(quota);
  if (tone === 'normal') return null;

  const toneClasses =
    tone === 'exhausted'
      ? 'bg-red-500/10 border-red-500/25 text-red-300'
      : 'bg-amber-500/10 border-amber-500/25 text-amber-300';

  return (
    <div className={`text-xs rounded-xl px-3 py-2 mb-4 border ${toneClasses}`}>
      <button
        onClick={onViewHistory}
        className="underline underline-offset-2 hover:opacity-80 transition-opacity text-left"
      >
        {tone === 'exhausted' ? 'Reuse a past scan or search manually instead' : 'Running low — reuse a past scan or search manually'}
      </button>
    </div>
  );
};
