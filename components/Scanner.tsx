import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AdvancedSearchFields, AdvancedSearchFieldsValue } from '../components/AdvancedSearchFields';
import { ReleaseGroupResultsList } from '../components/ReleaseGroupResultsList';
import { triggerImageDownload } from '../lib/downloadImage';
import { logEvent, logWarn } from '../services/telemetry';
import {
  appendScanHistorySearch,
  createScanHistoryEntry,
  deleteScanHistoryEntry,
  getReleaseGroupReleases,
  listScanHistory,
  scanImage,
  searchVinylReleaseGroups,
  submitScan,
} from '../services/vinylService';
import {
  ScanHistoryEntry,
  ScanVisionSuggestion,
  SearchGroupReleases,
  SearchIntent,
  SearchResultGroup,
  VinylRecord,
} from '../types';

const emptySearchFields: AdvancedSearchFieldsValue = { title: '', artist: '', year: '', label: '' };

function intentFromFields(fields: AdvancedSearchFieldsValue): SearchIntent {
  return {
    title: fields.title.trim() || undefined,
    artist: fields.artist.trim() || undefined,
    year: fields.year.trim() || undefined,
    label: fields.label.trim() || undefined,
  };
}

function hasAnyIntentField(fields: AdvancedSearchFieldsValue): boolean {
  return Boolean(fields.title.trim() || fields.artist.trim() || fields.year.trim() || fields.label.trim());
}

type CaptureMethod = 'camera' | 'upload' | 'drag-drop' | 'paste';

interface ScannerProps {
  /** Called when a genuinely new record has just been saved to the collection. */
  onScanComplete: (record: VinylRecord) => void;
  /** Called when the scanned/selected record was already in the collection — no save occurred, so no API call is needed here. */
  onAlreadyInCollection: (record: VinylRecord) => void;
  onCancel: () => void;
  /** True on narrow/touch layouts — flips which capture method is primary. */
  isMobileLayout?: boolean;
  /** A data URL supplied from outside (e.g. a global clipboard paste). Processed immediately on receipt. */
  initialImage?: string | null;
  /** Called right after `initialImage` has been picked up, so the parent can clear it. */
  onInitialImageConsumed?: () => void;
}

const CameraIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" /><circle cx="12" cy="13" r="3" /></svg>
);

const UploadIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
);

const DownloadIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
);

const TrashIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
);

/** Fraction of the shorter viewfinder dimension the square capture frame occupies. */
const FRAME_RATIO = 0.82;

type Stage =
  | 'capture'           // camera / file-upload view
  | 'analyzing'         // waiting for /api/scan response
  | 'match_found'       // collection match returned; awaiting user confirmation
  | 'no_match'          // no match; show manual search box
  | 'searching'         // waiting for /api/search response
  | 'search_results'    // search results ready; user picks one
  | 'saving'            // saving confirmed result to collection
  | 'history';          // browsing past AI-assisted scans

