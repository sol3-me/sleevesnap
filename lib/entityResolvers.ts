import { searchArtistEntities, searchLabelEntities } from '../services/vinylService';
import { ArtistSearchEntity, LabelSearchEntity } from '../types';

function chooseBestEntityByName<T extends { name: string }>(query: string, entities: T[]): T | undefined {
  if (entities.length === 0) return undefined;

  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return entities[0];

  const exact = entities.find((entity) => entity.name.trim().toLowerCase() === normalizedQuery);
  return exact ?? entities[0];
}

export async function resolveArtistEntityByName(query: string): Promise<ArtistSearchEntity | undefined> {
  const trimmed = query.trim();
  if (!trimmed) return undefined;

  const result = await searchArtistEntities({
    query: trimmed,
    page: 1,
    pageSize: 10,
  });

  return chooseBestEntityByName(trimmed, result.entities);
}

export async function resolveLabelEntityByName(query: string): Promise<LabelSearchEntity | undefined> {
  const trimmed = query.trim();
  if (!trimmed) return undefined;

  const result = await searchLabelEntities({
    query: trimmed,
    page: 1,
    pageSize: 10,
  });

  return chooseBestEntityByName(trimmed, result.entities);
}
