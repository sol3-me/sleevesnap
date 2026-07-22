import { VinylRecord } from '../types';

export const COLLECTION_EXPORT_SCHEMA_VERSION = 1;

export interface CollectionExportFile {
  schemaVersion: typeof COLLECTION_EXPORT_SCHEMA_VERSION;
  app: 'sleevesnap';
  exportedAt: string;
  records: VinylRecord[];
}

export function buildCollectionExport(records: VinylRecord[], now: Date): CollectionExportFile {
  return {
    schemaVersion: COLLECTION_EXPORT_SCHEMA_VERSION,
    app: 'sleevesnap',
    exportedAt: now.toISOString(),
    records,
  };
}

export function serializeCollectionExport(records: VinylRecord[], now: Date): string {
  return JSON.stringify(buildCollectionExport(records, now), null, 2);
}
