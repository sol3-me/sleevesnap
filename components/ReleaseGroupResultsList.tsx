import { ReactElement, ReactNode, useEffect, useState } from 'react';
import { groupReleasesByFormatAndYear, groupReleasesByFormatBucket } from '../lib/filters';
import { SearchGroupReleases, SearchRelease, SearchResultGroup } from '../types';
import { Icons } from './Icons';

interface ReleaseGroupResultsListProps {
    groups: SearchResultGroup[];
    groupReleases: Record<string, SearchGroupReleases>;
    expandedGroups: Record<string, boolean>;
    loadingGroupIds: Record<string, true>;
    onToggleGroup: (group: SearchResultGroup) => void | Promise<void>;
    /** Adds a sensible representative pressing directly, with no need to expand first. Omit to hide the quick-add button. */
    onQuickAdd?: (group: SearchResultGroup) => void | Promise<void>;
    onReleaseAction: (record: SearchRelease) => void;
    isReleaseActionDisabled?: (record: SearchRelease) => boolean;
    getReleaseActionLabel?: (record: SearchRelease, disabled: boolean) => string;
    getReleaseActionClassName?: (record: SearchRelease, disabled: boolean) => string;
    isGroupOwned?: (releaseGroupId: string) => boolean;
    showGroupLinks?: boolean;
    groupContainerClassName?: string;
    emptyReleasesMessage?: string;
    compact?: boolean;
    showFormatBuckets?: boolean;
    /** Shows the grouped edition count once a group has been expanded. Pre-expand, only date + type are known. */
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

/** Icon for a format bucket/string — returns undefined (no icon) for anything unrecognised. */
function getFormatIcon(format: string): (() => ReactElement) | undefined {
    const normalized = format.toLowerCase();
    if (normalized.includes('vinyl') || normalized === 'lp') return Icons.FormatVinyl;
    if (normalized.includes('cd')) return Icons.FormatCD;
    if (normalized.includes('cassette') || normalized.includes('tape')) return Icons.FormatCassette;
    if (normalized.includes('digital')) return Icons.FormatDigital;
    if (normalized.includes('dvd') || normalized.includes('blu-ray') || normalized.includes('video')) return Icons.FormatVideo;
    return undefined;
}

export function ReleaseGroupResultsList({
    groups,
    groupReleases,
    expandedGroups,
    loadingGroupIds,
    onToggleGroup,
    onQuickAdd,
    onReleaseAction,
    isReleaseActionDisabled,
    getReleaseActionLabel,
    getReleaseActionClassName,
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
    // Which format+year variant groups have their region list expanded —
    // collapsed by default so a dozen near-identical country pressings don't
    // spam the list; power users opt into seeing them via this toggle.
    const [expandedVariants, setExpandedVariants] = useState<Record<string, boolean>>({});
    // Groups with a quick-add in flight — mainstream users can add straight
    // from the collapsed card with no need to expand first.
    const [quickAddingGroupIds, setQuickAddingGroupIds] = useState<Record<string, true>>({});

    useEffect(() => {
        setFailedCovers({});
        setExpandedVariants({});
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

    const renderActionButton = (record: SearchRelease, compactButton: boolean) => {
        const disabled = isReleaseActionDisabled?.(record) ?? false;
        const actionLabel = getReleaseActionLabel?.(record, disabled) ?? (disabled ? 'Unavailable' : 'Select');
        const defaultClassName = disabled
            ? 'text-xs font-semibold bg-white/5 border border-white/10 text-gray-500 px-3.5 py-1.5 rounded-full cursor-default'
            : 'text-xs font-semibold bg-gradient-to-br from-vinyl-accent to-red-500 hover:from-vinyl-accent-soft hover:to-red-400 text-white px-3.5 py-1.5 rounded-full transition-colors';
        const actionClassName = `${getReleaseActionClassName?.(record, disabled) ?? defaultClassName} ${compactButton ? 'self-center shrink-0' : 'self-end'}`;

        return (
            <button onClick={() => !disabled && onReleaseAction(record)} disabled={disabled} className={actionClassName}>
                {actionLabel}
            </button>
        );
    };

    // The full card: cover, title, artist, metadata, MBID link, action button.
    // Used both for a variant group's representative pressing and for the
    // single-release case (a group with no other regions to collapse).
    const renderReleaseCard = (record: SearchRelease, groupThumbnailUrl: SearchResultGroup['thumbnailUrl'], extraContent?: ReactNode) => {
        const country = formatCountry(record.country);

        return (
            <div className={`flex ${compact ? 'bg-vinyl-950/70 rounded-lg p-2.5' : 'bg-vinyl-900/70 rounded-xl p-3'} border border-white/5 gap-3`}>
                <div className={`${compact ? 'w-11 h-11 rounded-md' : 'w-20 h-20 rounded-lg'} overflow-hidden border border-white/10 shrink-0`}>
                    {renderCoverThumb(record.id, record.title, [record.coverUrl, groupThumbnailUrl], 'No art')}
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
                        {extraContent}
                    </div>
                    {renderActionButton(record, false)}
                </div>
            </div>
        );
    };

    // A single region's row inside an expanded variant group — country,
    // status/edition, and MBID, no repeated cover thumbnail (the whole point
    // of collapsing is to stop repeating near-identical visual weight).
    const renderRegionRow = (record: SearchRelease) => {
        const country = formatCountry(record.country) ?? 'Unknown region';

        return (
            <div className={`flex items-center justify-between gap-3 ${compact ? 'bg-vinyl-950/50 p-2' : 'bg-vinyl-950/50 p-2.5'} rounded-lg border border-white/5`}>
                <div className="min-w-0 flex-1">
                    <p className="text-xs text-gray-300 truncate">
                        {[country, record.releaseStatus, record.edition].filter(Boolean).join(' • ')}
                    </p>
                    {record.musicBrainzId && (
                        <a
                            href={record.releaseUrl ?? `https://musicbrainz.org/release/${record.musicBrainzId}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[11px] text-vinyl-accent hover:text-white underline"
                        >
                            MBID {record.musicBrainzId.slice(0, 8)}
                        </a>
                    )}
                </div>
                {renderActionButton(record, true)}
            </div>
        );
    };

    return (
        <div className="space-y-3">
            {groups.map((group) => {
                const details = groupReleases[group.releaseGroupId];
                const releases = details?.releases ?? [];
                const groupedReleases = showFormatBuckets
                    ? groupReleasesByFormatBucket<SearchRelease>(releases)
                    : [{ bucket: '', releases }];
                const isExpanded = Boolean(expandedGroups[group.releaseGroupId]);
                const loadingGroup = Boolean(loadingGroupIds[group.releaseGroupId]);
                // Release count/formats aren't known until a group is
                // deliberately expanded (search itself no longer fetches
                // them — see musicbrainz-data-model.md) — so this is only
                // ever defined post-expand, never as an upfront promise.
                const groupedEditionCount = details ? groupReleasesByFormatAndYear(releases).length : undefined;
                const discogsSearchUrl = `https://www.discogs.com/search/?q=${encodeURIComponent(
                    `${group.artist} ${group.title}`,
                )}&type=master`;
                const discogsGroupUrl = details?.discogsMasterUrl ?? discogsSearchUrl;
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
                                            showReleaseCount && groupedEditionCount !== undefined
                                                ? `${groupedEditionCount} edition${groupedEditionCount === 1 ? '' : 's'}`
                                                : undefined,
                                            details && details.availableFormats.length > 0
                                                ? details.availableFormats.join(', ')
                                                : undefined,
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
                                                {details?.discogsMasterUrl ? 'Discogs Master' : 'Discogs Search'} <Icons.ExternalLink />
                                            </a>
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="sm:self-center shrink-0 flex flex-col sm:items-end gap-2">
                                {onQuickAdd && (() => {
                                    const isQuickAdding = Boolean(quickAddingGroupIds[group.releaseGroupId]);
                                    return (
                                        <button
                                            type="button"
                                            disabled={isQuickAdding}
                                            onClick={async (e) => {
                                                e.stopPropagation();
                                                setQuickAddingGroupIds((prev) => ({ ...prev, [group.releaseGroupId]: true }));
                                                try {
                                                    await onQuickAdd(group);
                                                } finally {
                                                    setQuickAddingGroupIds((prev) => {
                                                        const next = { ...prev };
                                                        delete next[group.releaseGroupId];
                                                        return next;
                                                    });
                                                }
                                            }}
                                            className={`w-full sm:w-auto ${compact ? 'sm:min-w-[130px]' : 'sm:min-w-[150px]'} px-4 py-2 rounded-full bg-gradient-to-br from-vinyl-accent to-red-500 hover:from-vinyl-accent-soft hover:to-red-400 text-white text-sm font-semibold flex items-center justify-center gap-1.5 transition-colors disabled:opacity-60`}
                                        >
                                            {isQuickAdding ? 'Adding...' : 'Add to Collection'}
                                        </button>
                                    );
                                })()}
                                <button
                                    type="button"
                                    aria-expanded={isExpanded}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        void onToggleGroup(group);
                                    }}
                                    className={`w-full sm:w-auto ${compact ? 'sm:min-w-[130px]' : 'sm:min-w-[150px]'} px-4 py-2 rounded-full border border-white/10 bg-white/5 text-sm font-medium text-gray-200 flex items-center justify-center gap-1.5 hover:bg-white/10 transition-colors`}
                                >
                                    <span>{isExpanded ? 'Hide releases' : 'Show releases'}</span>
                                    <span className={`transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}><Icons.ChevronDown /></span>
                                </button>
                            </div>
                        </div>

                        {isExpanded && (
                            <div className={`${compact ? 'px-3 pb-3 pt-3' : 'px-4 pb-4 pt-4'} space-y-3 border-t border-white/5`}>
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

                                {groupedReleases.map(({ bucket, releases: bucketReleases }) => {
                                    const FormatIcon = bucket ? getFormatIcon(bucket) : undefined;
                                    return (
                                    <div key={bucket || 'all-releases'}>
                                        {showFormatBuckets && bucket && (
                                            <h5 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400 pt-4 mt-4 mb-2.5 border-t border-white/5 first:pt-0 first:mt-0 first:border-t-0">
                                                {FormatIcon && <FormatIcon />}
                                                {bucket}
                                            </h5>
                                        )}
                                        <div className="space-y-3">
                                            {groupReleasesByFormatAndYear(bucketReleases).map((variant) => {
                                                const variantKey = `${group.releaseGroupId}::${bucket}::${variant.format}::${variant.year}`;
                                                const hasMultipleRegions = variant.releases.length > 1;
                                                const isVariantExpanded = Boolean(expandedVariants[variantKey]);

                                                const regionToggle = hasMultipleRegions ? (
                                                    <button
                                                        type="button"
                                                        onClick={() =>
                                                            setExpandedVariants((prev) => ({ ...prev, [variantKey]: !prev[variantKey] }))
                                                        }
                                                        className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-vinyl-accent hover:text-white transition-colors"
                                                    >
                                                        {isVariantExpanded ? 'Hide' : 'Show'} all {variant.releases.length} regions
                                                        <span className={`transition-transform duration-200 ${isVariantExpanded ? 'rotate-180' : ''}`}>
                                                            <Icons.ChevronDown />
                                                        </span>
                                                    </button>
                                                ) : undefined;

                                                return (
                                                    <div key={variantKey}>
                                                        {renderReleaseCard(variant.representative, group.thumbnailUrl, regionToggle)}
                                                        {hasMultipleRegions && isVariantExpanded && (
                                                            <div className="mt-2 ml-4 pl-3 border-l-2 border-white/10 space-y-2">
                                                                {variant.releases.map((record) => (
                                                                    <div key={record.id}>{renderRegionRow(record)}</div>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}
