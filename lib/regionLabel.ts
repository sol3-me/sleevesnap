// MusicBrainz's pseudo-regions — not real ISO 3166-1 codes, so
// Intl.DisplayNames can't resolve them. Mirrors the exact set/wording
// previously private to ReleaseGroupResultsList's formatCountry.
const SPECIAL_REGIONS: Record<string, string> = {
  XE: 'Europe',
  XW: 'Worldwide',
  XG: 'East Germany',
};

/** "United States (US)", "Worldwide (XW)", or the raw code if it can't be resolved. Undefined in, undefined out. */
export function getRegionLabel(countryCode?: string): string | undefined {
  if (!countryCode) return undefined;

  if (SPECIAL_REGIONS[countryCode]) {
    return `${SPECIAL_REGIONS[countryCode]} (${countryCode})`;
  }

  try {
    const name = new Intl.DisplayNames(['en'], { type: 'region' }).of(countryCode);
    if (name && name !== countryCode) {
      return `${name} (${countryCode})`;
    }
  } catch {
    // Ignore and fall through to the raw region code.
  }

  return countryCode;
}

// There's no Intl.supportedValuesOf('region') (that API only covers
// calendar/collation/currency/numberingSystem/timeZone/unit, not region) —
// so the ISO 3166-1 alpha-2 list is hardcoded here. Stable and effectively
// unchanging, unlike currency or timezone data.
const ISO_COUNTRY_CODES = [
  'AD', 'AE', 'AF', 'AG', 'AI', 'AL', 'AM', 'AO', 'AQ', 'AR', 'AS', 'AT', 'AU', 'AW', 'AX', 'AZ',
  'BA', 'BB', 'BD', 'BE', 'BF', 'BG', 'BH', 'BI', 'BJ', 'BL', 'BM', 'BN', 'BO', 'BQ', 'BR', 'BS',
  'BT', 'BV', 'BW', 'BY', 'BZ', 'CA', 'CC', 'CD', 'CF', 'CG', 'CH', 'CI', 'CK', 'CL', 'CM', 'CN',
  'CO', 'CR', 'CU', 'CV', 'CW', 'CX', 'CY', 'CZ', 'DE', 'DJ', 'DK', 'DM', 'DO', 'DZ', 'EC', 'EE',
  'EG', 'EH', 'ER', 'ES', 'ET', 'FI', 'FJ', 'FK', 'FM', 'FO', 'FR', 'GA', 'GB', 'GD', 'GE', 'GF',
  'GG', 'GH', 'GI', 'GL', 'GM', 'GN', 'GP', 'GQ', 'GR', 'GS', 'GT', 'GU', 'GW', 'GY', 'HK', 'HM',
  'HN', 'HR', 'HT', 'HU', 'ID', 'IE', 'IL', 'IM', 'IN', 'IO', 'IQ', 'IR', 'IS', 'IT', 'JE', 'JM',
  'JO', 'JP', 'KE', 'KG', 'KH', 'KI', 'KM', 'KN', 'KP', 'KR', 'KW', 'KY', 'KZ', 'LA', 'LB', 'LC',
  'LI', 'LK', 'LR', 'LS', 'LT', 'LU', 'LV', 'LY', 'MA', 'MC', 'MD', 'ME', 'MF', 'MG', 'MH', 'MK',
  'ML', 'MM', 'MN', 'MO', 'MP', 'MQ', 'MR', 'MS', 'MT', 'MU', 'MV', 'MW', 'MX', 'MY', 'MZ', 'NA',
  'NC', 'NE', 'NF', 'NG', 'NI', 'NL', 'NO', 'NP', 'NR', 'NU', 'NZ', 'OM', 'PA', 'PE', 'PF', 'PG',
  'PH', 'PK', 'PL', 'PM', 'PN', 'PR', 'PS', 'PT', 'PW', 'PY', 'QA', 'RE', 'RO', 'RS', 'RU', 'RW',
  'SA', 'SB', 'SC', 'SD', 'SE', 'SG', 'SH', 'SI', 'SJ', 'SK', 'SL', 'SM', 'SN', 'SO', 'SR', 'SS',
  'ST', 'SV', 'SX', 'SY', 'SZ', 'TC', 'TD', 'TF', 'TG', 'TH', 'TJ', 'TK', 'TL', 'TM', 'TN', 'TO',
  'TR', 'TT', 'TV', 'TW', 'TZ', 'UA', 'UG', 'UM', 'US', 'UY', 'UZ', 'VA', 'VC', 'VE', 'VG', 'VI',
  'VN', 'VU', 'WF', 'WS', 'YE', 'YT', 'ZA', 'ZM', 'ZW',
];

export interface RegionOption {
  code: string;
  label: string;
}

/** Full region list for a "preferred region" dropdown: MusicBrainz's pseudo-regions plus every ISO country, sorted by label. */
export function listRegionOptions(): RegionOption[] {
  const codes = [...Object.keys(SPECIAL_REGIONS), ...ISO_COUNTRY_CODES];
  return codes
    .map((code) => ({ code, label: getRegionLabel(code)! }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Whether `countryCode` has a real flag icon to show — false for
 * MusicBrainz's pseudo-regions (XW/XE/XG; there's no real "Worldwide" flag)
 * and any malformed input. Unicode regional-indicator flag emoji don't
 * reliably render as flags cross-platform (notably: Windows/many Chromium
 * builds show the bare two letters instead), so actual rendering uses real
 * flag icon images (see components/RegionFlag.tsx, backed by the
 * `flag-icons` package) rather than emoji — this just answers "is there one
 * to look up".
 */
export function hasRealFlagIcon(countryCode: string): boolean {
  const normalized = countryCode.toUpperCase();
  return !SPECIAL_REGIONS[normalized] && /^[A-Z]{2}$/.test(normalized);
}
