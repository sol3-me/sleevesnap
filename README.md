# sleevesnap

Point your phone at a record sleeve and it lands in your collection — title, artist, year, and artwork identified automatically, with an AI vision fallback when a straightforward lookup doesn't find a match.

## Tech Stack

- **Frontend:** [React 19](https://react.dev/) + [TanStack Router](https://tanstack.com/router) on [Vite](https://vitejs.dev/), styled with [Tailwind CSS 4](https://tailwindcss.com/)
- **Backend:** [Express 5](https://expressjs.com/) + [better-sqlite3](https://github.com/WiseLibs/better-sqlite3)
- **Auth:** [Firebase Authentication](https://firebase.google.com/docs/auth) (Google, GitHub, email/password), verified server-side per request
- **Catalog data:** [MusicBrainz](https://musicbrainz.org/), with optional [Discogs](https://www.discogs.com/developers) and [Last.fm](https://www.last.fm/api) enrichment
- **AI vision fallback:** [Gemini](https://ai.google.dev/) or [OpenAI](https://platform.openai.com/), used only when a direct catalog match fails
- **Storage:** local filesystem for cover art (a Docker volume), no external object storage
- **Deployment:** Docker → self-hosted runner via GitHub Actions, with PR-labeled [automatic versioned releases](.github/workflows/auto-release.yml)

## Getting Started

### Prerequisites

- Node.js
- A [Firebase](https://console.firebase.google.com/) project with Authentication enabled
- Optional: a [Discogs](https://www.discogs.com/settings/developers) token, [Last.fm](https://www.last.fm/api/account/create) API key, and/or [Gemini](https://aistudio.google.com/apikey)/[OpenAI](https://platform.openai.com/api-keys) API key for enrichment and the AI vision fallback

### Installation

```bash
git clone https://github.com/sol3-me/sleevesnap.git
cd sleevesnap
npm install
```

### Configuration

Copy the example env file and fill in your values:

```bash
cp .env.example .env
```

See [`.env.example`](.env.example) for the full list of variables and what each does — only `FIREBASE_PROJECT_ID` and the `VITE_FIREBASE_*` web app config are required; everything else (Discogs, Last.fm, vision APIs) is optional and degrades gracefully when left blank.

### Development

Run the frontend and API as two separate processes:

```bash
npm run dev:server   # API on :3001 (terminal 1)
npm run dev          # frontend on :3000, proxies /api and /covers (terminal 2)
```

### Production Build

```bash
npm run build
npm start
```

### Docker

```bash
docker build -t sleevesnap .
```

See [`Dockerfile`](Dockerfile) for build-arg and runtime env var details.

### Testing

```bash
npm test
```

## License

[PolyForm Noncommercial License 1.0.0](LICENSE) — free for personal/noncommercial use; commercial use requires a separate license from the author.
