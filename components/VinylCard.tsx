import React, { useEffect, useMemo, useState } from 'react';
import { VinylRecord } from '../types';
import { Icons } from './Icons';

interface VinylCardProps {
  record: VinylRecord;
  onRemove?: (id: string) => void;
  onArtistClick?: (artistName: string) => void | Promise<void>;
  onEditCover?: (record: VinylRecord) => void;
}

export const VinylCard: React.FC<VinylCardProps> = ({ record, onRemove, onArtistClick, onEditCover }) => {
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

  const discogsSearchUrl = `https://www.discogs.com/search/?q=${encodeURIComponent(
    `${record.artist} ${record.title}`,
  )}&type=all`;

  // Keep the metadata line short and scannable: year + format carry the
  // signal; country/status/genre live on the linked MusicBrainz page.
  const metadata = [record.year ?? record.releaseDate?.slice(0, 4), record.format, record.country].filter(
    (value): value is string => Boolean(value),
  );

  return (
    <div className="group bg-vinyl-800 rounded-2xl overflow-hidden border border-white/5 hover:border-white/15 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-black/40">
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
          <div className="w-full h-full flex items-center justify-center text-gray-600">
            <Icons.Disc />
          </div>
        )}
        {/* Subtle sheen so flat artwork doesn't look pasted on */}
        <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-transparent to-white/[0.04] pointer-events-none"></div>

        {onEditCover && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onEditCover(record);
            }}
            className="absolute top-2 left-2 flex items-center justify-center w-10 h-10 md:w-8 md:h-8 rounded-full bg-black/50 backdrop-blur-sm text-gray-300 hover:bg-white/20 hover:text-white transition-colors md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
            aria-label="Change cover"
          >
            <Icons.Camera />
          </button>
        )}

        {onRemove && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onRemove(record.id);
            }}
            className="absolute top-2 right-2 flex items-center justify-center w-10 h-10 md:w-8 md:h-8 rounded-full bg-black/50 backdrop-blur-sm text-gray-300 hover:bg-red-500/90 hover:text-white transition-colors md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
            aria-label="Remove record"
          >
            <Icons.Trash />
          </button>
        )}
      </div>

      <div className="p-3.5">
        <h3 className="font-semibold text-sm text-white truncate" title={record.title}>{record.title}</h3>
        <p className="text-xs text-gray-400 truncate mt-0.5" title={record.artist}>
          {onArtistClick ? (
            <button
              type="button"
              className="hover:text-white underline underline-offset-2 transition-colors"
              onClick={() => {
                void onArtistClick(record.artist);
              }}
            >
              {record.artist}
            </button>
          ) : (
            record.artist
          )}
        </p>

        {metadata.length > 0 && (
          <p className="mt-1.5 text-[11px] text-gray-500 truncate">{metadata.join(' · ')}</p>
        )}

        {record.edition && (
          <p className="mt-0.5 text-[11px] text-gray-500 truncate italic" title={record.edition}>
            {record.edition}
          </p>
        )}

        <div className="mt-2.5 flex items-center gap-3 text-[11px]">
          {musicBrainzReleaseUrl && (
            <a
              href={musicBrainzReleaseUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-gray-500 hover:text-vinyl-accent transition-colors"
            >
              MusicBrainz <Icons.ExternalLink />
            </a>
          )}
          <a
            href={record.discogsUrl ?? discogsSearchUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-gray-500 hover:text-vinyl-accent transition-colors"
          >
            Discogs <Icons.ExternalLink />
          </a>
        </div>
      </div>
    </div>
  );
};
