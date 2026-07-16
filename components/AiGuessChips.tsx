import React from 'react';
import { confidenceTier, ConfidenceTier, confidenceTierLabel, rankGuesses } from '../lib/aiGuessFields';
import { ScanVisionSuggestion } from '../types';

/** Confidence-tier colour classes, tuned for the app's dark theme. */
const TIER_STYLES: Record<ConfidenceTier, { text: string; chipBg: string; chipBorder: string }> = {
  high: { text: 'text-green-400', chipBg: 'bg-green-500/10', chipBorder: 'border-green-500/40' },
  medium: { text: 'text-amber-400', chipBg: 'bg-amber-500/10', chipBorder: 'border-amber-500/40' },
  low: { text: 'text-red-400', chipBg: 'bg-red-500/10', chipBorder: 'border-red-500/40' },
  guess: { text: 'text-gray-400', chipBg: 'bg-white/5', chipBorder: 'border-white/15' },
};

interface AiGuessChipsProps {
  guesses: ScanVisionSuggestion[];
  /** Fill every field from this guess (and show its pre-fetched results if it has any). */
  onApplyGuess: (guess: ScanVisionSuggestion) => void;
}

/**
 * Whole-guess chips, colour-coded by confidence; ✓ = found on MusicBrainz.
 * Split out from AiGuessSearchFields so the scan result page can show these
 * suggestions and the editable search fields as visually separate groups.
 */
export const AiGuessChips: React.FC<AiGuessChipsProps> = ({ guesses, onApplyGuess }) => (
  <div className="flex flex-wrap gap-2">
    {rankGuesses(guesses).map((guess, idx) => {
      const tier = confidenceTier(guess.confidence);
      const style = TIER_STYLES[tier];
      return (
        <button
          key={`${guess.artist}-${guess.title}-${idx}`}
          onClick={() => onApplyGuess(guess)}
          className={`px-3 py-1.5 rounded-full border text-xs transition-colors hover:brightness-125 ${style.chipBg} ${style.chipBorder} ${style.text}`}
        >
          {`${guess.artist} - ${guess.title}`}
          <span className="ml-1 opacity-75">{confidenceTierLabel(tier)}{guess.validated ? ' ✓' : ''}</span>
        </button>
      );
    })}
  </div>
);
