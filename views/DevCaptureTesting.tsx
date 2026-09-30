import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  advanceStability,
  initialStabilityState,
  isGoodCandidate,
  squareness as quadSquareness,
  fillRatio as quadFillRatio,
  type Corners,
} from '../lib/sleeveDetectionScoring';
import { detectSleeveCorners, warmUpSleeveDetector } from '../lib/sleeveDetector';
import { logWarn } from '../services/telemetry';

// Mirrors the private constants in components/Scanner.tsx — not exported
// there, and this file must not modify existing files, so the values are
// duplicated here. Keep in sync with Scanner.tsx by hand if those change.
const AUTO_CAPTURE_DETECTION_WIDTH = 480;
const AUTO_CAPTURE_SAMPLE_INTERVAL_MS = 200;
const AUTO_CAPTURE_MIN_SQUARENESS = 0.85;
const AUTO_CAPTURE_MIN_FILL_RATIO = 0.35;
const AUTO_CAPTURE_REQUIRED_STABLE_FRAMES = 6;

const ACCEPTED_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'];

type Stage = 'empty' | 'ready' | 'loading-opencv' | 'processing' | 'done';
type InputMode = 'upload' | 'record';
type CameraStage = 'idle' | 'streaming' | 'recording' | 'stopping';

interface FrameResult {
  frame: number;
  time: number;
  detected: boolean;
  corners: Corners | null;
  squareness: number;
  fill: number;
  stabilityCount: number;
  passed: boolean;
  // Captured via canvas.toDataURL() at sample time (only for the 200ms ticks
  // the harness actually processes, not every video frame) so the image is
  // still on the device that ran detection — this is what makes it possible
  // to inspect frames after the fact, including on a different device via
  // the server round-trip (see CaptureReport below).
  frameImage: string | null;
}

/** Wire format posted to / read from /api/dev/capture-report. */
interface CaptureReport {
  totalFrames: number;
  triggerFrame: number | null;
  triggerTimeSeconds: number | null;
  perFrame: Array<{
    frame: number;
    time: number;
    detected: boolean;
    corners: Corners | null;
    squareness: number;
    fill: number;
    stabilityCount: number;
    passed: boolean;
    frameImage: string | null;
  }>;
}

function buildReport(frames: FrameResult[], triggerFrame: number | null): CaptureReport {
  return {
    totalFrames: frames.length,
    triggerFrame,
    triggerTimeSeconds: triggerFrame !== null ? (frames[triggerFrame]?.time ?? null) : null,
    perFrame: frames.map((f) => ({
      frame: f.frame,
      time: f.time,
      detected: f.detected,
      corners: f.corners,
      squareness: f.squareness,
      fill: f.fill,
      stabilityCount: f.stabilityCount,
      passed: f.passed,
      frameImage: f.frameImage,
    })),
  };
}

function frameFailReason(f: FrameResult): string {
  if (f.passed) return 'Passed';
  if (!f.detected) return 'No quad detected';
  if (f.squareness < AUTO_CAPTURE_MIN_SQUARENESS) return 'Not square enough';
  if (f.fill < AUTO_CAPTURE_MIN_FILL_RATIO) return 'Fill ratio too low';
  return 'Failed';
}

/**
 * Runtime guard for jscanify's untyped `getCornerPoints()` result (see
 * lib/sleeveDetector.ts — it's cast to `Corners` but never actually
 * validated). Some frames — blurry, blank, or otherwise malformed input,
 * which mobile-recorded blobs produce more often than a live camera stream
 * — come back as a truthy object missing one or more corner points, which
 * would otherwise crash squareness()/fillRatio() (or this file's own
 * rendering code) reading `.x` off `undefined`.
 */
function isValidCorners(value: unknown): value is Corners {
  if (!value || typeof value !== 'object') return false;
  const c = value as Partial<Corners>;
  return [c.topLeftCorner, c.topRightCorner, c.bottomLeftCorner, c.bottomRightCorner].every(
    (p) => typeof p?.x === 'number' && typeof p?.y === 'number' && Number.isFinite(p.x) && Number.isFinite(p.y),
  );
}

