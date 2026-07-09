# sleevesnap Development Roadmap

> **Status note (July 2026):** parts of this document predate the current architecture and are superseded:
>
> - **§2 (Firebase Auth/Firestore)** — the app is self-hosted with Express + SQLite and no third-party BaaS; the interim name-only login was removed entirely, with real multi-user accounts + social sign-in planned as a proper future phase (see `ux-improvement-plan.md` §1.6). Firestore-based storage and the Firestore "popular records" shared cache (§5) are deferred as potential future enhancements, depending on uptake until the self hosting route becomes too burdensome.
> - **§6 (Vitest)** — the repo standardized on Node's built-in `node:test` runner (`tsx --test`); all suites use it. Don't introduce Vitest for parity's sake.
> - Current UX direction, priorities, and delivery order live in `ux-improvement-plan.md`; this file remains useful for the product vision (§1, §3, §4) — PWA, MusicBrainz/Cover Art Archive sourcing, and the multi-record scanner USP all still stand.

## 1. Core Architecture & PWA (Mobile First)

**Goal:** Create a robust, offline-capable application that feels native on mobile devices while scaling to desktop.

- **Tech Stack:** React, Tailwind CSS, Vite.
- **PWA Features:**
  - **Manifest & Icons:** Ensure "Add to Home Screen" functionality with proper maskingable icons.
  - **Service Worker:** Implement caching for the "App Shell" (HTML/CSS/JS) so the app loads instantly offline.
  - **Offline State:** Use `navigator.onLine` listeners to queue actions (like adding a record) when offline and sync when online.
- **Responsive Strategy:**
  - Use CSS Grid/Flexbox for fluid layouts.
  - _Mobile:_ Bottom navigation bar, stackable cards, touch-optimized tap targets (min 44px).
  - _Desktop:_ Sidebar navigation, grid view for album art, data tables for bulk editing.

## 2. Authentication & Data Persistence (Free Tier)

**Goal:** Secure user data using zero-cost infrastructure.

- **Provider:** **Firebase (Spark Plan - Free)**.
- **Authentication:**
  - **Google Sign-In (Firebase Auth):** Pre-configured, secure, and familiar. No custom backend required.
  - _Implementation:_ Wrap the app in an Auth Provider context.
- **Database (Firestore):**
  - Structure: `users/{userId}/collection/{recordId}`.
  - _Why:_ Free tier allows 50k reads/20k writes per day, sufficient for personal collections.
- **Storage:**
  - Avoid storing user-uploaded images in Firebase Storage (bandwidth costs).
  - _Strategy:_ Store URLs from external APIs (MusicBrainz/Cover Art Archive) or small Base64 thumbnails for custom scans only if necessary.

## 3. Data Sources & Exploration (Free APIs)

**Goal:** Enrich the user's collection with metadata without incurring API costs.

- **Primary Source: MusicBrainz API (Free)**
  - Open-source music encyclopedia. No rate limits if User-Agent is properly set.
  - Use for: Validating artist names, retrieving release dates, tracklists.
- **Image Source: Cover Art Archive (Free)**
  - Hosted by Internet Archive.
  - Use for: High-res cover art URLs based on MusicBrainz IDs (MBID).
- **Search/Discovery: MusicBrainz API (Free)**
- Use MusicBrainz text search and metadata endpoints for recommendations and fuzzy matching.

## 4. The USP: Intelligent Multi-Vinyl Scanner

**Goal:** Identify multiple records from a single camera frame or uploaded image.

### Algorithm Strategy

We will utilize a **Hybrid AI Vision approach** to avoid training custom ML models (which are heavy for mobile web).

1.  **Image Acquisition:**
    - Use HTML5 `getUserMedia` for live camera feed.
    - Allow upload for high-res photos.

2.  **Detection & Recognition (Vision Provider):**
    - _Why:_ It supports multimodal image + text analysis for cover detection.
    - _Process:_
      1.  Send the image to the configured vision provider.
      2.  Prompt: _"Detect all vinyl record covers in this image. Return a JSON list containing 'Artist', 'Album Title', and 'Confidence'. Ignore background objects."_
      3.  The provider performs object detection and text/knowledge extraction to identify likely records.

3.  **Validation (MusicBrainz):**
    - Take the raw strings from the vision response (e.g., "Pink Floyd - Dark Side").
    - Query MusicBrainz API to get the canonical metadata (Year, Genre, MBID) and high-res cover art.
  - Keep and surface the raw vision guesses (with confidence) even when validation has zero matches, so the user can still act on likely candidates.

5.  **Scan-to-Discover Standardization:**
  - The scan fallback UI should reuse the same release-group search model as Discover (same query semantics, same result grouping), with the captured photo shown alongside results.
  - AI's role in this path is query-seeding and candidate hints, not a hidden final decision.
  - Regression test fixture to preserve: AI guessed `Various Artists - Timeisnow (TIN035)` at high confidence from sleeve text, but the text was a label imprint rather than the album title. The system should preserve this guess as a hint while steering users toward validated release-group results.

4.  **Optimizations:**
    - **Client-Side Compression:** Resize images to max 1024px width before sending to API to reduce latency.
    - **Confidence Threshold:** Only auto-suggest items with >80% confidence; ask user to verify others.

## 5. Caching & Performance

**Goal:** Minimize API calls and keep the app snappy.

- **Image Caching:** Browser standard HTTP cache handles Cover Art Archive images efficiently.
- **Common Scans (Firestore Shared Cache):**
  - Create a public `popular_records` collection in Firestore.
  - When a user scans a record, check if we have full metadata cached locally first (IndexedDB) or in the global "Popular" list to avoid hitting MusicBrainz.
- **Optimistic UI:** Show the scanned result immediately while fetching the high-res cover art in the background.
- **Scan History Cache (new):** Persist recent captured photos + derived results/queries per user session so users can reopen prior scans without re-uploading or re-calling vision APIs.

## 6. Testing Strategy

- **Unit Tests (Vitest):** Test metadata parsing logic (MusicBrainz JSON to App Model).
- **Integration Tests:** Mock the Camera API and vision provider API to test the "Scan -> Identify -> Add" flow.
- **E2E Tests:** Ensure the Auth flow and Offline syncing work as expected.
