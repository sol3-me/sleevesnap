# sleevesnap Development Roadmap

## 1. Core Architecture & PWA (Mobile First)
**Goal:** Create a robust, offline-capable application that feels native on mobile devices while scaling to desktop.

*   **Tech Stack:** React, Tailwind CSS, Vite.
*   **PWA Features:**
    *   **Manifest & Icons:** Ensure "Add to Home Screen" functionality with proper maskingable icons.
    *   **Service Worker:** Implement caching for the "App Shell" (HTML/CSS/JS) so the app loads instantly offline.
    *   **Offline State:** Use `navigator.onLine` listeners to queue actions (like adding a record) when offline and sync when online.
*   **Responsive Strategy:**
    *   Use CSS Grid/Flexbox for fluid layouts.
    *   *Mobile:* Bottom navigation bar, stackable cards, touch-optimized tap targets (min 44px).
    *   *Desktop:* Sidebar navigation, grid view for album art, data tables for bulk editing.

## 2. Authentication & Data Persistence (Free Tier)
**Goal:** Secure user data using zero-cost infrastructure.

*   **Provider:** **Firebase (Spark Plan - Free)**.
*   **Authentication:**
    *   **Google Sign-In (Firebase Auth):** Pre-configured, secure, and familiar. No custom backend required.
    *   *Implementation:* Wrap the app in an Auth Provider context.
*   **Database (Firestore):**
    *   Structure: `users/{userId}/collection/{recordId}`.
    *   *Why:* Free tier allows 50k reads/20k writes per day, sufficient for personal collections.
*   **Storage:**
    *   Avoid storing user-uploaded images in Firebase Storage (bandwidth costs).
    *   *Strategy:* Store URLs from external APIs (MusicBrainz/Cover Art Archive) or small Base64 thumbnails for custom scans only if necessary.

## 3. Data Sources & Exploration (Free APIs)
**Goal:** Enrich the user's collection with metadata without incurring API costs.

*   **Primary Source: MusicBrainz API (Free)**
    *   Open-source music encyclopedia. No rate limits if User-Agent is properly set.
    *   Use for: Validating artist names, retrieving release dates, tracklists.
*   **Image Source: Cover Art Archive (Free)**
    *   Hosted by Internet Archive.
    *   Use for: High-res cover art URLs based on MusicBrainz IDs (MBID).
*   **Search/Discovery: Gemini API (Free Tier)**
    *   Use `gemini-3-flash-preview` for fuzzy search/recommendations (e.g., "Find me albums similar to Pink Floyd's generic psychedelic rock").

## 4. The USP: Intelligent Multi-Vinyl Scanner
**Goal:** Identify multiple records from a single camera frame or uploaded image.

### Algorithm Strategy
We will utilize a **Hybrid AI Vision approach** to avoid training custom ML models (which are heavy for mobile web).

1.  **Image Acquisition:**
    *   Use HTML5 `getUserMedia` for live camera feed.
    *   Allow upload for high-res photos.

2.  **Detection & Recognition (Gemini 2.5 Flash):**
    *   *Why:* It supports "multimodal" input (images + text prompt).
    *   *Process:*
        1.  Send the image to Gemini.
        2.  Prompt: *"Detect all vinyl record covers in this image. Return a JSON list containing 'Artist', 'Album Title', and 'Confidence'. Ignore background objects."*
        3.  Gemini performs effectively both Object Detection (finding the square shapes) and OCR/Knowledge Retrieval (reading "Beatles" and recognizing the *Abbey Road* crossing).

3.  **Validation (MusicBrainz):**
    *   Take the raw strings from Gemini (e.g., "Pink Floyd - Dark Side").
    *   Query MusicBrainz API to get the canonical metadata (Year, Genre, MBID) and high-res cover art.

4.  **Optimizations:**
    *   **Client-Side Compression:** Resize images to max 1024px width before sending to API to reduce latency.
    *   **Confidence Threshold:** Only auto-suggest items with >80% confidence; ask user to verify others.

## 5. Caching & Performance
**Goal:** Minimize API calls and keep the app snappy.

*   **Image Caching:** Browser standard HTTP cache handles Cover Art Archive images efficiently.
*   **Common Scans (Firestore Shared Cache):**
    *   Create a public `popular_records` collection in Firestore.
    *   When a user scans a record, check if we have full metadata cached locally first (IndexedDB) or in the global "Popular" list to avoid hitting MusicBrainz.
*   **Optimistic UI:** Show the scanned result immediately while fetching the high-res cover art in the background.

## 6. Testing Strategy
*   **Unit Tests (Vitest):** Test metadata parsing logic (MusicBrainz JSON to App Model).
*   **Integration Tests:** Mock the Camera API and Gemini API to test the "Scan -> Identify -> Add" flow.
*   **E2E Tests:** Ensure the Auth flow and Offline syncing work as expected.