/** Resolves once the video's current frame has actually decoded at `time`. */
function seekTo(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve) => {
    if (Math.abs(video.currentTime - time) < 0.001) {
      requestAnimationFrame(() => resolve());
      return;
    }
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      video.removeEventListener('seeked', onSeeked);
      window.clearTimeout(timeoutId);
      resolve();
    };
    const onSeeked = () => finish();
    // Some mobile-recorded blobs don't reliably fire `seeked` for every
    // requested time — fall back to continuing after a short timeout rather
    // than hanging the whole run on one frame.
    const timeoutId = window.setTimeout(finish, 1500);
    video.addEventListener('seeked', onSeeked);
    video.currentTime = time;
  });
}

function waitForVideoReady(video: HTMLVideoElement): Promise<void> {
  if (video.readyState >= 2) return Promise.resolve();
  return new Promise((resolve) => {
    const onReady = () => {
      video.removeEventListener('loadeddata', onReady);
      resolve();
    };
    video.addEventListener('loadeddata', onReady);
  });
}

function formatElapsed(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Renders a sampled frame's image with its detected quad drawn on top via an
 * absolutely-positioned <canvas> (not SVG — the canvas's own pixel buffer is
 * sized to the image's natural resolution once it loads, so the quad's
 * detection-space coordinates line up with the image exactly, then CSS
 * scales both together). Works identically whether `frameImage`/`corners`
 * came from a detection run on this device or a report loaded from another
 * one — both carry the same data now.
 */
function FrameImageWithOverlay({ frameImage, corners }: { frameImage: string; corners: Corners | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    setNaturalSize(null);
  }, [frameImage]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !naturalSize) return;
    canvas.width = naturalSize.width;
    canvas.height = naturalSize.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!corners) return;

    ctx.beginPath();
    ctx.moveTo(corners.topLeftCorner.x, corners.topLeftCorner.y);
    ctx.lineTo(corners.topRightCorner.x, corners.topRightCorner.y);
    ctx.lineTo(corners.bottomRightCorner.x, corners.bottomRightCorner.y);
    ctx.lineTo(corners.bottomLeftCorner.x, corners.bottomLeftCorner.y);
    ctx.closePath();
    ctx.fillStyle = 'rgba(56,189,248,0.15)';
    ctx.fill();
    ctx.strokeStyle = 'rgb(56,189,248)';
    ctx.lineWidth = 3;
    ctx.stroke();
  }, [naturalSize, corners]);

  return (
    <div className="relative w-full md:w-80 shrink-0 bg-black rounded-lg overflow-hidden">
      <img
        src={frameImage}
        alt="Sampled frame"
        className="w-full h-auto block"
        onLoad={(e) => setNaturalSize({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })}
      />
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
    </div>
  );
}

/**
 * Dev-only harness for the auto-capture detection pipeline: feeds a dropped
 * video file frame-by-frame (sampled at the same interval the live scanner
 * uses) through the exact same detectSleeveCorners + isGoodCandidate +
 * advanceStability functions Scanner.tsx runs, and visualizes the result.
 */
