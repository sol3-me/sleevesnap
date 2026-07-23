import type { Corners } from './sleeveDetectionScoring';

// OpenCV.js ships no official TypeScript types, and jscanify (a thin wrapper
// around it) doesn't either — `any` here is deliberate and scoped to this one
// glue module, not spread through the codebase. Everything outside this file
// works with the plain `Corners` type from sleeveDetectionScoring.ts.
type CvNamespace = {
  Mat: new () => { delete: () => void };
  imread: (source: CanvasImageSource) => any;
  onRuntimeInitialized?: () => void;
};

type JscanifyInstance = {
  findPaperContour: (img: any) => any | null;
  getCornerPoints: (contour: any) => Corners;
};

declare global {
  interface Window {
    cv?: CvNamespace;
  }
}

let openCvReady: Promise<void> | null = null;

/**
 * Loads the self-hosted opencv.js build (see scripts/copyOpenCv.mjs — copied
 * from jscanify's own bundled copy at postinstall) exactly once, resolving
 * once its WASM runtime has actually finished initializing. Never call this
 * eagerly on app boot — only when the camera's auto-capture mode is actually
 * used, since it's an ~9MB download.
 */
function loadOpenCv(): Promise<void> {
  if (openCvReady) return openCvReady;

  openCvReady = new Promise((resolve, reject) => {
    if (window.cv?.Mat) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = '/opencv.js';
    script.async = true;
    script.onerror = () => reject(new Error('Failed to load opencv.js'));
    script.onload = () => {
      if (!window.cv) {
        reject(new Error('opencv.js loaded but window.cv is missing'));
        return;
      }
      // Emscripten's standard "WASM runtime is actually ready" hook — the
      // script itself finishing loading only means the JS glue is parsed,
      // not that the WASM module has instantiated yet.
      window.cv.onRuntimeInitialized = () => resolve();
    };
    document.head.appendChild(script);
  });

  return openCvReady;
}

let scannerInstance: JscanifyInstance | null = null;

async function getScanner(): Promise<JscanifyInstance> {
  await loadOpenCv();
  if (!scannerInstance) {
    const { default: jscanify } = await import('jscanify/client');
    scannerInstance = new jscanify() as JscanifyInstance;
  }
  return scannerInstance;
}

/** Call once, e.g. when the camera capture stage opens, to hide the ~9MB load latency before the first detection call. */
export function warmUpSleeveDetector(): Promise<void> {
  return getScanner().then(() => undefined);
}

/**
 * Detects the largest quadrilateral in `source` (a canvas frame — draw the
 * video onto an offscreen canvas first, same as jscanify's own live-camera
 * example) and returns its four corners, or null if nothing was found.
 *
 * jscanify's own findPaperContour/highlightPaper never delete() the
 * contour Mat they return/use — fine for a one-shot call, but this runs on
 * every sampled frame during live auto-capture, so left as-is it leaks a Mat
 * per frame until the tab falls over. Deleting both the source Mat and the
 * contour Mat here (not jscanify's job — it doesn't own detectSleeveCorners)
 * keeps this safe to call in a loop.
 */
export async function detectSleeveCorners(source: CanvasImageSource): Promise<Corners | null> {
  const scanner = await getScanner();
  const cv = window.cv!;
  const img = cv.imread(source);
  try {
    const contour = scanner.findPaperContour(img);
    if (!contour) return null;
    try {
      return scanner.getCornerPoints(contour);
    } finally {
      contour.delete();
    }
  } finally {
    img.delete();
  }
}
