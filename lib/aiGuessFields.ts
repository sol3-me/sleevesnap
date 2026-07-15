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
export function confidenceTier(_confidence: number | undefined): ConfidenceTier {
  return 'guess';
}

export function confidenceTierLabel(_tier: ConfidenceTier): string {
  return '';
}

/**
 * Orders guesses by usefulness: MusicBrainz-validated guesses first, then by
 * confidence descending. Stable for ties. Does not mutate the input.
 */
export function rankGuesses(_guesses: ScanVisionSuggestion[]): ScanVisionSuggestion[] {
  return [];
}

/** The guess that should auto-fill the search fields, or undefined when there are none. */
export function bestGuess(_guesses: ScanVisionSuggestion[]): ScanVisionSuggestion | undefined {
  return undefined;
}

/** Maps a guess onto the four search fields (label is never guessed by the AI). */
export function guessToFields(_guess: ScanVisionSuggestion): GuessFieldsValue {
  return { title: '', artist: '', year: '', label: '' };
}

/**
 * Alternate values for one field, drawn from the other guesses: deduplicated,
 * excluding the current value, keeping the strongest (validated, then highest
 * confidence) annotation per distinct value, ordered by guess rank.
 */
export function fieldAlternates(
  _guesses: ScanVisionSuggestion[],
  _key: 'title' | 'artist' | 'year',
  _currentValue: string,
): FieldAlternate[] {
  return [];
}