export function DevCaptureTesting() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const detectionCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [stage, setStage] = useState<Stage>('empty');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const [frames, setFrames] = useState<FrameResult[]>([]);
  const [triggerFrame, setTriggerFrame] = useState<number | null>(null);
  const [selectedFrameIndex, setSelectedFrameIndex] = useState<number | null>(null);
  // Whether `frames` came from a detection run on this device, or a report
  // fetched from another device via the server — purely informational now
  // that both carry the same per-frame image/corners data (used for the
  // "viewing a report loaded from another device" message below).
  const [reportSource, setReportSource] = useState<'local' | 'remote' | null>(null);

  // ── Server round-trip (mobile records → PC views) ───────────────────────────
  const [remoteStatus, setRemoteStatus] = useState<'idle' | 'loading' | 'not-found'>('idle');
  const [sendStatus, setSendStatus] = useState<'idle' | 'sending' | 'sent'>('idle');

  // ── In-harness camera recording (alongside file upload) ────────────────────
  const [mode, setMode] = useState<InputMode>('upload');
  const [cameraStage, setCameraStage] = useState<CameraStage>('idle');
  const [isStartingCamera, setIsStartingCamera] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  // Populated from enumerateDevices() once permission is granted — empty
  // when the browser doesn't support device enumeration or reports no
  // cameras, in which case startCamera() falls back to facingMode:'environment'.
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const liveVideoRef = useRef<HTMLVideoElement>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<BlobPart[]>([]);
  const recordingIntervalRef = useRef<number | undefined>(undefined);
  // Set right before handing a freshly-recorded clip to loadFile(), so the
  // effect below can kick off detection automatically once its object URL
  // has actually made it onto the offscreen <video>'s src.
  const pendingAutoRunRef = useRef(false);

  useEffect(() => {
    return () => {
      if (videoUrl) URL.revokeObjectURL(videoUrl);
    };
  }, [videoUrl]);

  const releaseCameraStream = useCallback(() => {
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
    cameraStreamRef.current = null;
    if (liveVideoRef.current) {
      liveVideoRef.current.srcObject = null;
    }
  }, []);

  // Release the camera on unmount if the harness is left mid-stream/recording.
  useEffect(() => {
    return () => {
      if (recordingIntervalRef.current !== undefined) {
        window.clearInterval(recordingIntervalRef.current);
      }
      releaseCameraStream();
    };
  }, [releaseCameraStream]);

  const loadFile = useCallback((file: File) => {
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setError(`Unsupported file type: ${file.type || 'unknown'}. Use mp4, webm, or mov.`);
      return;
    }
    setError(null);
    setFrames([]);
    setTriggerFrame(null);
    setSelectedFrameIndex(null);
    setProgress(0);
    setVideoUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(file);
    });
    setFileName(file.name);
    setStage('ready');
  }, []);

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) loadFile(file);
    e.target.value = '';
  };

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
    if (file) loadFile(file);
  };

  /**
   * Requests a stream for a specific camera (or facingMode:'environment' as
   * a fallback when no deviceId is known) and swaps it into the live
   * preview. Always releases whatever stream is currently attached first —
   * used both for the initial preview and for switching cameras mid-stream.
   */
  const startPreviewForDevice = useCallback(
    async (deviceId: string | null) => {
      releaseCameraStream();
      const stream = await navigator.mediaDevices.getUserMedia({
        video: deviceId ? { deviceId: { exact: deviceId } } : { facingMode: 'environment' },
      });
      cameraStreamRef.current = stream;
      if (liveVideoRef.current) {
        liveVideoRef.current.srcObject = stream;
      }
      setCameraStage('streaming');
    },
    [releaseCameraStream],
  );

  const startCamera = useCallback(async () => {
    setError(null);
    setIsStartingCamera(true);
    try {
      // A bare video:true request first, just to trigger the permission
      // prompt — enumerateDevices() only returns populated device labels
      // once permission has actually been granted, so this has to happen
      // before we can usefully list cameras.
      const probeStream = await navigator.mediaDevices.getUserMedia({ video: true });
      probeStream.getTracks().forEach((track) => track.stop());

      const devices = navigator.mediaDevices.enumerateDevices
        ? (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput')
        : [];

      if (devices.length === 0) {
        // No enumeration support, or no cameras reported — fall back to the
        // plain facingMode request and skip the device picker entirely.
        setVideoDevices([]);
        setSelectedDeviceId(null);
        await startPreviewForDevice(null);
        return;
      }

      setVideoDevices(devices);
      // Rear cameras tend to be listed last on mobile; prefer a label match
      // when there is one, otherwise fall back to the last device.
      const defaultDevice = devices.find((d) => /back|environment/i.test(d.label)) ?? devices[devices.length - 1]!;
      setSelectedDeviceId(defaultDevice.deviceId);
      await startPreviewForDevice(defaultDevice.deviceId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to access camera.');
    } finally {
      setIsStartingCamera(false);
    }
  }, [startPreviewForDevice]);

  /** Dropdown onChange — switches the live preview to a different camera without stopping anything else. */
  const handleCameraChange = useCallback(
    async (deviceId: string) => {
      setSelectedDeviceId(deviceId);
      setError(null);
      try {
        await startPreviewForDevice(deviceId);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unable to switch camera.');
      }
    },
    [startPreviewForDevice],
  );

  const cancelCamera = useCallback(() => {
    releaseCameraStream();
    setCameraStage('idle');
    setVideoDevices([]);
    setSelectedDeviceId(null);
  }, [releaseCameraStream]);

  const startRecording = useCallback(() => {
    const stream = cameraStreamRef.current;
    if (!stream) return;

    recordedChunksRef.current = [];
    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
      ? 'video/webm;codecs=vp9'
      : MediaRecorder.isTypeSupported('video/webm')
        ? 'video/webm'
        : '';
    const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) recordedChunksRef.current.push(e.data);
    };
    // Fires once .stop() has flushed the final chunk — assemble the clip,
    // release the camera, and feed it into the same path a file upload uses.
    recorder.onstop = () => {
      const blob = new Blob(recordedChunksRef.current, { type: 'video/webm' });
      recordedChunksRef.current = [];
      releaseCameraStream();
      const file = new File([blob], `recording-${Date.now()}.webm`, { type: 'video/webm' });
      pendingAutoRunRef.current = true;
      loadFile(file);
    };

    mediaRecorderRef.current = recorder;
    recorder.start();
    setRecordingSeconds(0);
    recordingIntervalRef.current = window.setInterval(() => {
      setRecordingSeconds((s) => s + 1);
    }, 1000);
    setCameraStage('recording');
  }, [loadFile, releaseCameraStream]);

  const stopRecording = useCallback(() => {
    if (recordingIntervalRef.current !== undefined) {
      window.clearInterval(recordingIntervalRef.current);
      recordingIntervalRef.current = undefined;
    }
    setCameraStage('stopping');
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current = null;
  }, []);

  const runDetection = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !videoUrl) return;

    setError(null);
    setFrames([]);
    setTriggerFrame(null);
    setSelectedFrameIndex(null);

    try {
      setStage('loading-opencv');
      await warmUpSleeveDetector();

      setStage('processing');
      setProgress(0);

      await waitForVideoReady(video);
      const duration = video.duration;
      if (!Number.isFinite(duration) || duration <= 0) {
        throw new Error('Could not determine video duration.');
      }
      if (video.videoWidth === 0 || video.videoHeight === 0) {
        throw new Error('Could not read video dimensions.');
      }

      const detectionScale = AUTO_CAPTURE_DETECTION_WIDTH / video.videoWidth;
      const detectionWidth = AUTO_CAPTURE_DETECTION_WIDTH;
      const detectionHeight = Math.round(video.videoHeight * detectionScale);

      if (!detectionCanvasRef.current) {
        detectionCanvasRef.current = document.createElement('canvas');
      }
      const canvas = detectionCanvasRef.current;
      canvas.width = detectionWidth;
      canvas.height = detectionHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Could not create a 2D canvas context.');

      const totalFrames = Math.floor((duration * 1000) / AUTO_CAPTURE_SAMPLE_INTERVAL_MS) + 1;
      let stabilityState = initialStabilityState;
      let triggerFrameIndex: number | null = null;
      const results: FrameResult[] = [];

      for (let i = 0; i * AUTO_CAPTURE_SAMPLE_INTERVAL_MS <= duration * 1000; i++) {
        const t = Math.min((i * AUTO_CAPTURE_SAMPLE_INTERVAL_MS) / 1000, duration);

        let corners: Corners | null = null;
        try {
          await seekTo(video, t);
          ctx.drawImage(video, 0, 0, detectionWidth, detectionHeight);
          const rawCorners = await detectSleeveCorners(canvas);
          corners = isValidCorners(rawCorners) ? rawCorners : null;
        } catch (frameErr) {
          // A single bad/undrawable frame — e.g. a seek that landed on a
          // blank frame, which mobile-recorded blobs are more prone to than
          // a live camera stream — shouldn't abort the whole run. Treat it
          // as "nothing detected" for this frame and keep going.
          logWarn('devCaptureTesting', 'Frame detection failed, skipping frame', {
            frame: i,
            error: frameErr instanceof Error ? frameErr.message : String(frameErr),
          });
          corners = null;
        }

        let squarenessVal = 0;
        let fillVal = 0;
        let passed = false;
        if (corners) {
          squarenessVal = quadSquareness(corners);
          fillVal = quadFillRatio(corners, detectionWidth, detectionHeight);
          passed = isGoodCandidate(corners, detectionWidth, detectionHeight, {
            minSquareness: AUTO_CAPTURE_MIN_SQUARENESS,
            minFillRatio: AUTO_CAPTURE_MIN_FILL_RATIO,
          });
        }

        const { state, shouldCapture } = advanceStability(stabilityState, passed, AUTO_CAPTURE_REQUIRED_STABLE_FRAMES);
        stabilityState = state;

        results.push({
          frame: i,
          time: t,
          detected: Boolean(corners),
          corners,
          squareness: squarenessVal,
          fill: fillVal,
          stabilityCount: state.consecutiveGoodFrames,
          passed,
          // Only the harness's own 200ms sample ticks get an image — never
          // per-video-frame — matching what the loop above already samples.
          frameImage: canvas.toDataURL('image/jpeg', 0.6),
        });

        if (shouldCapture && triggerFrameIndex === null) {
          triggerFrameIndex = i;
        }

        setProgress(Math.min(100, Math.round(((i + 1) / totalFrames) * 100)));
      }

      setFrames(results);
      setTriggerFrame(triggerFrameIndex);
      setSelectedFrameIndex(triggerFrameIndex ?? (results.length > 0 ? 0 : null));
      setReportSource('local');
      setSendStatus('idle');
      setStage('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Detection run failed.');
      setStage('ready');
    }
  }, [videoUrl]);

  // Auto-run detection once a freshly-recorded clip's object URL has landed
  // on the offscreen <video>'s src (loadFile's setVideoUrl above is async —
  // this effect only fires once the DOM/state have actually caught up,
  // avoiding the stale-closure trap of calling runDetection() right inline).
  useEffect(() => {
    if (pendingAutoRunRef.current && stage === 'ready' && videoUrl) {
      pendingAutoRunRef.current = false;
      void runDetection();
    }
  }, [stage, videoUrl, runDetection]);

  const handleCopyReport = async () => {
    if (frames.length === 0) return;
    await navigator.clipboard.writeText(JSON.stringify(buildReport(frames, triggerFrame), null, 2));
  };

  /** Posts the current report to the dev server so another device on the same network can load it. */
  const handleSendToPc = async () => {
    if (frames.length === 0) return;
    setError(null);
    setSendStatus('sending');
    try {
      const res = await fetch('/api/dev/capture-report', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(buildReport(frames, triggerFrame)),
      });
      if (!res.ok) throw new Error(`Server responded ${res.status}`);
      setSendStatus('sent');
    } catch (err) {
      setSendStatus('idle');
      setError(err instanceof Error ? err.message : 'Failed to send report.');
    }
  };

  /**
   * Loads whatever report was last POSTed (e.g. from a phone that just ran
   * detection) and renders it exactly like a local run — the report now
   * carries each frame's image and corners too, so the quad overlay works
   * here the same as it does right after a local run.
   */
  const handleLoadLatestReport = async () => {
    setError(null);
    setRemoteStatus('loading');
    try {
      const res = await fetch('/api/dev/capture-report');
      if (res.status === 404) {
        setRemoteStatus('not-found');
        return;
      }
      if (!res.ok) throw new Error(`Server responded ${res.status}`);
      const report = (await res.json()) as CaptureReport;

      const loadedFrames: FrameResult[] = report.perFrame.map((f) => ({
        ...f,
        corners: f.corners ?? null,
        frameImage: f.frameImage ?? null,
      }));

      setVideoUrl(null);
      setFileName(null);
      setFrames(loadedFrames);
      setTriggerFrame(report.triggerFrame);
      setSelectedFrameIndex(report.triggerFrame ?? (loadedFrames.length > 0 ? 0 : null));
      setReportSource('remote');
      setSendStatus('idle');
      setStage('done');
      setRemoteStatus('idle');
    } catch (err) {
      setRemoteStatus('idle');
      setError(err instanceof Error ? err.message : 'Failed to load report.');
    }
  };

  const reset = () => {
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    setVideoUrl(null);
    setFileName(null);
    setStage('empty');
    setFrames([]);
    setTriggerFrame(null);
    setSelectedFrameIndex(null);
    setError(null);
    setProgress(0);
    setReportSource(null);
    setRemoteStatus('idle');
    setSendStatus('idle');
  };

  const selectedFrame = selectedFrameIndex !== null ? (frames[selectedFrameIndex] ?? null) : null;
  const bestSquareness = frames.length > 0 ? Math.max(...frames.map((f) => f.squareness)) : 0;
  const bestFill = frames.length > 0 ? Math.max(...frames.map((f) => f.fill)) : 0;

  return (
    <div className="min-h-dvh bg-zinc-950 text-zinc-100 p-4 md:p-8 pb-28 md:pb-24">
      <div className="max-w-5xl mx-auto flex flex-col gap-6">
        <div>
          <h1 className="text-xl font-bold">Auto-capture detection test harness</h1>
          <p className="text-sm text-zinc-500">
            Dev-only. Drop a clip of someone holding a sleeve up to the camera to see how detection scores it, frame by frame.
          </p>
        </div>

        {error && (
          <div className="bg-red-950 border border-red-800 text-red-300 p-3 rounded-lg text-sm">{error}</div>
        )}

        {/* PC-side view path: pulls whatever report a phone on the same network last sent. */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => void handleLoadLatestReport()}
            disabled={remoteStatus === 'loading'}
            className="px-4 py-2 rounded-full border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 text-sm font-medium transition-colors disabled:opacity-50"
          >
            {remoteStatus === 'loading' ? 'Loading…' : 'Load Latest Report'}
          </button>
          {remoteStatus === 'not-found' && (
            <span className="text-sm text-zinc-500">No report saved yet — send one from another device first.</span>
          )}
          {reportSource === 'remote' && stage === 'done' && (
            <span className="text-sm text-zinc-500">Viewing a report loaded from another device.</span>
          )}
        </div>

        {stage === 'empty' && (
          <div className="flex flex-col gap-4">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setMode('upload')}
                className={`px-4 py-2 rounded-full text-sm font-semibold transition-colors ${
                  mode === 'upload' ? 'bg-cyan-600 text-white' : 'bg-zinc-900 text-zinc-400 hover:text-zinc-200'
                }`}
              >
                Upload
              </button>
              <button
                type="button"
                onClick={() => setMode('record')}
                className={`px-4 py-2 rounded-full text-sm font-semibold transition-colors ${
                  mode === 'record' ? 'bg-cyan-600 text-white' : 'bg-zinc-900 text-zinc-400 hover:text-zinc-200'
                }`}
              >
                Record
              </button>
            </div>

            {mode === 'upload' && (
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={`flex flex-col items-center justify-center gap-3 p-12 rounded-xl border-2 border-dashed transition-colors ${
                  isDraggingOver ? 'border-cyan-400 bg-cyan-400/5' : 'border-zinc-700 bg-zinc-900/50'
                }`}
              >
                <p className="text-zinc-400 text-sm">Drag and drop a video file here, or</p>
                <label className="cursor-pointer px-4 py-2 rounded-full bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-semibold transition-colors">
                  Choose file
                  <input type="file" accept="video/mp4,video/webm,video/quicktime" className="hidden" onChange={handleFileInputChange} />
                </label>
                <p className="text-xs text-zinc-600">mp4, webm, mov</p>
              </div>
            )}

            {mode === 'record' && (
              <div className="flex flex-col items-center justify-center gap-3 p-6 rounded-xl border-2 border-zinc-700 bg-zinc-900/50">
                <div className="relative w-full max-w-md aspect-video bg-black rounded-lg overflow-hidden">
                  <video
                    ref={liveVideoRef}
                    autoPlay
                    playsInline
                    muted
                    className={`w-full h-full object-cover ${cameraStage === 'idle' ? 'hidden' : ''}`}
                  />
                  {cameraStage === 'idle' && (
                    <div className="absolute inset-0 flex items-center justify-center text-zinc-600 text-sm">
                      Camera preview
                    </div>
                  )}
                  {(cameraStage === 'recording' || cameraStage === 'stopping') && (
                    <div className="absolute top-3 left-3 flex items-center gap-2 px-2.5 py-1 rounded-full bg-black/60 text-white text-xs font-mono">
                      <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                      {formatElapsed(recordingSeconds)}
                    </div>
                  )}
                </div>

                {cameraStage === 'streaming' && videoDevices.length > 0 && (
                  <select
                    value={selectedDeviceId ?? ''}
                    onChange={(e) => void handleCameraChange(e.target.value)}
                    className="w-full max-w-md px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-700 text-sm text-zinc-200"
                  >
                    {videoDevices.map((d, i) => (
                      <option key={d.deviceId} value={d.deviceId}>
                        {d.label || `Camera ${i + 1}`}
                      </option>
                    ))}
                  </select>
                )}

                <div className="flex items-center gap-3">
                  {cameraStage === 'idle' && (
                    <button
                      type="button"
                      onClick={() => void startCamera()}
                      disabled={isStartingCamera}
                      className="px-4 py-2 rounded-full bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-semibold transition-colors disabled:opacity-50"
                    >
                      {isStartingCamera ? 'Requesting camera…' : 'Start Camera'}
                    </button>
                  )}
                  {cameraStage === 'streaming' && (
                    <>
                      <button
                        type="button"
                        onClick={startRecording}
                        className="px-4 py-2 rounded-full bg-red-600 hover:bg-red-500 text-white text-sm font-semibold transition-colors"
                      >
                        Record
                      </button>
                      <button
                        type="button"
                        onClick={cancelCamera}
                        className="text-zinc-500 hover:text-zinc-300 text-sm underline"
                      >
                        Cancel
                      </button>
                    </>
                  )}
                  {cameraStage === 'recording' && (
                    <button
                      type="button"
                      onClick={stopRecording}
                      className="px-4 py-2 rounded-full bg-zinc-100 hover:bg-white text-zinc-900 text-sm font-semibold transition-colors"
                    >
                      Stop
                    </button>
                  )}
                  {cameraStage === 'stopping' && (
                    <span className="text-sm text-zinc-500">Processing recording…</span>
                  )}
                </div>
                <p className="text-xs text-zinc-600">Detection runs automatically once you stop recording.</p>
              </div>
            )}
          </div>
        )}

        {stage !== 'empty' && videoUrl && (
          <div className="flex items-center gap-3 text-sm">
            <span className="text-zinc-400 truncate">{fileName}</span>
            <button onClick={reset} className="text-zinc-500 hover:text-zinc-300 underline">
              choose another file
            </button>
            <div className="flex-1" />
            {(stage === 'ready' || stage === 'done') && (
              <button
                onClick={() => void runDetection()}
                className="px-4 py-2 rounded-full bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-semibold transition-colors"
              >
                {stage === 'done' ? 'Run again' : 'Run Detection'}
              </button>
            )}
          </div>
        )}

        {stage === 'done' && !videoUrl && reportSource === 'remote' && (
          <div className="flex items-center gap-3 text-sm">
            <button onClick={reset} className="text-zinc-500 hover:text-zinc-300 underline">
              ← back
            </button>
          </div>
        )}

        <video ref={videoRef} src={videoUrl ?? undefined} muted playsInline className="hidden" />

        {stage === 'loading-opencv' && (
          <div className="flex items-center gap-3 text-sm text-zinc-400">
            <div className="w-5 h-5 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
            Loading OpenCV…
          </div>
        )}

        {stage === 'processing' && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between text-sm text-zinc-400">
              <span>Processing frames…</span>
              <span>{progress}%</span>
            </div>
            <div className="w-full h-2 bg-zinc-800 rounded-full overflow-hidden">
              <div className="h-full bg-cyan-500 transition-all" style={{ width: `${progress}%` }} />
            </div>
          </div>
        )}

        {stage === 'done' && frames.length > 0 && (
          <div className="flex flex-col gap-4">
            <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-4">
              {triggerFrame !== null ? (
                <p className="text-green-400 font-semibold">
                  Triggered at frame {triggerFrame} ({frames[triggerFrame]!.time.toFixed(2)}s in)
                </p>
              ) : (
                <p className="text-yellow-400 font-semibold">
                  No trigger — best squareness {Math.round(bestSquareness * 100)}%, best fill {Math.round(bestFill * 100)}%
                </p>
              )}
            </div>

            {/* Timeline */}
            <div className="flex h-8 rounded-lg overflow-hidden border border-zinc-800">
              {frames.map((f, i) => (
                <button
                  key={f.frame}
                  type="button"
                  onClick={() => setSelectedFrameIndex(i)}
                  title={`Frame ${f.frame} · ${f.time.toFixed(2)}s · ${frameFailReason(f)}`}
                  className={`flex-1 min-w-[2px] relative transition-opacity hover:opacity-80 ${
                    f.passed ? 'bg-green-600' : f.detected ? 'bg-yellow-700' : 'bg-red-700'
                  } ${selectedFrameIndex === i ? 'ring-2 ring-inset ring-white' : ''}`}
                >
                  {triggerFrame === i && (
                    <span
                      className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-l-transparent border-r-transparent border-t-cyan-400"
                      aria-hidden="true"
                    />
                  )}
                </button>
              ))}
            </div>
            <div className="flex justify-between text-xs text-zinc-600">
              <span>0s</span>
              <span>{frames[frames.length - 1]!.time.toFixed(1)}s</span>
            </div>

            {/* Selected frame detail */}
            {selectedFrame && (
              <div className="flex flex-col md:flex-row gap-4 bg-zinc-900/70 border border-zinc-800 rounded-xl p-4">
                {selectedFrame.frameImage ? (
                  <FrameImageWithOverlay frameImage={selectedFrame.frameImage} corners={selectedFrame.corners} />
                ) : (
                  <div className="w-full md:w-80 shrink-0 flex items-center justify-center bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-600 p-4 text-center">
                    No frame image available.
                  </div>
                )}
                <div className="flex-1 flex flex-col gap-1 text-sm">
                  <p className="font-semibold">
                    Frame {selectedFrame.frame} · {selectedFrame.time.toFixed(2)}s
                  </p>
                  <p className="text-zinc-400">Squareness: {Math.round(selectedFrame.squareness * 100)}%</p>
                  <p className="text-zinc-400">Fill ratio: {Math.round(selectedFrame.fill * 100)}%</p>
                  <p className="text-zinc-400">
                    Stability count: {selectedFrame.stabilityCount}/{AUTO_CAPTURE_REQUIRED_STABLE_FRAMES}
                  </p>
                  <p
                    className={`font-semibold mt-2 ${
                      selectedFrame.passed ? 'text-green-400' : selectedFrame.detected ? 'text-yellow-400' : 'text-red-400'
                    }`}
                  >
                    {frameFailReason(selectedFrame)}
                  </p>
                </div>
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => void handleCopyReport()}
                className="px-4 py-2 rounded-full border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 text-sm font-medium transition-colors"
              >
                Copy Report
              </button>
              <button
                onClick={() => void handleSendToPc()}
                disabled={sendStatus === 'sending'}
                className="px-4 py-2 rounded-full border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 text-sm font-medium transition-colors disabled:opacity-50"
              >
                {sendStatus === 'sending' ? 'Sending…' : sendStatus === 'sent' ? 'Sent ✓' : 'Send to PC'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
