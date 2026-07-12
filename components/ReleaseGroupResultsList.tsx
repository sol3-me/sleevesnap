import { useEffect, useState } from 'react';
import { groupReleasesByFormatBucket } from '../lib/filters';
import { SearchGroupReleases, SearchRelease, SearchResultGroup } from '../types';
import { Icons } from './Icons';

interface ReleaseGroupResultsListProps {
    groups: SearchResultGroup[];
    groupReleases: Record<string, SearchGroupReleases>;
    expandedGroups: Record<string, boolean>;
    loadingGroupIds: Record<string, true>;
    onToggleGroup: (group: SearchResultGroup) => void | Promise<void>;
    onReleaseAction: (record: SearchRelease) => void;
    isReleaseActionDisabled?: (record: SearchRelease) => boolean;
    getReleaseActionLabel?: (record: SearchRelease, disabled: boolean) => string;
    getReleaseActionClassName?: (record: SearchRelease, disabled: boolean) => string;
    getVisibleReleases?: (group: SearchResultGroup, detail?: SearchGroupReleases) => SearchRelease[];
    isGroupOwned?: (releaseGroupId: string) => boolean;
    showGroupLinks?: boolean;
    groupContainerClassName?: string;
    emptyReleasesMessage?: string;
    compact?: boolean;
    showFormatBuckets?: boolean;
    showReleaseCount?: boolean;
    onArtistNameClick?: (artistName: string) => void | Promise<void>;
    labelContext?: { id?: string; name: string };
    onLabelNameClick?: (labelName: string, labelId?: string) => void | Promise<void>;
}

function formatCountry(countryCode?: string) {
    if (!countryCode) return undefined;
    const specialRegions: Record<string, string> = {
        XE: 'Europe',
        XW: 'Worldwide',
        XG: 'East Germany',
    };

    if (specialRegions[countryCode]) {
        return `${specialRegions[countryCode]} (${countryCode})`;
    }

    try {
        const name = new Intl.DisplayNames(['en'], { type: 'region' }).of(countryCode);
        if (name && name !== countryCode) {
            return `${name} (${countryCode})`;
        }
    } catch {
        // Ignore and fall through to raw region code.
    }

    return countryCode;
}

