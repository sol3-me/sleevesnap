import React, { useEffect, useMemo, useState } from 'react';
import { VinylRecord } from '../types';

interface VinylCardProps {
  record: VinylRecord;
  onRemove?: (id: string) => void;
}

export const VinylCard: React.FC<VinylCardProps> = ({ record, onRemove }) => {
  const coverCandidates = useMemo(() => {
    const releaseCoverFromMbid = record.musicBrainzId
      ? `https://coverartarchive.org/release/${record.musicBrainzId}/front-500`
      : undefined;
    const releaseGroupCoverFromId = record.releaseGroupId
      ? `https://coverartarchive.org/release-group/${record.releaseGroupId}/front-500`
      : undefined;

    return Array.from(
      new Set(
        [record.coverUrl, record.thumbnailUrl, releaseGroupCoverFromId, releaseCoverFromMbid]
          .map((url) => url?.trim())
          .filter((url): url is string => Boolean(url)),
      ),
    );
  }, [record.coverUrl, record.musicBrainzId, record.releaseGroupId, record.thumbnailUrl]);

  const [coverIndex, setCoverIndex] = useState(0);

  useEffect(() => {
    setCoverIndex(0);
  }, [coverCandidates]);

  const activeCover = coverCandidates[coverIndex];
  const hasMoreCoverCandidates = coverIndex < coverCandidates.length - 1;

  const musicBrainzReleaseUrl =
    record.releaseUrl ??
    (record.musicBrainzId ? `https://musicbrainz.org/release/${record.musicBrainzId}` : undefined);
  const musicBrainzGroupUrl =
    record.releaseGroupUrl ??
    (record.releaseGroupId ? `https://musicbrainz.org/release-group/${record.releaseGroupId}` : undefined);

  const discogsSearchUrl = `https://www.discogs.com/search/?q=${encodeURIComponent(
    `${record.artist} ${record.title}`,
  )}&type=all`;

  const metadata = [
    record.releaseDate ?? record.year,
    record.country,
    record.format,
    record.releaseStatus,
    record.genre,
  ].filter((value): value is string => Boolean(value));

  return (
    <div className="bg-vinyl-800 rounded-lg overflow-hidden shadow-lg hover:shadow-xl transition-all border border-vinyl-700">
      <div className="relative aspect-square bg-vinyl-900">
        {activeCover ? (
          <img
            src={activeCover}
            alt={`${record.title} cover`}
            className="w-full h-full object-cover"
            loading="lazy"
            onError={() => {
              if (hasMoreCoverCandidates) {
                setCoverIndex((idx) => idx + 1);
              } else {
                setCoverIndex(coverCandidates.length);
              }
            }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-400 text-sm">
            No cover art
          </div>
        )}
        {/* Vinyl Shine Effect */}
        <div className="absolute inset-0 bg-gradient-to-tr from-white/5 to-transparent pointer-events-none"></div>
        
        {/* Record Groove Texture Overlay (Subtle) */}
        <div className="absolute inset-0 rounded-full border-2 border-white/5 m-2 pointer-events-none opacity-50"></div>
      </div>
      
      <div className="p-4">
        <h3 className="font-bold text-lg text-white truncate" title={record.title}>{record.title}</h3>
        <p className="text-vinyl-accent font-medium truncate">{record.artist}</p>

        <p className="mt-2 text-xs text-vinyl-muted">
          {metadata.join(' • ') || 'Metadata unavailable'}
        </p>

        {record.edition && (
          <p className="mt-1 text-xs text-gray-400 truncate" title={record.edition}>
            {record.edition}
          </p>
        )}

        <div className="mt-3 flex items-end justify-between gap-2">
          <div className="flex flex-wrap gap-2 text-xs">
            {musicBrainzReleaseUrl && (
              <a
                href={musicBrainzReleaseUrl}
                target="_blank"
                rel="noreferrer"
                className="px-2 py-1 rounded bg-vinyl-700 text-gray-200 hover:text-white hover:bg-vinyl-600"
              >
                MusicBrainz Release
              </a>
            )}
            {musicBrainzGroupUrl && (
              <a
                href={musicBrainzGroupUrl}
                target="_blank"
                rel="noreferrer"
                className="px-2 py-1 rounded bg-vinyl-700 text-gray-200 hover:text-white hover:bg-vinyl-600"
              >
                Release Group
              </a>
            )}
            <a
              href={record.discogsUrl ?? discogsSearchUrl}
              target="_blank"
              rel="noreferrer"
              className="px-2 py-1 rounded bg-vinyl-700 text-gray-200 hover:text-white hover:bg-vinyl-600"
            >
              {record.discogsUrl ? 'Discogs' : 'Discogs Search'}
            </a>
          </div>

          {onRemove && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onRemove(record.id);
              }}
              className="shrink-0 px-2 py-1 text-xs rounded bg-red-900/70 text-red-200 border border-red-700 hover:bg-red-700 hover:text-white"
              aria-label="Remove record"
            >
              Remove
            </button>
          )}
        </div>
      </div>
    </div>
  );
};