# Auto-Capture Research: Detecting the Sleeve So the Camera Can Snap Itself

**Status:** Research only — no implementation yet. Written to compare options before picking one.
**How it was produced:** a read of the current capture flow (`components/Scanner.tsx`, `views/ScanView.tsx`) plus web research on the current (mid-2026) state of browser-side rectangle/document detection libraries, commercial SDKs, and ML-model alternatives. Sources at the bottom.

---

## 1. The problem, concretely

Today ([components/Scanner.tsx:244-288](components/Scanner.tsx#L244)) capture is fully manual: a fixed square viewfinder is drawn over the video feed at a constant size/position (`FRAME_RATIO = 0.82` of the shorter container dimension — [components/Scanner.tsx:92](components/Scanner.tsx#L92)), the user physically aligns the sleeve inside it by moving their phone, and presses a shutter button. The crop is just "whatever was inside that fixed square" ([components/Scanner.tsx:262-282](components/Scanner.tsx#L262)) — there's no awareness of where the sleeve actually is in the frame.

What we want instead: the app watches the live video feed, figures out *where the sleeve's edges actually are* (not just trusting a fixed overlay), and fires the same capture path automatically once a real sleeve is well-framed and holding steady — no button press needed. The manual shutter should stay as a fallback (low light, unusual angles, accessibility, user preference), not disappear.

That splits into two sub-problems that are easy to conflate:

1. **Detection**: given a video frame, find candidate quadrilaterals/squares that look like a record sleeve (as opposed to a doorframe, a coffee table, a phone screen, etc.).
2. **Trigger heuristic**: given a stream of per-frame detections, decide *when* to fire the shutter — e.g. "the best candidate has been square-ish, centered, and filling ≥N% of the frame for the last ~1 second." This part is bespoke UX logic either way — no library ships it as a drop-in; every option below only solves (1), and we'd write (2) ourselves regardless of which detection approach we pick.

## 2. Options considered

### 2.1 OpenCV.js (hand-rolled contour pipeline)

The standard, decades-old technique for "find the document/card/photo in this frame" is: grayscale → Gaussian blur → Canny edge detection → `findContours` → `approxPolyDP` to reduce each contour to a polygon → keep the largest convex 4-point contour. This is exactly how most "document scanner" apps (Office Lens, Adobe Scan, CamScanner) work under the hood, and it generalizes fine to squares (a record sleeve is just a document-shaped contour with an aspect-ratio filter added).

**OpenCV.js** is the official WebAssembly build of OpenCV, and gives you all of the above as browser-callable functions (`cv.Canny`, `cv.findContours`, `cv.approxPolyDP`, ...) rather than requiring us to write our own edge detector in JS. This is realistically what "build our own" means in practice — nobody hand-writes Canny/contour-tracing pixel loops in pure JS for production; you use these compiled primitives and write your own detection-scoring and trigger logic on top.

- **License:** Apache 2.0. No cost, no vendor.
- **Bundle size:** the stock prebuilt `opencv.js` WASM is **~8MB**, which is a real problem for a currently-lean app. It can be trimmed significantly with a custom build — reports of **~8.4MB → ~4.2MB** by disabling unused top-level modules, and down to **~1.5–2MB** if the module whitelist is cut to just `core` + `imgproc` (the only two modules this feature actually needs). Building that custom trim means running OpenCV's own `build_js.py` with an edited `opencv_js.config.py` — a one-time CI/build-tooling task, not a runtime cost.
- **Performance:** real. One benchmark for Sobel-style edge detection on 640×480 video found desktop hitting **60fps (WebGL) / 37fps (Canvas)**, phones **34fps (WebGL) / ~7fps (Canvas)**. That sounds alarming, but our trigger heuristic doesn't need 60fps — sampling one frame every ~150–200ms (5–7 detections/sec) is plenty to decide "has this been stable for a second," and gives the WASM call room to breathe even on a slow phone.
- **Load strategy:** must be lazy-loaded (dynamic `import()`) only when the camera stage opens, gated behind OpenCV's own `onRuntimeInitialized` callback — never eagerly on app boot, or it blocks first paint for every visitor including ones who never touch the scanner.
- **Control:** full — we write our own scoring (squareness, fill-ratio against the existing `frameRect`, temporal stability) directly against the raw contour output, tuned specifically for square sleeves rather than generic rectangular documents.

### 2.2 jscanify

[jscanify](https://github.com/puffinsoft/jscanify) (MIT, **1.8k★**, actively used) is a thin JS library built directly on top of OpenCV.js that packages exactly the contour pipeline above into two calls: `highlightPaper(image)` (detect + draw the outline) and `extractPaper(image, w, h)` (detect + perspective-correct + crop). Crucially, it already supports **live video** — its docs include a `getUserMedia()` example that continuously highlights the detected document on every frame, which is precisely our use case's detection half.

- **Pros:** dramatically less code to get a working proof-of-concept — this is the fastest way to answer "does contour detection actually work reliably on real vinyl sleeves under real lighting" before investing in a hand-tuned pipeline.
- **Cons:** it still pulls in the *full* OpenCV.js under the hood (same bundle-size cost as 2.1, and jscanify itself doesn't offer a trimmed build), and it's tuned for "paper" (perspective correction of a possibly-skewed rectangle) rather than "square, roughly frame-on, decide when to trigger" — we'd still write our own squareness/stability/trigger scoring on top of its raw corner output, same as with hand-rolled OpenCV.js. It also assumes "flat surface with a solid background" for optimal detection per its own docs, which won't always hold (records held in-hand against a cluttered store shelf).
- **Verdict:** good for a fast Phase 1 prototype; not clearly better than 2.1 for the final shipped version, since the bundle-size problem (the actual hard part) isn't solved by using it instead of OpenCV.js directly.

### 2.3 Commercial document-scanning SDKs (Dynamsoft Document Normalizer, Scanbot Web SDK)

Both are polished, paid, closed-source SDKs built for exactly this: real-time edge detection with **auto-snap when the frame is stable and well-framed** — i.e., they already ship the trigger heuristic (part 2 of the problem) as a built-in, tuned, cross-device-tested feature, not just raw detection.

- **Dynamsoft Document Normalizer**: no published pricing — "contact for quote," 30-day trial. JS edition exists, now folded into their broader "Capture Vision" suite.
- **Scanbot Web SDK**: also quote-based, described as "flat annual license fee, unlimited scanning," broad platform support (web, iOS, Android, React Native, etc.).
- **Pros:** zero R&D risk, battle-tested UX, handles edge cases (glare, low light, partial occlusion) that a DIY pipeline would take many iterations to match.
- **Cons:** ongoing paid license for a free, open-source, "no ads" hobby project — a poor values-fit even before getting a quote, and it reintroduces a closed-source vendor dependency into a codebase that's otherwise self-contained (own SQLite, own storage, MusicBrainz as the only external data dependency). Not recommended given sleevesnap's stated positioning, but worth having priced once as a fallback if the DIY route stalls.

### 2.4 ML object-detection models (MediaPipe Tasks Vision, TensorFlow.js, ONNX models)

Considered and **not recommended** as a first approach, for a reason specific to this task rather than a general dismissal of ML:

- **MediaPipe Tasks Vision** (`@mediapipe/tasks-vision`) ships a general-purpose real-time object detector, but its bundled models are trained on generic object classes (COCO-style categories) — there's no "record sleeve" or generic "document" class, so it can't localize sleeve corners precisely. Same problem with TensorFlow.js's off-the-shelf COCO-SSD model.
- Getting genuine value from this path means **training a custom model** on photos of album sleeves — a real data-collection and training effort, disproportionate to the actual problem (finding a square in a frame is a solved, cheap, classical-CV problem; it doesn't need a learned model).
- **DocAligner** is worth naming as the closest existing purpose-built option (a PyTorch/ONNX model that predicts the four corners of a document, Apache 2.0, 101★). But it's Python-only today with no JavaScript/web/ONNX-Runtime-Web integration example — using it would mean *both* a from-scratch web integration *and* adopting a smaller, less production-proven project (101★ vs. jscanify's 1.8k★) than the classical-CV path. Only worth revisiting if the classical-CV approach's accuracy proves genuinely insufficient in practice (e.g. on heavily textured or glossy sleeve art) — not a reason to start there.

### 2.5 Browser-native Shape Detection API

Ruled out, not a real option: the [WICG Shape Detection API](https://wicg.github.io/shape-detection-api/) (still a Draft Community Group Report as of Feb 2026) only defines `FaceDetector`, `BarcodeDetector`, and `TextDetector` — there is no rectangle/document detector in the spec at all, and `BarcodeDetector` itself is Chromium-mobile-only (not implemented on desktop browsers, not in Firefox/Safari). Mentioned here only so it doesn't get re-suggested later without context.

## 3. Comparison at a glance

| Option | Detection quality | Bundle cost | $ cost | Gives us the trigger heuristic? | Maturity |
|---|---|---|---|---|---|
| OpenCV.js (hand-rolled, trimmed build) | High (industry-standard technique) | ~1.5–4MB (trimmed), lazy-loaded | Free | No — we write it | Very mature (OpenCV itself) |
| jscanify | High (same underlying technique) | ~8MB (full OpenCV.js, no trim), lazy-loaded | Free | No — we write it | Mature, 1.8k★, MIT |
| Dynamsoft / Scanbot SDK | High, cross-device tuned | Vendor-managed | Paid, quote-only | **Yes**, built-in | Very mature (commercial product) |
| MediaPipe / TF.js generic models | Low for this task (no sleeve class) | Medium-large | Free | No, and detection itself is weak here | Mature library, wrong tool |
| DocAligner (ONNX) | Unproven for this (needs web port) | Unknown, needs conversion work | Free | No — we write it | Immature, Python-only, 101★ |
| Browser Shape Detection API | N/A — doesn't exist for this shape | N/A | N/A | N/A | Not applicable |

## 4. Recommendation

**Phase 1 — validate the idea cheaply:** prototype with **jscanify** against real vinyl sleeves in realistic conditions (in-hand, store lighting, glare off glossy sleeves, sleeves stacked against each other). This is a few hours of work and answers the actual open question — *does contour-based detection reliably distinguish a sleeve from the rest of a cluttered frame* — before committing to anything.

**Phase 2 — if it earns its place:** replace jscanify with a **hand-rolled OpenCV.js pipeline** built against a **custom-trimmed `core`+`imgproc`-only WASM build** (cutting the ~8MB stock file to an estimated ~1.5–2MB), dynamically imported only when the camera capture stage opens. Write our own scoring function directly against `cv.findContours` output:

- largest convex 4-point contour,
- aspect ratio close to 1:1 (square, with some tolerance for slight tilt),
- area filling a healthy fraction of the existing `frameRect` guide (reuse `components/Scanner.tsx`'s existing viewfinder math — don't invent a second frame concept),
- required to hold "good enough" for N consecutive sampled frames (~1 second at 5-7 samples/sec) before auto-firing `captureFromCamera()`'s existing crop-and-snap path unchanged.

The manual shutter stays exactly as it is today — auto-capture is a layer on top, not a replacement, with an always-visible way to opt out or override (useful in low light, or if the heuristic keeps misfiring on a particular sleeve).

**Not recommended:** the commercial SDKs (values/cost mismatch for a free open-source project) or the ML-model route (solves a problem this task doesn't actually have — classical CV is the industry-standard, well-understood tool for exactly this shape-detection problem).

## 5. Open questions for Phase 1 to answer

- Real-world false-positive rate: how often does it lock onto the wrong square (a tile floor, another sleeve in the background, a phone screen) in a cluttered store environment?
- Does glare on glossy sleeve laminate meaningfully break edge detection, and if so, is a simple pre-blur/threshold tweak enough or does it need jscanify's advertised "glare suppression" (v1.3.0+)?
- What sampling rate actually feels responsive without janking the video preview on a mid-range Android phone (the 34fps-WebGL/7fps-Canvas gap between desktop and phone from the research above suggests this needs real on-device testing, not just desktop devtools).
- iOS Safari vs. Android Chrome parity — the existing `advanced: [{ focusMode: 'continuous' }]` camera-constraint comment ([components/Scanner.tsx:174-177](components/Scanner.tsx#L174)) already flags that Safari silently ignores some camera constraints; worth checking whether that extends to WASM/OpenCV.js performance too.

## Sources

- [How to Build a Browser Document Scanner with OpenCV.js and JavaScript (Dynamsoft)](https://www.dynamsoft.com/codepool/web-document-scanner-with-opencvjs.html)
- [OpenCV: Contours in OpenCV.js](https://docs.opencv.org/4.x/d0/d43/tutorial_js_table_of_contents_contours.html)
- [Smart Document Scanning with Live OCR using OpenCV.js (OpenCV blog)](https://opencv.org/blog/smart-document-scanning-with-live-ocr-using-opencv-js/)
- [jscanify GitHub repo](https://github.com/puffinsoft/jscanify)
- [jscanify npm package](https://www.npmjs.com/package/jscanify?activeTab=readme)
- [How to build a JS camera document scanner with jscanify (Scanbot tech blog)](https://scanbot.io/techblog/js-camera-document-scanner-tutorial/)
- [Dynamsoft Document Normalizer pricing](https://www.dynamsoft.com/document-normalizer/ask-for-quote/)
- [Dynamsoft Document Normalizer overview](https://www.dynamsoft.com/document-normalizer/overview/)
- [Scanbot JavaScript Document Scanner](https://scanbot.io/developer/javascript-document-scanner/)
- [The Shape Detection API (Chrome for Developers)](https://developer.chrome.com/docs/capabilities/shape-detection)
- [WICG Shape Detection API spec](https://wicg.github.io/shape-detection-api/)
- [Barcode Detection API (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/Barcode_Detection_API)
- [MediaPipe Tasks Vision npm package](https://www.npmjs.com/package/@mediapipe/tasks-vision)
- [Object detection guide for Web (MediaPipe/Google AI Edge)](https://developers.google.com/edge/mediapipe/solutions/vision/object_detector/web_js)
- [DocAligner GitHub repo](https://github.com/DocsaidLab/DocAligner)
- [Reduce file size of OpenCV.js (GitHub issue)](https://github.com/intel/webml-polyfill/issues/1348)
- [How to custom build OpenCV for JavaScript (and slim it down)](https://medium.com/@jinkawin.p/how-to-custom-build-opencv-for-javascript-and-slim-it-down-c9f832c1dcd5)
- [partly built opencv.js size is too big (opencv/opencv issue #21431)](https://github.com/opencv/opencv/issues/21431)
- [Real Time Edge Detection in Browser (Towards Data Science)](https://towardsdatascience.com/real-time-edge-detection-in-browser-ee4d61ba05ef/)