export function ReleaseGroupResultsList({
    groups,
    groupReleases,
    expandedGroups,
    loadingGroupIds,
    onToggleGroup,
    onReleaseAction,
    isReleaseActionDisabled,
    getReleaseActionLabel,
    getReleaseActionClassName,
    getVisibleReleases,
    isGroupOwned,
    showGroupLinks = true,
    groupContainerClassName,
    emptyReleasesMessage = 'No releases found for this group.',
    compact = false,
    showFormatBuckets = false,
    showReleaseCount = true,
    onArtistNameClick,
    labelContext,
    onLabelNameClick,
}: ReleaseGroupResultsListProps) {
    const [failedCovers, setFailedCovers] = useState<Record<string, true>>({});

    useEffect(() => {
        setFailedCovers({});
    }, [groups]);

    const getCoverFailureKey = (recordId: string, coverUrl: string) => `${recordId}::${coverUrl}`;

    const handleCoverError = (recordId: string, coverUrl: string) => {
        setFailedCovers((prev) => ({
            ...prev,
            [getCoverFailureKey(recordId, coverUrl)]: true,
        }));
    };

    const renderCoverThumb = (
        id: string,
        title: string,
        urlOrUrls?: string | Array<string | undefined>,
        placeholderText = 'No cover',
    ) => {
        const candidateUrls = (Array.isArray(urlOrUrls) ? urlOrUrls : [urlOrUrls])
            .map((url) => url?.trim())
            .filter((url): url is string => Boolean(url))
            .filter((url) => !failedCovers[getCoverFailureKey(id, url)]);

        const activeUrl = candidateUrls[0];

        if (activeUrl) {
            return (
                <img
                    src={activeUrl}
                    alt={title}
                    onError={() => handleCoverError(id, activeUrl)}
                    className="w-full h-full object-cover"
                />
            );
        }

        return (
            <div className="w-full h-full bg-vinyl-700 text-gray-300 flex flex-col items-center justify-center text-[10px] leading-tight">
                <span className="text-lg" aria-hidden="true">♪</span>
                <span>{placeholderText}</span>
            </div>
        );
    };

    return (
        <div className="space-y-3">
            {groups.map((group) => {
                const details = groupReleases[group.releaseGroupId];
                const releases = getVisibleReleases
                    ? getVisibleReleases(group, details)
                    : (details?.releases ?? []);
                const groupedReleases = showFormatBuckets
                    ? groupReleasesByFormatBucket<SearchRelease>(releases)
                    : [{ bucket: '', releases }];
                const isExpanded = Boolean(expandedGroups[group.releaseGroupId]);
                const loadingGroup = Boolean(loadingGroupIds[group.releaseGroupId]);
                const releaseCount = group.totalReleases;
                const canExpand = !showReleaseCount || releaseCount !== 1;
                const discogsSearchUrl = `https://www.discogs.com/search/?q=${encodeURIComponent(
                    `${group.artist} ${group.title}`,
                )}&type=master`;
                const discogsGroupUrl = group.discogsMasterUrl ?? details?.discogsMasterUrl ?? discogsSearchUrl;
                const groupOwned = isGroupOwned?.(group.releaseGroupId) ?? false;

                const outerClassName = groupContainerClassName
                    ?? 'bg-vinyl-800/60 rounded-2xl border border-white/5 hover:border-white/10 transition-colors overflow-hidden';

                return (
                    <div key={group.releaseGroupId} className={outerClassName}>
                        <div
                            onClick={() => onToggleGroup(group)}
                            className={`w-full text-left ${compact ? 'p-3' : 'p-4'} flex flex-col sm:flex-row gap-4 cursor-pointer`}
                        >
                            <div className="flex gap-4 flex-1 min-w-0">
                                <div className={`${compact ? 'w-14 h-14 rounded-lg' : 'w-20 h-20 rounded-xl'} overflow-hidden border border-white/10 shrink-0 bg-vinyl-900`}>
                                    {renderCoverThumb(`group-${group.releaseGroupId}`, group.title, group.thumbnailUrl, 'No art')}
                                </div>

                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                        <h3 className={`${compact ? 'text-sm' : 'text-base'} font-semibold text-white truncate min-w-0`}>{group.title}</h3>
                                        <div className="flex items-center gap-1.5 shrink-0">
                                            {group.primaryType && (
                                                <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-gray-400">
                                                    {group.primaryType}
                                                </span>
                                            )}
                                            {groupOwned && (
                                                <span
                                                    className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-green-500/15 border border-green-500/20 text-green-400"
                                                    title="You already own at least one pressing of this release"
                                                >
                                                    Owned
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                    <p className={`${compact ? 'text-xs' : 'text-sm'} text-gray-400 truncate mt-0.5`}>
                                        {onArtistNameClick ? (
                                            <button
                                                type="button"
                                                className="hover:text-white underline underline-offset-2 transition-colors"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    void onArtistNameClick(group.artist);
                                                }}
                                            >
                                                {group.artist}
                                            </button>
                                        ) : (
                                            group.artist
                                        )}
                                    </p>
                                    {labelContext?.name && (
                                        <p className="text-xs text-gray-500 truncate mt-0.5">
                                            Label:{' '}
                                            {onLabelNameClick ? (
                                                <button
                                                    type="button"
                                                    className="hover:text-white underline underline-offset-2 transition-colors"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        void onLabelNameClick(labelContext.name, labelContext.id);
                                                    }}
                                                >
                                                    {labelContext.name}
                                                </button>
                                            ) : (
                                                labelContext.name
                                            )}
                                        </p>
                                    )}
                                    <p className="text-xs text-gray-500 mt-1.5 truncate">
                                        {[
                                            group.firstReleaseDate?.slice(0, 4),
                                            showReleaseCount ? `${releaseCount} release${releaseCount === 1 ? '' : 's'}` : undefined,
                                            group.availableFormats.length > 0 ? group.availableFormats.join(', ') : undefined,
                                        ]
                                            .filter(Boolean)
                                            .join(' · ')}
                                    </p>
                                    {showGroupLinks && (
                                        <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px]">
                                            <a
                                                href={group.releaseGroupUrl}
                                                target="_blank"
                                                rel="noreferrer"
                                                className="inline-flex items-center gap-1 text-gray-500 hover:text-vinyl-accent transition-colors"
                                                onClick={(e) => e.stopPropagation()}
                                            >
                                                MusicBrainz <Icons.ExternalLink />
                                            </a>
                                            <a
                                                href={discogsGroupUrl}
                                                target="_blank"
                                                rel="noreferrer"
                                                className="inline-flex items-center gap-1 text-gray-500 hover:text-vinyl-accent transition-colors"
                                                onClick={(e) => e.stopPropagation()}
                                            >
                                                {group.discogsMasterUrl || details?.discogsMasterUrl ? 'Discogs Master' : 'Discogs Search'} <Icons.ExternalLink />
                                            </a>
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="sm:self-center shrink-0">
                                <button
                                    type="button"
                                    aria-expanded={isExpanded}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        void onToggleGroup(group);
                                    }}
                                    className={`w-full sm:w-auto ${compact ? 'sm:min-w-[130px]' : 'sm:min-w-[150px]'} px-4 py-2 rounded-full border border-white/10 bg-white/5 text-sm font-medium text-gray-200 flex items-center justify-center gap-1.5 hover:bg-white/10 transition-colors`}
                                >
                                    <span>{canExpand ? (isExpanded ? 'Hide releases' : 'Show releases') : 'Single release'}</span>
                                    <span className={`transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}><Icons.ChevronDown /></span>
                                </button>
                            </div>
                        </div>

                        {isExpanded && (
                            <div className={`${compact ? 'px-3 pb-3' : 'px-4 pb-4'} space-y-3 border-t border-white/5`}>
                                {(!details || loadingGroup) && (
                                    <div className="flex items-center gap-2 text-sm text-gray-500 py-3">
                                        <span className="w-3.5 h-3.5 border-2 border-vinyl-accent border-t-transparent rounded-full animate-spin" />
                                        Loading release variants...
                                    </div>
                                )}

                                {details && releases.length === 0 && (
                                    <div className="text-sm text-gray-500 py-3">
                                        {emptyReleasesMessage}
                                    </div>
                                )}

                                {groupedReleases.map(({ bucket, releases: bucketReleases }) => (
                                    <div key={bucket || 'all-releases'}>
                                        {showFormatBuckets && bucket && (
                                            <h5 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2 mt-3 first:mt-0">
                                                {bucket}
                                            </h5>
                                        )}
                                        <div className="space-y-3">
                                            {bucketReleases.map((record) => {
                                                const country = formatCountry(record.country);
                                                const disabled = isReleaseActionDisabled?.(record) ?? false;
                                                const actionLabel = getReleaseActionLabel?.(record, disabled) ?? (disabled ? 'Unavailable' : 'Select');
                                                const actionClassName = getReleaseActionClassName?.(record, disabled)
                                                    ?? (disabled
                                                        ? 'self-end text-xs font-semibold bg-white/5 border border-white/10 text-gray-500 px-3.5 py-1.5 rounded-full cursor-default'
                                                        : 'self-end text-xs font-semibold bg-gradient-to-br from-vinyl-accent to-red-500 hover:from-vinyl-accent-soft hover:to-red-400 text-white px-3.5 py-1.5 rounded-full transition-colors');

                                                return (
                                                    <div key={record.id} className={`flex ${compact ? 'bg-vinyl-950/70 rounded-lg p-2.5' : 'bg-vinyl-900/70 rounded-xl p-3'} border border-white/5 gap-3`}>
                                                        <div className={`${compact ? 'w-11 h-11 rounded-md' : 'w-20 h-20 rounded-lg'} overflow-hidden border border-white/10 shrink-0`}>
                                                            {renderCoverThumb(record.id, record.title, [record.coverUrl, group.thumbnailUrl], 'No art')}
                                                        </div>
                                                        <div className="min-w-0 flex-1 flex flex-col justify-between">
                                                            <div>
                                                                <h4 className={`${compact ? 'text-sm' : 'text-base'} font-bold text-white truncate`}>{record.title}</h4>
                                                                <p className={`${compact ? 'text-xs' : 'text-sm'} text-gray-400 truncate`}>
                                                                    {onArtistNameClick ? (
                                                                        <button
                                                                            type="button"
                                                                            className="hover:text-white underline underline-offset-2 transition-colors"
                                                                            onClick={() => {
                                                                                void onArtistNameClick(record.artist);
                                                                            }}
                                                                        >
                                                                            {record.artist}
                                                                        </button>
                                                                    ) : (
                                                                        record.artist
                                                                    )}
                                                                </p>
                                                                {labelContext?.name && (
                                                                    <p className="text-xs text-gray-500 truncate">
                                                                        Label:{' '}
                                                                        {onLabelNameClick ? (
                                                                            <button
                                                                                type="button"
                                                                                className="hover:text-white underline underline-offset-2 transition-colors"
                                                                                onClick={() => {
                                                                                    void onLabelNameClick(labelContext.name, labelContext.id);
                                                                                }}
                                                                            >
                                                                                {labelContext.name}
                                                                            </button>
                                                                        ) : (
                                                                            labelContext.name
                                                                        )}
                                                                    </p>
                                                                )}
                                                                <p className="text-xs text-gray-500 mt-1 truncate">
                                                                    {[record.year, country, record.format, record.releaseStatus, record.genre]
                                                                        .filter(Boolean)
                                                                        .join(' • ') || 'Metadata unavailable'}
                                                                </p>
                                                                {record.musicBrainzId && (
                                                                    <p className="text-xs text-gray-500 truncate">
                                                                        {record.edition ? `${record.edition} • ` : ''}
                                                                        <a
                                                                            href={record.releaseUrl ?? `https://musicbrainz.org/release/${record.musicBrainzId}`}
                                                                            target="_blank"
                                                                            rel="noreferrer"
                                                                            className="text-vinyl-accent hover:text-white underline"
                                                                        >
                                                                            MBID {record.musicBrainzId.slice(0, 8)}
                                                                        </a>
                                                                    </p>
                                                                )}
                                                            </div>
                                                            <button
                                                                onClick={() => !disabled && onReleaseAction(record)}
                                                                disabled={disabled}
                                                                className={actionClassName}
                                                            >
                                                                {actionLabel}
                                                            </button>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}
