import React from 'react';
import { ScanQuota } from '../types';

interface ScanQuotaBannerProps {
  quota: ScanQuota;
  onViewHistory: () => void;
}

/** Shows the user's remaining daily AI-scan allowance, with a nudge toward
 * reusing a past scan or searching manually once it's running low — both
 * of which cost nothing against the allowance. */
export const ScanQuotaBanner: React.FC<ScanQuotaBannerProps> = ({ quota, onViewHistory }) => {
  const isExhausted = quota.remaining === 0;
  const isLow = quota.remaining <= 2;

  const toneClasses = isExhausted
    ? 'bg-red-500/10 border-red-500/25 text-red-300'
    : isLow
      ? 'bg-amber-500/10 border-amber-500/25 text-amber-300'
      : 'bg-white/5 border-white/10 text-gray-400';

  return (
    <div className={`flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs rounded-xl px-3 py-2 mb-4 border ${toneClasses}`}>
      <span className="font-medium">
        {quota.remaining} of {quota.limit} AI scans left today
      </span>
      {isLow && (
        <button
          onClick={onViewHistory}
          className="underline underline-offset-2 hover:opacity-80 transition-opacity text-left"
        >
          {isExhausted ? 'Reuse a past scan or search manually instead' : 'Running low — reuse a past scan or search manually'}
        </button>
      )}
    </div>
  );
};
