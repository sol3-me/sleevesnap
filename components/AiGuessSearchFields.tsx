import React, { useState } from 'react';
import {
  confidenceTier,
  ConfidenceTier,
  confidenceTierLabel,
  fieldAlternates,
  GuessFieldsValue,
  rankGuesses,
} from '../lib/aiGuessFields';
import { ScanVisionSuggestion } from '../types';

interface AiGuessSearchFieldsProps {
  guesses: ScanVisionSuggestion[];
  value: GuessFieldsValue;
  onChange: (next: GuessFieldsValue) => void;
  onSubmit: () => void;
}

/** Confidence-tier colour classes, tuned for the app's dark theme. */
const TIER_STYLES: Record<ConfidenceTier, { text: string; border: string }> = {
  high: { text: 'text-green-400', border: 'border-l-green-400' },
  medium: { text: 'text-amber-400', border: 'border-l-amber-400' },
  low: { text: 'text-red-400', border: 'border-l-red-400' },
  guess: { text: 'text-gray-400', border: 'border-l-gray-500' },
};

const FIELD_KEYS = ['title', 'artist', 'year'] as const;
type GuessedFieldKey = (typeof FIELD_KEYS)[number];

const FIELD_LABELS: Record<keyof GuessFieldsValue, string> = {
  title: 'Title',
  artist: 'Artist',
  year: 'Year',
  label: 'Label',
};

const inputClassName =
  'w-full bg-vinyl-800/80 text-white placeholder:text-gray-500 border border-white/10 border-l-4 rounded-xl px-4 py-3 pr-10 text-sm focus:border-vinyl-accent/60 focus:ring-2 focus:ring-vinyl-accent/20 focus:outline-none transition-colors';

const ChevronDownIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
);

/**
 * The AI-scan replacement for the plain advanced-search fields: each field is
 * colour-coded by the confidence of the guess its value came from, and fields
 * with alternate values from other guesses get a dropdown to swap in just
 * that field's alternative — so a title from one guess can be combined with
 * an artist from another. Discover's AdvancedSearchFields is untouched.
 */
export const AiGuessSearchFields: React.FC<AiGuessSearchFieldsProps> = ({
  guesses,
  value,
  onChange,
  onSubmit,
}) => {
  const [openField, setOpenField] = useState<GuessedFieldKey | null>(null);

  const handleEnter = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') onSubmit();
  };

  /** The guess (ranked best-first) the field's current value came from, if any. */
  const sourceGuess = (key: GuessedFieldKey): ScanVisionSuggestion | undefined =>
    rankGuesses(guesses).find((g) => (g[key] ?? '') === value[key] && value[key] !== '');

  const renderField = (key: keyof GuessFieldsValue) => {
    const isGuessed = (FIELD_KEYS as readonly string[]).includes(key);
    const source = isGuessed ? sourceGuess(key as GuessedFieldKey) : undefined;
    const tier = source ? confidenceTier(source.confidence) : null;
    const style = tier ? TIER_STYLES[tier] : null;
    const alternates = isGuessed ? fieldAlternates(guesses, key as GuessedFieldKey, value[key]) : [];
    const isOpen = openField === key;

    return (
      <div key={key} className="relative">
        <span className="block text-[11px] text-gray-500 mb-1">
          {FIELD_LABELS[key]}
          {source && style && tier && (
            <span className={style.text}>
              {' · '}{confidenceTierLabel(tier)}{source.validated ? ' · On MusicBrainz ✓' : ''}
            </span>
          )}
          {!source && value[key] && isGuessed && <span> · Edited</span>}
        </span>
        <input
          type="text"
          value={value[key]}
          onChange={(e) => onChange({ ...value, [key]: e.target.value })}
          onKeyDown={handleEnter}
          placeholder={FIELD_LABELS[key]}
          className={`${inputClassName} ${style ? style.border : 'border-l-white/10'}`}
        />
        {alternates.length > 0 && (
          <button
            onClick={() => setOpenField(isOpen ? null : (key as GuessedFieldKey))}
            aria-label={`Other AI guesses for ${FIELD_LABELS[key].toLowerCase()}`}
            aria-expanded={isOpen}
            className="absolute right-2 bottom-2.5 p-1 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            <ChevronDownIcon />
          </button>
        )}
        {isOpen && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setOpenField(null)} />
            <div className="absolute z-20 left-0 right-0 mt-1 rounded-xl bg-vinyl-900 border border-white/10 shadow-xl overflow-hidden">
              {alternates.map((alt) => {
                const altTier = confidenceTier(alt.confidence);
                const altStyle = TIER_STYLES[altTier];
                return (
                  <button
                    key={alt.value}
                    onClick={() => {
                      onChange({ ...value, [key]: alt.value });
                      setOpenField(null);
                    }}
                    className="flex items-center gap-2 w-full px-3 py-2.5 text-left text-sm text-gray-200 hover:bg-white/10 transition-colors"
                  >
                    <span className={`w-2 h-2 rounded-full flex-none ${altStyle.text.replace('text-', 'bg-')}`} />
                    <span className="flex-1 min-w-0 truncate">{alt.value}</span>
                    <span className={`text-[11px] flex-none ${altStyle.text}`}>
                      {confidenceTierLabel(altTier)}{alt.validated ? ' ✓' : ''}
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    );
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
      {(['title', 'artist', 'year', 'label'] as const).map(renderField)}
    </div>
  );
};