export const Scanner: React.FC<ScannerProps> = ({
  onScanComplete,
  onAlreadyInCollection,
  onCancel,
  isMobileLayout = false,
  initialImage,
  onInitialImageConsumed,
}) => {
  const confidenceBand = (confidence?: number) => {
    const score = Math.max(0, Math.min(1, confidence ?? 0));
    if (score >= 0.85) return 'High';
    if (score >= 0.6) return 'Medium';
    if (score >= 0.35) return 'Low';
    return 'Total Guess';
  };

  const videoRef = useRef<HTMLVideoElement>(null);
  const videoContainerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [stage, setStage] = useState<Stage>('capture');
  const [isStreaming, setIsStreaming] = useState(false);
  const [isVideoReady, setIsVideoReady] = useState(false);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);  // base64
  const [error, setError] = useState<string | null>(null);
  // Pixel rect of the square viewfinder within its container — measured so the
  // capture crop matches exactly what the user framed. Also drives the stamp animation.
  const [frameRect, setFrameRect] = useState({ size: 0, left: 0, top: 0 });
  const [isCapturing, setIsCapturing] = useState(false);

  // match_found state
  const [matchedRecord, setMatchedRecord] = useState<VinylRecord | null>(null);

  // search state
  const [searchFields, setSearchFields] = useState<AdvancedSearchFieldsValue>(emptySearchFields);
  const [searchGroups, setSearchGroups] = useState<SearchResultGroup[]>([]);
  const [groupReleases, setGroupReleases] = useState<Record<string, SearchGroupReleases>>({});
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [loadingGroupIds, setLoadingGroupIds] = useState<Record<string, true>>({});
  const [aiGuesses, setAiGuesses] = useState<ScanVisionSuggestion[]>([]);

  // scan history state — synchronous ref alongside the state so a freshly
  // created entry's id is available immediately to the search that follows
  // it in the same call chain, without waiting on a state update to flush.
  const scanHistoryIdRef = useRef<string | null>(null);
  const [resumedImageUrl, setResumedImageUrl] = useState<string | null>(null);
  const [historyEntries, setHistoryEntries] = useState<ScanHistoryEntry[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  const displayImageSrc = capturedImage ? `data:image/jpeg;base64,${capturedImage}` : resumedImageUrl;

  // ── Camera helpers ──────────────────────────────────────────────────────────

  const startCamera = useCallback(async () => {
    setError(null);
    // Reset readiness while acquiring/attaching a new stream.
    setIsVideoReady(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment',
          // Non-standard but widely honored on Chromium/Android; ignored
          // elsewhere (e.g. Safari) rather than rejected. Helps with sleeves
          // held close to the lens where autofocus otherwise tends to hunt.
          advanced: [{ focusMode: 'continuous' }],
        } as unknown as MediaTrackConstraints,
      });
      streamRef.current = stream;
      setIsStreaming(true);

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch {
      setError('Unable to access camera. Please try uploading a file.');
    }
  }, []);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsStreaming(false);
    setIsVideoReady(false);
  }, []);

  // Attach an already-acquired stream once the video element mounts.
  useEffect(() => {
    if (isStreaming && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
    }
  }, [isStreaming]);

  // Camera access is only requested when the user explicitly taps the
  // camera button (handleOpenCamera below) — never on mount. Requesting
  // getUserMedia eagerly on mount meant the permission prompt could appear
  // before the user had chosen to use the camera at all, and pressing the
  // (already-streaming) shutter never re-triggered a fresh request.
  useEffect(() => {
    return () => stopCamera();
  }, [stopCamera]);

  const handleOpenCamera = useCallback(() => {
    void startCamera();
  }, [startCamera]);

  // Keep the square viewfinder sized/centered on the video container, so the
  // overlay the user frames against and the crop taken on capture always agree.
  useEffect(() => {
    if (!isStreaming) return;
    const container = videoContainerRef.current;
    if (!container) return;

    const updateFrameRect = () => {
      const rect = container.getBoundingClientRect();
      const size = Math.min(rect.width, rect.height) * FRAME_RATIO;
      setFrameRect({ size, left: (rect.width - size) / 2, top: (rect.height - size) / 2 });
    };

    updateFrameRect();
    const observer = new ResizeObserver(updateFrameRect);
    observer.observe(container);
    return () => observer.disconnect();
  }, [isStreaming]);

  // ── Image capture ───────────────────────────────────────────────────────────

  const captureFromCamera = useCallback(() => {
    if (!videoRef.current || !canvasRef.current || !videoContainerRef.current) return;
    const video = videoRef.current;
    if (!isVideoReady || video.videoWidth === 0 || video.videoHeight === 0) {
      setError('Camera is still warming up. Please try again.');
      return;
    }

    // Play the stamp animation first, then grab the frame — the delay is what
    // makes the capture feel like a deliberate "snap" rather than an instant cut.
    setIsCapturing(true);
    window.setTimeout(() => {
      const container = videoContainerRef.current;
      const canvas = canvasRef.current;
      if (!container || !canvas) return;

      // object-cover math: the video is scaled uniformly to cover the container,
      // then centered and cropped. Reverse that to find the on-screen viewfinder
      // square in source-video pixel coordinates.
      const rect = container.getBoundingClientRect();
      const coverScale = Math.max(rect.width / video.videoWidth, rect.height / video.videoHeight);
      const offsetX = (video.videoWidth * coverScale - rect.width) / 2;
      const offsetY = (video.videoHeight * coverScale - rect.height) / 2;

      const size = Math.min(rect.width, rect.height) * FRAME_RATIO;
      const left = (rect.width - size) / 2;
      const top = (rect.height - size) / 2;

      const sourceX = (left + offsetX) / coverScale;
      const sourceY = (top + offsetY) / coverScale;
      const sourceSize = size / coverScale;

      canvas.width = sourceSize;
      canvas.height = sourceSize;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(video, sourceX, sourceY, sourceSize, sourceSize, 0, 0, sourceSize, sourceSize);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      setIsCapturing(false);
      stopCamera();
      processImage(dataUrl, 'camera');
    }, 220);
  }, [isVideoReady, stopCamera]);

  /** Shared by file-input selection and drag-and-drop. */
  const handleFile = useCallback((file: File, method: CaptureMethod) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = reader.result as string;
      stopCamera();
      processImage(dataUrl, method);
    };
    reader.readAsDataURL(file);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopCamera]);

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file, 'upload');
    e.target.value = '';
  };

  // ── Drag-and-drop (desktop) ─────────────────────────────────────────────────

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file, 'drag-drop');
  };

  // ── Image pasted from outside this component (e.g. global clipboard paste) ──

  useEffect(() => {
    if (initialImage) {
      stopCamera();
      processImage(initialImage, 'paste');
      onInitialImageConsumed?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialImage]);

  /** Extract bare base64 from a data-URL and kick off the scan */
  const processImage = (dataUrl: string, method: CaptureMethod) => {
    const base64 = dataUrl.split(',')[1] ?? dataUrl;
    const approxBytes = Math.round((base64.length * 3) / 4);
    logEvent('scanner', 'Image captured', { method, approxKB: Math.round(approxBytes / 1024) });
    setCapturedImage(base64);
    analyzeImage(base64);
  };

  // ── Scan history (persists AI-assisted scans so they can be revisited
  //    without spending more vision-API budget) ───────────────────────────────

  /** Best-effort — a failure here shouldn't block the live scan flow. */
  const persistScanHistory = async (
    base64Image: string,
    visionGuesses: ScanVisionSuggestion[],
    suggestedQuery: string | undefined,
    initialSuggestions: VinylRecord[],
  ) => {
    try {
      const entry = await createScanHistoryEntry({
        capturedImage: base64Image,
        visionGuesses,
        suggestedQuery,
        initialSuggestions,
      });
      scanHistoryIdRef.current = entry.id;
    } catch (err) {
      logWarn('scanner', 'Failed to save scan history entry', { error: err instanceof Error ? err.message : String(err) });
    }
  };

  // ── Scan (pHash matching) ───────────────────────────────────────────────────

  const analyzeImage = async (base64: string) => {
    setError(null);
    setStage('analyzing');
    const startedAt = performance.now();
    try {
      const result = await scanImage(base64);
      const ms = Math.round(performance.now() - startedAt);
      if (result.matched === true) {
        logEvent('scanner', 'Matched existing collection item', {
          artist: result.record.artist,
          title: result.record.title,
          ms,
        });
        setMatchedRecord(result.record);
        setStage('match_found');
      } else if (result.suggestions?.length) {
        const top = result.suggestions[0]!;
        const fields: AdvancedSearchFieldsValue = { title: top.title, artist: top.artist, year: top.year ?? '', label: '' };
        logEvent('scanner', 'AI-assisted suggestions returned', {
          count: result.suggestions.length,
          top: result.suggestions.slice(0, 3).map((r) => `${r.artist} - ${r.title}`),
          suggestedQuery: result.vision?.suggestedQuery,
          ms,
        });
        setAiGuesses(result.vision?.guesses ?? []);
        setSearchFields(fields);
        await persistScanHistory(base64, result.vision?.guesses ?? [], result.vision?.suggestedQuery, result.suggestions);
        await runGroupedSearch(intentFromFields(fields));
      } else if (result.vision?.guesses?.length) {
        const top = result.vision.guesses[0]!;
        const fields: AdvancedSearchFieldsValue = { title: top.title, artist: top.artist, year: top.year ?? '', label: '' };
        logEvent('scanner', 'Vision guess returned without validated suggestions', {
          guessCount: result.vision.guesses.length,
          topGuess: `${top.artist} - ${top.title}`,
          suggestedQuery: result.vision.suggestedQuery,
          ms,
        });
        setAiGuesses(result.vision.guesses);
        setSearchFields(fields);
        await persistScanHistory(base64, result.vision.guesses, result.vision.suggestedQuery, []);
        await runGroupedSearch(intentFromFields(fields));
      } else {
        logEvent('scanner', 'No match and no suggestions — falling back to manual search', { ms });
        setAiGuesses([]);
        setStage('no_match');
      }
    } catch (err) {
      logWarn('scanner', 'Scan request failed', { error: err instanceof Error ? err.message : String(err) });
      setError(err instanceof Error ? err.message : 'Failed to analyse image.');
      setStage('no_match');
    }
  };

  // ── Manual search ───────────────────────────────────────────────────────────

  const runGroupedSearch = async (intent: SearchIntent) => {
    setError(null);
    setStage('searching');
    const startedAt = performance.now();
    try {
      const page = await searchVinylReleaseGroups({ mode: 'indexed', intent, page: 1, pageSize: 5 });
      logEvent('scanner', 'Grouped search results', {
        intent,
        resultCount: page.groups.length,
        total: page.total,
        top: page.groups.slice(0, 3).map((g) => `${g.artist} - ${g.title}`),
        ms: Math.round(performance.now() - startedAt),
      });
      setGroupReleases({});
      setExpandedGroups({});
      setLoadingGroupIds({});
      setSearchGroups(page.groups);
      setStage('search_results');

      // Best-effort — a failure here shouldn't block showing the results just fetched.
      if (scanHistoryIdRef.current) {
        appendScanHistorySearch(scanHistoryIdRef.current, intent, page.groups).catch((err) => {
          logWarn('scanner', 'Failed to append search to scan history', { error: err instanceof Error ? err.message : String(err) });
        });
      }
    } catch (err) {
      logWarn('scanner', 'Grouped search failed', {
        intent,
        error: err instanceof Error ? err.message : String(err),
      });
      setSearchGroups([]);
      setError('Search failed. Please try again.');
      setStage('no_match');
    }
  };

  const handleSearch = async () => {
    if (!hasAnyIntentField(searchFields)) return;
    await runGroupedSearch(intentFromFields(searchFields));
  };

  const downloadCapturedImage = () => {
    if (!capturedImage) return;
    triggerImageDownload(capturedImage, `sleevesnap-scan-${Date.now()}.jpg`);
  };

  // ── Confirm & save ──────────────────────────────────────────────────────────

  const confirmSelection = async (record: VinylRecord) => {
    setError(null);
    setStage('saving');
    try {
      const saved = await submitScan({
        artist: record.artist,
        title: record.title,
        year: record.year,
        releaseDate: record.releaseDate,
        genre: record.genre,
        format: record.format,
        country: record.country,
        releaseStatus: record.releaseStatus,
        edition: record.edition,
        musicBrainzId: record.musicBrainzId,
        releaseGroupId: record.releaseGroupId,
        releaseGroupTitle: record.releaseGroupTitle,
        releaseGroupUrl: record.releaseGroupUrl,
        releaseUrl: record.releaseUrl,
        discogsUrl: record.discogsUrl,
        thumbnailUrl: record.thumbnailUrl,
        notes: record.notes,
        capturedImage: capturedImage ?? undefined,
        coverUrl: record.coverUrl,
      });
      logEvent('scanner', 'Saved to collection', { artist: saved.artist, title: saved.title });
      onScanComplete(saved);
    } catch (err) {
      // 409 = already in collection; treat as success
      if (err instanceof Error && err.message.includes('already in collection')) {
        logEvent('scanner', 'Save skipped — already in collection', { artist: record.artist, title: record.title });
        onAlreadyInCollection(record);
      } else {
        logWarn('scanner', 'Save failed', { artist: record.artist, title: record.title, error: err instanceof Error ? err.message : String(err) });
        setError(err instanceof Error ? err.message : 'Failed to save record.');
        setStage('search_results');
      }
    }
  };

  // ── Reset ───────────────────────────────────────────────────────────────────

  const reset = () => {
    setCapturedImage(null);
    setResumedImageUrl(null);
    scanHistoryIdRef.current = null;
    setMatchedRecord(null);
    setSearchFields(emptySearchFields);
    setSearchGroups([]);
    setGroupReleases({});
    setExpandedGroups({});
    setLoadingGroupIds({});
    setAiGuesses([]);
    setError(null);
    setStage('capture');
  };

  // ── History (browse / resume / delete past AI-assisted scans) ──────────────

  const openHistory = async () => {
    setError(null);
    setStage('history');
    setIsLoadingHistory(true);
    try {
      const entries = await listScanHistory();
      setHistoryEntries(entries);
    } catch (err) {
      logWarn('scanner', 'Failed to load scan history', { error: err instanceof Error ? err.message : String(err) });
      setError('Failed to load scan history.');
    } finally {
      setIsLoadingHistory(false);
    }
  };

  const resumeHistoryEntry = (entry: ScanHistoryEntry) => {
    setError(null);
    setCapturedImage(null);
    setResumedImageUrl(entry.imageUrl);
    setMatchedRecord(null);
    scanHistoryIdRef.current = entry.id;
    setAiGuesses(entry.visionGuesses);

    const lastSearch = entry.searches[entry.searches.length - 1];
    setGroupReleases({});
    setExpandedGroups({});
    setLoadingGroupIds({});

    if (lastSearch) {
      setSearchFields({
        title: lastSearch.intent.title ?? '',
        artist: lastSearch.intent.artist ?? '',
        year: lastSearch.intent.year ?? '',
        label: lastSearch.intent.label ?? '',
      });
      setSearchGroups(lastSearch.resultGroups);
      setStage('search_results');
    } else {
      const topGuess = entry.visionGuesses[0];
      setSearchFields(
        topGuess
          ? { title: topGuess.title, artist: topGuess.artist, year: topGuess.year ?? '', label: '' }
          : emptySearchFields,
      );
      setSearchGroups([]);
      setStage('no_match');
    }
  };

  const deleteHistoryEntry = async (id: string) => {
    try {
      await deleteScanHistoryEntry(id);
      setHistoryEntries((prev) => prev.filter((entry) => entry.id !== id));
    } catch (err) {
      logWarn('scanner', 'Failed to delete scan history entry', { error: err instanceof Error ? err.message : String(err) });
      setError('Failed to delete scan history entry.');
    }
  };

  const toggleGroupExpanded = async (group: SearchResultGroup) => {
    const groupId = group.releaseGroupId;
    const currentlyOpen = Boolean(expandedGroups[groupId]);
    const nextOpen = !currentlyOpen;

    setExpandedGroups((prev) => ({ ...prev, [groupId]: nextOpen }));
    if (!nextOpen || groupReleases[groupId] || loadingGroupIds[groupId]) {
      return;
    }

    setLoadingGroupIds((prev) => ({ ...prev, [groupId]: true }));
    try {
      const details = await getReleaseGroupReleases(groupId);
      setGroupReleases((prev) => ({ ...prev, [groupId]: details }));
    } finally {
      setLoadingGroupIds((prev) => {
        const next = { ...prev };
        delete next[groupId];
        return next;
      });
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full bg-vinyl-950 text-white p-4 md:p-8">
      {/* Header */}
      <div className="flex justify-between items-center mb-4 md:mb-6">
        <h2 className="text-2xl md:text-3xl font-bold tracking-tight text-white">Scan</h2>
        <button
          onClick={onCancel}
          className="px-3.5 py-1.5 rounded-full bg-white/5 border border-white/10 text-sm font-medium text-gray-300 hover:bg-white/10 hover:text-white transition-colors"
        >
          Close
        </button>
      </div>

      {/* ── Chooser (capture stage, camera not yet open, nothing captured) ── */}
      {stage === 'capture' && !isStreaming && !capturedImage && (
        <div
          className={`flex-1 flex flex-col items-center justify-center gap-6 p-6 rounded-3xl border-2 border-dashed transition-colors ${isDraggingOver ? 'border-vinyl-accent bg-vinyl-accent/10' : 'border-white/10 bg-vinyl-900/60'
            }`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {error && (
            <div className="bg-red-500/10 border border-red-500/25 text-red-300 p-3 rounded-xl text-center text-sm w-full max-w-xs">
              {error}
            </div>
          )}

          <div className="flex flex-col gap-3 w-full max-w-xs">
            {isMobileLayout ? (
              <>
                <button
                  onClick={handleOpenCamera}
                  className="flex flex-col items-center justify-center gap-2 w-full py-6 rounded-2xl bg-gradient-to-br from-vinyl-accent to-red-500 hover:from-vinyl-accent-soft hover:to-red-400 text-white font-semibold shadow-lg shadow-vinyl-accent/25 transition-all active:scale-95"
                >
                  <CameraIcon />
                  Take Photo
                </button>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center justify-center gap-2 w-full py-3 rounded-full border border-white/10 bg-white/5 text-gray-300 hover:bg-white/10 transition-colors text-sm font-medium"
                >
                  <UploadIcon />
                  Upload Image
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="flex flex-col items-center justify-center gap-2 w-full py-10 rounded-2xl bg-gradient-to-br from-vinyl-accent to-red-500 hover:from-vinyl-accent-soft hover:to-red-400 text-white font-semibold shadow-lg shadow-vinyl-accent/25 transition-all active:scale-95"
                >
                  <UploadIcon />
                  Upload Image
                </button>
                <button
                  onClick={handleOpenCamera}
                  className="flex items-center justify-center gap-2 w-full py-3 rounded-full border border-white/10 bg-white/5 text-gray-300 hover:bg-white/10 transition-colors text-sm font-medium"
                >
                  <CameraIcon />
                  Use Webcam
                </button>
              </>
            )}
          </div>

          {!isMobileLayout && (
            <p className="text-xs text-gray-500 text-center max-w-xs">
              Drag and drop an image here, or paste (Ctrl/Cmd+V) a screenshot from anywhere on the site.
            </p>
          )}

          <button
            onClick={() => void openHistory()}
            className="text-sm text-gray-500 hover:text-gray-300 underline underline-offset-2"
          >
            View past scans
          </button>

          <input
            type="file"
            accept="image/*"
            ref={fileInputRef}
            className="hidden"
            onChange={handleFileInputChange}
          />
        </div>
      )}

      {/* ── Live camera feed (camera stage, streaming) ── */}
      {stage === 'capture' && isStreaming && (
        <div className="flex-1 flex flex-col min-h-0 gap-0">
          {/* Video + viewfinder — the square frame is what actually gets captured. */}
          <div
            ref={videoContainerRef}
            className="flex-1 min-h-0 relative overflow-hidden rounded-3xl bg-vinyl-900 border border-white/10"
          >
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              onLoadedMetadata={() => {
                void videoRef.current?.play().catch(() => {
                  // If autoplay is gated, keep UI usable and let user try capture again.
                });
                setIsVideoReady(true);
              }}
              className="absolute inset-0 w-full h-full object-cover"
            />

            {frameRect.size > 0 && (
              <>
                {/* Dim everything outside the square using a giant box-shadow "cutout". */}
                <div
                  className="absolute rounded-2xl pointer-events-none transition-transform duration-200 ease-out"
                  style={{
                    left: frameRect.left,
                    top: frameRect.top,
                    width: frameRect.size,
                    height: frameRect.size,
                    boxShadow: '0 0 0 9999px rgba(0,0,0,0.55)',
                    transform: isCapturing ? 'scale(0.92)' : 'scale(1)',
                  }}
                />
                {/* Frame border + corner brackets, like a scan/viewfinder reticle. */}
                <div
                  className={`absolute rounded-2xl pointer-events-none border-2 transition-all duration-200 ease-out ${isCapturing ? 'border-vinyl-accent' : 'border-white/60'
                    }`}
                  style={{
                    left: frameRect.left,
                    top: frameRect.top,
                    width: frameRect.size,
                    height: frameRect.size,
                    transform: isCapturing ? 'scale(0.92)' : 'scale(1)',
                  }}
                >
                  {[
                    'top-[-2px] left-[-2px] border-t-4 border-l-4 rounded-tl-2xl',
                    'top-[-2px] right-[-2px] border-t-4 border-r-4 rounded-tr-2xl',
                    'bottom-[-2px] left-[-2px] border-b-4 border-l-4 rounded-bl-2xl',
                    'bottom-[-2px] right-[-2px] border-b-4 border-r-4 rounded-br-2xl',
                  ].map((cornerClass) => (
                    <div
                      key={cornerClass}
                      className={`absolute w-7 h-7 border-vinyl-accent ${cornerClass}`}
                    />
                  ))}
                </div>
                <p className="absolute left-0 right-0 text-center text-xs text-white/70" style={{ top: frameRect.top - 28 }}>
                  Frame the sleeve in the square
                </p>
              </>
            )}

            {/* Capture flash */}
            <div
              className={`absolute inset-0 bg-white pointer-events-none transition-opacity ${isCapturing ? 'opacity-80 duration-75' : 'opacity-0 duration-150'
                }`}
            />

            {/* Stamp badge — pops in and settles on capture, reinforcing the "snap". */}
            {isCapturing && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="px-6 py-2 rounded-xl border-4 border-vinyl-accent text-vinyl-accent font-black text-2xl tracking-widest uppercase animate-stamp-pop">
                  Snap!
                </div>
              </div>
            )}
          </div>

          {/* Controls — in normal document flow so they can never be clipped by an
              overflowing ancestor, with safe-area clearance for notched phones. */}
          <div className="shrink-0 flex items-center justify-center gap-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <button
              onClick={stopCamera}
              className="p-4 rounded-full bg-white/10 border border-white/10 hover:bg-white/20 transition-all"
              aria-label="Cancel camera"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>

            <button
              onClick={captureFromCamera}
              disabled={!isVideoReady || isCapturing}
              className="w-20 h-20 rounded-full border-4 border-white flex items-center justify-center bg-vinyl-accent/20 hover:bg-vinyl-accent/40 transition-all active:scale-95 disabled:opacity-60"
              aria-label="Capture"
            >
              <div className={`w-16 h-16 bg-white rounded-full transition-transform duration-150 ${isCapturing ? 'scale-75' : 'scale-100'}`} />
            </button>

            <div className="w-12" />
          </div>
        </div>
      )}

      {/* ── Analysing (captured still + spinner overlay) ── */}
      {stage === 'analyzing' && capturedImage && (
        <div className="flex-1 flex flex-col items-center justify-center">
          <div className="relative w-full max-w-xs aspect-square rounded-3xl overflow-hidden bg-black border border-white/10">
            <img
              src={`data:image/jpeg;base64,${capturedImage}`}
              alt="Captured"
              className="absolute inset-0 w-full h-full object-contain"
            />
            <div className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center z-10">
              <div className="w-16 h-16 border-4 border-vinyl-accent border-t-transparent rounded-full animate-spin mb-4" />
              <p className="text-lg font-bold animate-pulse">Matching sleeve…</p>
            </div>
          </div>
        </div>
      )}

      <canvas ref={canvasRef} className="hidden" />

      {/* ── Match found ── */}
      {stage === 'match_found' && matchedRecord && (
        <div className="flex-1 flex flex-col gap-4">
          <div className="bg-green-500/10 border border-green-500/25 rounded-2xl p-4">
            <p className="text-green-400 font-semibold mb-1">Found in your collection!</p>
            <p className="text-white font-bold text-lg">{matchedRecord.title}</p>
            <p className="text-gray-400">{matchedRecord.artist}</p>
            {matchedRecord.year && <p className="text-gray-500 text-sm">{matchedRecord.year}</p>}
          </div>

          {capturedImage && (
            <div className="relative w-40 mx-auto">
              <img
                src={`data:image/jpeg;base64,${capturedImage}`}
                alt="Captured sleeve"
                className="w-40 h-40 object-contain rounded-xl bg-vinyl-900"
              />
              <button
                onClick={downloadCapturedImage}
                aria-label="Download photo"
                className="absolute top-1.5 right-1.5 p-1.5 rounded-full bg-black/60 text-white hover:bg-black/80 transition-colors"
              >
                <DownloadIcon />
              </button>
            </div>
          )}

          {error && (
            <div className="bg-red-900/80 text-white p-3 rounded text-sm">{error}</div>
          )}

          <div className="flex gap-3 mt-auto">
            <button
              onClick={() => setStage('no_match')}
              className="flex-1 py-3 rounded-full border border-white/10 bg-white/5 text-gray-300 hover:bg-white/10 font-medium text-sm transition-colors"
            >
              Not quite — search
            </button>
            <button
              onClick={() => onAlreadyInCollection(matchedRecord)}
              className="flex-1 py-3 rounded-full bg-gradient-to-br from-vinyl-accent to-red-500 hover:from-vinyl-accent-soft hover:to-red-400 text-white font-semibold text-sm transition-colors"
            >
              That's it!
            </button>
          </div>
        </div>
      )}

      {/* ── No match / manual search ── */}
      {(stage === 'no_match' || stage === 'searching' || stage === 'search_results') && (
        <div className="flex-1 flex flex-col gap-4 overflow-y-auto">
          {/* Thumbnail of the captured (or resumed history) image */}
          {displayImageSrc && (
            <div className="relative w-28 mx-auto">
              <img
                src={displayImageSrc}
                alt="Captured sleeve"
                className="w-28 h-28 object-contain rounded-xl bg-vinyl-900"
              />
              {capturedImage && (
                <button
                  onClick={downloadCapturedImage}
                  aria-label="Download photo"
                  className="absolute top-1 right-1 p-1.5 rounded-full bg-black/60 text-white hover:bg-black/80 transition-colors"
                >
                  <DownloadIcon />
                </button>
              )}
            </div>
          )}

          {searchGroups.length > 0 ? (
            <p className="text-gray-300 text-sm">
              We searched using the same MusicBrainz release-group flow as Discover. Expand a result to pick the exact release.
            </p>
          ) : (
            <p className="text-gray-300 text-sm">
              Couldn't identify this record in your collection. Do you know what album it is?
            </p>
          )}

          {aiGuesses.length > 0 && (
            <div className="bg-vinyl-900/70 border border-white/10 rounded-xl p-3">
              <p className="text-xs uppercase tracking-wide text-gray-400 mb-2">AI suggestions</p>
              <div className="flex flex-wrap gap-2">
                {aiGuesses
                  .slice()
                  .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))
                  .map((guess, idx) => {
                    const fields: AdvancedSearchFieldsValue = {
                      title: guess.title,
                      artist: guess.artist,
                      year: guess.year ?? '',
                      label: '',
                    };
                    return (
                      <button
                        key={`${guess.artist}-${guess.title}-${idx}`}
                        onClick={() => {
                          setSearchFields(fields);
                          void runGroupedSearch(intentFromFields(fields));
                        }}
                        className="px-3 py-1.5 rounded-full border border-white/15 bg-white/5 text-xs text-gray-200 hover:bg-white/10 transition-colors"
                      >
                        {`${guess.artist} - ${guess.title}`}
                        <span className="text-gray-400 ml-1">{confidenceBand(guess.confidence)}</span>
                      </button>
                    );
                  })}
              </div>
              <p className="text-[11px] text-gray-500 mt-2">
                AI guesses can confuse label text with album titles. Treat these as smart starting points, not final matches.
              </p>
            </div>
          )}

          {error && (
            <div className="bg-red-900/80 text-white p-3 rounded text-sm">{error}</div>
          )}

          {/* Search fields */}
          <div className="flex flex-col gap-2">
            <AdvancedSearchFields value={searchFields} onChange={setSearchFields} onSubmit={handleSearch} />
            <button
              onClick={handleSearch}
              disabled={stage === 'searching' || !hasAnyIntentField(searchFields)}
              className="bg-gradient-to-br from-vinyl-accent to-red-500 hover:from-vinyl-accent-soft hover:to-red-400 text-white px-4 py-3 rounded-xl font-semibold text-sm disabled:opacity-50 transition-colors"
            >
              {stage === 'searching' ? '…' : 'Search'}
            </button>
          </div>

          {/* Search results — no flex-1/overflow here; the stage container above
              is the single scroll region, so results are never starved of
              height by AI-suggestion chips or the (4-field) search form above them. */}
          <div className="space-y-2">
            <ReleaseGroupResultsList
              groups={searchGroups}
              groupReleases={groupReleases}
              expandedGroups={expandedGroups}
              loadingGroupIds={loadingGroupIds}
              onToggleGroup={(group) => {
                void toggleGroupExpanded(group);
              }}
              onReleaseAction={(record) => {
                void confirmSelection(record);
              }}
              isReleaseActionDisabled={() => stage === 'saving'}
              getReleaseActionLabel={(_, disabled) => (disabled ? '…' : 'Use this')}
              getReleaseActionClassName={(_, disabled) =>
                `self-end text-xs font-semibold bg-gradient-to-br from-vinyl-accent to-red-500 hover:from-vinyl-accent-soft hover:to-red-400 text-white px-3.5 py-1.5 rounded-full transition-colors ${disabled ? 'opacity-50' : ''}`}
              showGroupLinks={false}
              groupContainerClassName="bg-vinyl-900/70 rounded-xl border border-white/5"
              compact
            />

            {stage === 'search_results' && searchGroups.length === 0 && (
              <p className="text-center text-gray-500 py-6">
                No Discover results found for this query. Try artist + album, or pick one of the AI suggestions above.
              </p>
            )}
          </div>

          <button onClick={reset} className="mt-2 text-sm text-gray-500 hover:text-gray-300 text-center">
            ← Scan again
          </button>
        </div>
      )}

      {/* ── Scan history (past AI-assisted scans) ── */}
      {stage === 'history' && (
        <div className="flex-1 flex flex-col gap-3 overflow-y-auto">
          <button
            onClick={() => setStage('capture')}
            className="self-start text-sm text-gray-400 hover:text-white"
          >
            ← Back
          </button>

          {error && (
            <div className="bg-red-900/80 text-white p-3 rounded text-sm">{error}</div>
          )}

          {isLoadingHistory ? (
            <p className="text-gray-500 text-sm text-center py-6">Loading…</p>
          ) : historyEntries.length === 0 ? (
            <p className="text-gray-500 text-sm text-center py-6">No past scans yet.</p>
          ) : (
            <div className="space-y-2">
              {historyEntries.map((entry) => {
                const topGuess = entry.visionGuesses[0];
                const label = topGuess
                  ? `${topGuess.artist} - ${topGuess.title}`
                  : entry.suggestedQuery ?? 'Unidentified scan';
                return (
                  <div
                    key={entry.id}
                    className="flex items-center gap-3 bg-vinyl-900/70 border border-white/5 rounded-xl p-2"
                  >
                    <button
                      onClick={() => resumeHistoryEntry(entry)}
                      className="flex items-center gap-3 flex-1 min-w-0 text-left"
                    >
                      {entry.imageUrl && (
                        <img
                          src={entry.imageUrl}
                          alt=""
                          className="w-12 h-12 object-contain rounded-lg bg-vinyl-950 shrink-0"
                        />
                      )}
                      <div className="min-w-0">
                        <p className="text-sm text-white truncate">{label}</p>
                        <p className="text-xs text-gray-500">{new Date(entry.createdAt).toLocaleString()}</p>
                      </div>
                    </button>
                    <button
                      onClick={() => void deleteHistoryEntry(entry.id)}
                      aria-label="Delete scan"
                      className="p-2 rounded-full text-gray-400 hover:text-red-400 hover:bg-white/5 transition-colors"
                    >
                      <TrashIcon />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Saving overlay */}
      {stage === 'saving' && (
        <div className="flex-1 flex flex-col items-center justify-center gap-4">
          <div className="w-12 h-12 border-4 border-vinyl-accent border-t-transparent rounded-full animate-spin" />
          <p className="text-gray-400">Saving to collection…</p>
        </div>
      )}
    </div>
  );
};
