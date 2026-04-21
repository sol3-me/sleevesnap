import React, { useCallback, useEffect, useRef, useState } from 'react';
import { scanImage, searchVinylDatabase, submitScan } from '../services/vinylService';
import { VinylRecord } from '../types';

interface ScannerProps {
  onScanComplete: (record: VinylRecord) => void;
  onCancel: () => void;
}

type Stage =
  | 'capture'           // camera / file-upload view
  | 'analyzing'         // waiting for /api/scan response
  | 'match_found'       // collection match returned; awaiting user confirmation
  | 'no_match'          // no match; show manual search box
  | 'searching'         // waiting for /api/search response
  | 'search_results'    // search results ready; user picks one
  | 'saving';           // saving confirmed result to collection

export const Scanner: React.FC<ScannerProps> = ({ onScanComplete, onCancel }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [stage, setStage] = useState<Stage>('capture');
  const [isStreaming, setIsStreaming] = useState(false);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);  // base64
  const [error, setError] = useState<string | null>(null);

  // match_found state
  const [matchedRecord, setMatchedRecord] = useState<VinylRecord | null>(null);

  // search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<VinylRecord[]>([]);
  const [failedCovers, setFailedCovers] = useState<Record<string, true>>({});

  // ── Camera helpers ──────────────────────────────────────────────────────────

  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        setIsStreaming(true);
      }
    } catch {
      setError('Unable to access camera. Please try uploading a file.');
    }
  }, []);

  const stopCamera = useCallback(() => {
    if (videoRef.current?.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach((t) => t.stop());
      videoRef.current.srcObject = null;
      setIsStreaming(false);
    }
  }, []);

  useEffect(() => {
    startCamera();
    return () => stopCamera();
  }, [startCamera, stopCamera]);

  // ── Image capture ───────────────────────────────────────────────────────────

  const captureFromCamera = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
    stopCamera();
    processImage(dataUrl);
  }, [stopCamera]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = reader.result as string;
      stopCamera();
      processImage(dataUrl);
    };
    reader.readAsDataURL(file);
  };

  /** Extract bare base64 from a data-URL and kick off the scan */
  const processImage = (dataUrl: string) => {
    const base64 = dataUrl.split(',')[1] ?? dataUrl;
    setCapturedImage(base64);
    analyzeImage(base64);
  };

  // ── Scan (pHash matching) ───────────────────────────────────────────────────

  const analyzeImage = async (base64: string) => {
    setError(null);
    setStage('analyzing');
    try {
      const result = await scanImage(base64);
      if (result.matched) {
        setMatchedRecord(result.record);
        setStage('match_found');
      } else {
        setStage('no_match');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to analyse image.');
      setStage('no_match');
    }
  };

  // ── Manual search ───────────────────────────────────────────────────────────

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setError(null);
    setStage('searching');
    try {
      setFailedCovers({});
      const results = await searchVinylDatabase(searchQuery);
      setSearchResults(results);
      setStage('search_results');
    } catch {
      setError('Search failed. Please try again.');
      setStage('no_match');
    }
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
      onScanComplete(saved);
    } catch (err) {
      // 409 = already in collection; treat as success
      if (err instanceof Error && err.message.includes('already in collection')) {
        onScanComplete(record);
      } else {
        setError(err instanceof Error ? err.message : 'Failed to save record.');
        setStage('search_results');
      }
    }
  };

  // ── Reset ───────────────────────────────────────────────────────────────────

  const reset = () => {
    setCapturedImage(null);
    setMatchedRecord(null);
    setSearchQuery('');
    setSearchResults([]);
    setFailedCovers({});
    setError(null);
    setStage('capture');
    startCamera();
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full bg-black text-white p-4">
      {/* Header */}
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-bold text-vinyl-accent">Scan Vinyl</h2>
        <button onClick={onCancel} className="text-gray-400 hover:text-white">
          Close
        </button>
      </div>

      {/* ── Viewfinder (capture / analyzing) ── */}
      {(stage === 'capture' || stage === 'analyzing') && (
        <div className="flex-1 flex flex-col items-center justify-center relative overflow-hidden rounded-lg bg-gray-900 border border-vinyl-700">
          {/* Live video */}
          {stage === 'capture' && !capturedImage && (
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="absolute inset-0 w-full h-full object-cover"
            />
          )}

          {/* Captured still */}
          {capturedImage && (
            <img
              src={`data:image/jpeg;base64,${capturedImage}`}
              alt="Captured"
              className="absolute inset-0 w-full h-full object-contain bg-black"
            />
          )}

          <canvas ref={canvasRef} className="hidden" />

          {/* Analysing overlay */}
          {stage === 'analyzing' && (
            <div className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center z-10">
              <div className="w-16 h-16 border-4 border-vinyl-accent border-t-transparent rounded-full animate-spin mb-4" />
              <p className="text-lg font-bold animate-pulse">Matching sleeve…</p>
            </div>
          )}

          {/* Camera controls */}
          {stage === 'capture' && (
            <div className="absolute bottom-6 left-0 right-0 flex flex-col items-center gap-4 pointer-events-none">
              {error && (
                <div className="bg-red-900/80 text-white p-3 rounded text-center mx-4 pointer-events-auto">
                  {error}
                </div>
              )}
              <div className="flex gap-4 items-center pointer-events-auto">
                {/* Upload */}
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="p-4 rounded-full bg-white/20 backdrop-blur-sm hover:bg-white/30 transition-all"
                  aria-label="Upload image"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
                </button>
                <input
                  type="file"
                  accept="image/*"
                  ref={fileInputRef}
                  className="hidden"
                  onChange={handleFileUpload}
                />

                {/* Shutter */}
                <button
                  onClick={captureFromCamera}
                  disabled={!isStreaming}
                  className="w-20 h-20 rounded-full border-4 border-white flex items-center justify-center bg-vinyl-accent/20 hover:bg-vinyl-accent/40 transition-all active:scale-95 disabled:opacity-40"
                  aria-label="Capture"
                >
                  <div className="w-16 h-16 bg-white rounded-full" />
                </button>

                <div className="w-12" />
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Match found ── */}
      {stage === 'match_found' && matchedRecord && (
        <div className="flex-1 flex flex-col gap-4">
          <div className="bg-green-900/40 border border-green-700 rounded-lg p-4">
            <p className="text-green-400 font-semibold mb-1">Found in your collection!</p>
            <p className="text-white font-bold text-lg">{matchedRecord.title}</p>
            <p className="text-gray-400">{matchedRecord.artist}</p>
            {matchedRecord.year && <p className="text-gray-500 text-sm">{matchedRecord.year}</p>}
          </div>

          {capturedImage && (
            <img
              src={`data:image/jpeg;base64,${capturedImage}`}
              alt="Captured sleeve"
              className="w-full max-h-48 object-contain rounded-lg bg-gray-900"
            />
          )}

          {error && (
            <div className="bg-red-900/80 text-white p-3 rounded text-sm">{error}</div>
          )}

          <div className="flex gap-2 mt-auto">
            <button
              onClick={() => setStage('no_match')}
              className="flex-1 py-3 rounded border border-gray-600 text-gray-300 hover:bg-white/5"
            >
              Not quite — search
            </button>
            <button
              onClick={() => onScanComplete(matchedRecord)}
              className="flex-1 py-3 rounded bg-vinyl-accent text-white font-bold hover:bg-red-500"
            >
              That's it!
            </button>
          </div>
        </div>
      )}

      {/* ── No match / manual search ── */}
      {(stage === 'no_match' || stage === 'searching' || stage === 'search_results') && (
        <div className="flex-1 flex flex-col gap-4 overflow-hidden">
          {/* Thumbnail of the captured image */}
          {capturedImage && (
            <img
              src={`data:image/jpeg;base64,${capturedImage}`}
              alt="Captured sleeve"
              className="w-full max-h-36 object-contain rounded-lg bg-gray-900"
            />
          )}

          <p className="text-gray-300 text-sm">
            Couldn't identify this record in your collection. Do you know what album it is?
          </p>

          {error && (
            <div className="bg-red-900/80 text-white p-3 rounded text-sm">{error}</div>
          )}

          {/* Search box */}
          <div className="flex gap-2">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="Search artist or album title…"
              className="flex-1 bg-vinyl-800 text-white border border-vinyl-700 rounded-lg p-3 focus:ring-1 focus:ring-vinyl-accent focus:outline-none text-sm"
              autoFocus
            />
            <button
              onClick={handleSearch}
              disabled={stage === 'searching' || !searchQuery.trim()}
              className="bg-vinyl-700 hover:bg-vinyl-600 text-white px-4 rounded-lg font-medium disabled:opacity-50"
            >
              {stage === 'searching' ? '…' : 'Search'}
            </button>
          </div>

          {/* Search results */}
          <div className="flex-1 overflow-y-auto space-y-2">
            {searchResults.map((record) => (
              <div
                key={record.id}
                className="flex items-center gap-3 bg-vinyl-800 rounded-lg p-3 border border-vinyl-700"
              >
                <div className="w-12 h-12 rounded flex-shrink-0 overflow-hidden bg-gray-700 border border-vinyl-700">
                  {record.coverUrl && !failedCovers[record.id] ? (
                    <img
                      src={record.coverUrl}
                      alt={record.title}
                      className="w-full h-full object-cover"
                      onError={() =>
                        setFailedCovers((prev) => ({
                          ...prev,
                          [record.id]: true,
                        }))
                      }
                    />
                  ) : (
                    <div className="w-full h-full text-[10px] text-gray-300 flex flex-col items-center justify-center leading-tight">
                      <span className="text-sm" aria-hidden="true">♪</span>
                      <span>No art</span>
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-white truncate">{record.title}</p>
                  <p className="text-sm text-gray-400 truncate">{record.artist}</p>
                  {record.year && <p className="text-xs text-gray-500">{record.year}</p>}
                </div>
                <button
                  onClick={() => confirmSelection(record)}
                  disabled={stage === 'saving'}
                  className="flex-shrink-0 text-xs bg-vinyl-accent hover:bg-red-500 text-white px-3 py-2 rounded transition-colors disabled:opacity-50"
                >
                  {stage === 'saving' ? '…' : 'This is it'}
                </button>
              </div>
            ))}

            {stage === 'search_results' && searchResults.length === 0 && (
              <p className="text-center text-gray-500 py-6">No results found. Try a different query.</p>
            )}
          </div>

          <button onClick={reset} className="mt-2 text-sm text-gray-500 hover:text-gray-300 text-center">
            ← Scan again
          </button>
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
