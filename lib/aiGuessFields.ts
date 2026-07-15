import type { ScanVisionSuggestion } from '../types';

export interface GuessFieldsValue {
  title: string;
  artist: string;
  year: string;
  label: string;
}

export type ConfidenceTier = 'high' | 'medium' | 'low' | 'guess';

export interface FieldAlternate {
  value: string;
  confidence: number;
  validated: boolean;
}

/** Confidence band for colour-coding: high ≥ 0.85, medium ≥ 0.6, low ≥ 0.35, else guess. */
export function confidenceTier(confidence: number | undefined): ConfidenceTier {
  const score = Math.max(0, Math.min(1, confidence ?? 0));
  if (score >= 0.85) return 'high';
  if (score >= 0.6) return 'medium';
  if (score >= 0.35) return 'low';
  return 'guess';
}

const TIER_LABELS: Record<ConfidenceTier, string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  guess: 'Total Guess',
};

export function confidenceTierLabel(tier: ConfidenceTier): string {
  return TIER_LABELS[tier];
}

/**
 * Orders guesses by usefulness: MusicBrainz-validated guesses first, then by
 * confidence descending. A validated low-confidence guess beats an
 * unvalidated high-confidence one — the AI confidently misreading label text
 * as an album title is exactly the failure mode validation exists to catch.
 * Stable for ties. Does not mutate the input.
 */
export function rankGuesses(guesses: ScanVisionSuggestion[]): ScanVisionSuggestion[] {
  return guesses
    .slice()
    .sort((a, b) => {
      const validatedDelta = Number(b.validated ?? false) - Number(a.validated ?? false);
      if (validatedDelta !== 0) return validatedDelta;
      return (b.confidence ?? 0) - (a.confidence ?? 0);
    });
}

/** The guess that should auto-fill the search fields, or undefined when there are none. */
export function bestGuess(guesses: ScanVisionSuggestion[]): ScanVisionSuggestion | undefined {
  return rankGuesses(guesses)[0];
}

/** Maps a guess onto the four search fields (label is never guessed by the AI). */
export function guessToFields(guess: ScanVisionSuggestion): GuessFieldsValue {
  return {
    title: guess.title,
    artist: guess.artist,
    year: guess.year ?? '',
    label: '',
  };
}

/**
 * Alternate values for one field, drawn from the other guesses: deduplicated,
 * excluding the current value, keeping the strongest (validated, then highest
 * confidence) annotation per distinct value, ordered by guess rank.
 */
export function fieldAlternates(
  guesses: ScanVisionSuggestion[],
  key: 'title' | 'artist' | 'year',
  currentValue: string,
): FieldAlternate[] {
  const byValue = new Map<string, FieldAlternate>();

  for (const guess of rankGuesses(guesses)) {
    const value = guess[key]?.trim();
    if (!value || value === currentValue) continue;

    const candidate: FieldAlternate = {
      value,
      confidence: guess.confidence ?? 0,
      validated: guess.validated ?? false,
    };

    const existing = byValue.get(value);
    if (!existing) {
      byValue.set(value, candidate);
      continue;
    }
    const candidateStronger =
      Number(candidate.validated) - Number(existing.validated) > 0 ||
      (candidate.validated === existing.validated && candidate.confidence > existing.confidence);
    if (candidateStronger) {
      // Keep the original (rank-ordered) position; upgrade the annotation only.
      byValue.set(value, { ...candidate });
    }
  }

  return Array.from(byValue.values());
}
