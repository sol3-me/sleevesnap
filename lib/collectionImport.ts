import { VinylRecord } from '../types';

export interface CollectionImportResult {
  valid: VinylRecord[];
  errors: string[];
}

// A record must at least identify and date itself to be usable — everything
// else on VinylRecord is optional, so those are the only fields worth
// rejecting an entry over. Extra/unknown fields on an entry are left as-is;
// the collection API only ever reads the fields it recognises.
function validateEntry(entry: unknown, index: number): { record?: VinylRecord; error?: string } {
  if (typeof entry !== 'object' || entry === null) {
    return { error: `Entry ${index}: not an object` };
  }

  const candidate = entry as Record<string, unknown>;
  const missing = ['id', 'artist', 'title'].filter((field) => typeof candidate[field] !== 'string');
  if (missing.length > 0) {
    return { error: `Entry ${index} (${String(candidate.id ?? candidate.title ?? 'unknown')}): missing or invalid ${missing.join(', ')}` };
  }
  if (typeof candidate.dateAdded !== 'number') {
    return { error: `Entry ${index} (${String(candidate.id)}): missing or invalid dateAdded` };
  }

  return { record: candidate as unknown as VinylRecord };
}

/**
 * Parses a sleevesnap collection export file. Accepts either the full
 * export shape (`{ records: [...] }`, as produced by
 * serializeCollectionExport) or a bare array of records, so a hand-edited
 * or programmatically-generated file still imports.
 */
export function parseCollectionImport(fileText: string): CollectionImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fileText);
  } catch {
    return { valid: [], errors: ['File is not valid JSON'] };
  }

  const entries = Array.isArray(parsed)
    ? parsed
    : typeof parsed === 'object' && parsed !== null && Array.isArray((parsed as Record<string, unknown>).records)
    ? (parsed as { records: unknown[] }).records
    : undefined;

  if (!entries) {
    return { valid: [], errors: ['Expected an array of records, or an export file with a "records" array'] };
  }

  const valid: VinylRecord[] = [];
  const errors: string[] = [];
  entries.forEach((entry, index) => {
    const { record, error } = validateEntry(entry, index);
    if (record) valid.push(record);
    if (error) errors.push(error);
  });

  return { valid, errors };
}
