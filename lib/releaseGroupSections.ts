import { SearchResultGroup } from '../types';

export interface ReleaseGroupSection {
  key: 'albums' | 'singles' | 'others';
  title: string;
  groups: SearchResultGroup[];
}

function getPrimaryType(group: SearchResultGroup): string {
  return group.primaryType?.trim().toLowerCase() ?? '';
}

function isAlbumGroup(group: SearchResultGroup): boolean {
  return getPrimaryType(group) === 'album';
}

function isSingleOrEpGroup(group: SearchResultGroup): boolean {
  const primaryType = getPrimaryType(group);
  return primaryType === 'single' || primaryType === 'ep';
}

// Keeps existing API ordering within each category while enforcing the
// category section order requested by UX: Albums, Singles/EPs, Others.
export function buildReleaseGroupSections(groups: SearchResultGroup[]): ReleaseGroupSection[] {
  const albums = groups.filter(isAlbumGroup);
  const singles = groups.filter(isSingleOrEpGroup);
  const others = groups.filter((group) => !isAlbumGroup(group) && !isSingleOrEpGroup(group));

  const sections: ReleaseGroupSection[] = [
    { key: 'albums', title: 'Albums', groups: albums },
    { key: 'singles', title: 'Singles & EPs', groups: singles },
    { key: 'others', title: 'Others', groups: others },
  ];

  return sections.filter((section) => section.groups.length > 0);
}
