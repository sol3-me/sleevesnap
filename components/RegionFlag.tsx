import { hasRealFlagIcon } from '../lib/regionLabel';

interface RegionFlagProps {
  code: string;
  className?: string;
}

/**
 * Real flag icon for a region code, served as a plain static file from
 * public/flags (copied from the flag-icons package by
 * scripts/copyFlagIcons.mjs at install time) — fetched on demand per flag
 * actually rendered rather than bundled, unlike importing flag-icons' CSS
 * directly (which pulls every flag's url() into the build). Also sidesteps
 * Unicode flag emoji not reliably rendering as flags cross-platform
 * (Windows/many Chromium builds show the bare two letters instead). Falls
 * back to a globe for MusicBrainz's pseudo-regions (XW/XE/XG — no real
 * "Worldwide" flag exists) or malformed input.
 */
export function RegionFlag({ code, className = '' }: RegionFlagProps) {
  if (!hasRealFlagIcon(code)) {
    return (
      <span className={`inline-flex items-center justify-center ${className}`} aria-hidden="true">
        🌐
      </span>
    );
  }

  return (
    <img
      src={`/flags/${code.toLowerCase()}.svg`}
      alt=""
      aria-hidden="true"
      className={`inline-block object-cover ${className}`}
    />
  );
}
