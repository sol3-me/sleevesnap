/**
 * Curated pool of well-known albums whose cover art backs the logged-out
 * landing page's "wall". Entries are resolved against MusicBrainz / Cover
 * Art Archive by the same pipeline as user-requested covers, so the only
 * requirement is that artist + album search cleanly. Deliberately spans
 * eras and genres; extend freely — the wall randomises per request.
 */
export type LandingPoolEntry = { artist: string; album: string };

export const LANDING_POOL: LandingPoolEntry[] = [
  { artist: 'Pink Floyd', album: 'The Dark Side of the Moon' },
  { artist: 'Fleetwood Mac', album: 'Rumours' },
  { artist: 'The Beatles', album: 'Abbey Road' },
  { artist: 'Michael Jackson', album: 'Thriller' },
  { artist: 'Nirvana', album: 'Nevermind' },
  { artist: 'Amy Winehouse', album: 'Back to Black' },
  { artist: 'Radiohead', album: 'OK Computer' },
  { artist: 'Miles Davis', album: 'Kind of Blue' },
  { artist: 'Prince', album: 'Purple Rain' },
  { artist: 'David Bowie', album: 'The Rise and Fall of Ziggy Stardust and the Spiders from Mars' },
  { artist: 'Stevie Wonder', album: 'Songs in the Key of Life' },
  { artist: 'Marvin Gaye', album: "What's Going On" },
  { artist: 'The Clash', album: 'London Calling' },
  { artist: 'Joy Division', album: 'Unknown Pleasures' },
  { artist: 'Kendrick Lamar', album: 'To Pimp a Butterfly' },
  { artist: 'Arctic Monkeys', album: 'AM' },
  { artist: 'Tame Impala', album: 'Currents' },
  { artist: 'Adele', album: '21' },
  { artist: 'Bob Marley & The Wailers', album: 'Exodus' },
  { artist: 'Queen', album: 'A Night at the Opera' },
  { artist: 'Bruce Springsteen', album: 'Born to Run' },
  { artist: 'The Rolling Stones', album: 'Sticky Fingers' },
  { artist: 'Wu-Tang Clan', album: 'Enter the Wu-Tang (36 Chambers)' },
  { artist: 'Lauryn Hill', album: 'The Miseducation of Lauryn Hill' },
  { artist: 'Portishead', album: 'Dummy' },
  { artist: 'Massive Attack', album: 'Mezzanine' },
  { artist: 'Talking Heads', album: 'Remain in Light' },
  { artist: 'The Strokes', album: 'Is This It' },
  { artist: 'Gorillaz', album: 'Demon Days' },
  { artist: 'OutKast', album: 'Stankonia' },
  { artist: 'Daft Punk', album: 'Random Access Memories' },
  { artist: 'Billie Eilish', album: 'When We All Fall Asleep, Where Do We Go?' },
  { artist: 'Taylor Swift', album: '1989' },
  { artist: 'Dua Lipa', album: 'Future Nostalgia' },
  { artist: 'The Beach Boys', album: 'Pet Sounds' },
  { artist: 'Led Zeppelin', album: 'Led Zeppelin IV' },
];
