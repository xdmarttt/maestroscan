/**
 * scan-offline.ts
 *
 * On-device bubble sheet scanner — TypeScript port of python/scan_service.py
 * using react-native-fast-opencv (JSI-based native OpenCV bindings).
 *
 * Requires:
 *   - expo prebuild  (generates ios/ and android/ native folders)
 *   - pod install    (links the native OpenCV framework)
 *   - EAS dev build  (NOT compatible with Expo Go)
 */

import PerspT from "perspective-transform";
import type { QuizQuestion } from "./quiz-storage";
import { computeGridLayout, WARP_W as GRID_WARP_W, WARP_H as GRID_WARP_H } from "./grid-layout";

// Lazy-load native OpenCV — fails gracefully in Expo Go
let OpenCV: any = null;
let ObjectType: any = null;
let DataTypes: any = null;
let ColorConversionCodes: any = null;
let AdaptiveThresholdTypes: any = null;
let ThresholdTypes: any = null;
let MorphTypes: any = null;
let MorphShapes: any = null;
let RetrievalModes: any = null;
let ContourApproximationModes: any = null;
let DecompTypes: any = null;
let InterpolationFlags: any = null;
let BorderTypes: any = null;

let _nativeAvailable: boolean | null = null;

function isNativeAvailable(): boolean {
  if (_nativeAvailable !== null) return _nativeAvailable;
  try {
    const mod = require("react-native-fast-opencv");
    OpenCV = mod.OpenCV;
    ObjectType = mod.ObjectType;
    DataTypes = mod.DataTypes;
    ColorConversionCodes = mod.ColorConversionCodes;
    AdaptiveThresholdTypes = mod.AdaptiveThresholdTypes;
    ThresholdTypes = mod.ThresholdTypes;
    MorphTypes = mod.MorphTypes;
    MorphShapes = mod.MorphShapes;
    RetrievalModes = mod.RetrievalModes;
    ContourApproximationModes = mod.ContourApproximationModes;
    DecompTypes = mod.DecompTypes;
    InterpolationFlags = mod.InterpolationFlags;
    BorderTypes = mod.BorderTypes;
    _nativeAvailable = true;
  } catch {
    _nativeAvailable = false;
    console.warn("[scan-offline] Native OpenCV not available — using server fallback");
  }
  return _nativeAvailable;
}

function getApiBase(): string {
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  if (!domain) throw new Error("EXPO_PUBLIC_DOMAIN not set — cannot reach scan server");
  const isLocal = /^(localhost|127\.|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(domain);
  return `${isLocal ? "http" : "https"}://${domain}`;
}

// ── Constants (must match python/scan_service.py and app/sheet.tsx) ──────────
const WARP_W = GRID_WARP_W;
const WARP_H = GRID_WARP_H;

// Registration mark ideal positions in warped space (TL, TR, BL, BR order)
const IDEAL_CORNERS: [number, number][] = [
  [(19.6 / 320) * WARP_W, (28.0 / 450) * WARP_H], // TL ≈ [49, 70]
  [(300.4 / 320) * WARP_W, (28.0 / 450) * WARP_H], // TR ≈ [751, 70]
  [(19.6 / 320) * WARP_W, (422.0 / 450) * WARP_H], // BL ≈ [49, 1050]
  [(300.4 / 320) * WARP_W, (422.0 / 450) * WARP_H], // BR ≈ [751, 1050]
];

// ── Ring pixel helpers (pure JS — only cross-bridge once for pixel buffer) ───

function ringMean(
  pixels: Uint8Array,
  W: number,
  H: number,
  cx: number,
  cy: number,
  rInner: number,
  rOuter: number
): number {
  const icx = Math.round(cx);
  const icy = Math.round(cy);
  const ro = Math.ceil(rOuter);
  const riSq = rInner * rInner;
  const roSq = rOuter * rOuter;
  let sum = 0;
  let count = 0;
  for (let dy = -ro; dy <= ro; dy++) {
    const py = icy + dy;
    if (py < 0 || py >= H) continue;
    for (let dx = -ro; dx <= ro; dx++) {
      const px = icx + dx;
      if (px < 0 || px >= W) continue;
      const dSq = dx * dx + dy * dy;
      if (dSq < riSq || dSq > roSq) continue;
      sum += pixels[py * W + px];
      count++;
    }
  }
  return count > 0 ? sum / count : 200;
}

function ringBright(
  pixels: Uint8Array,
  W: number,
  H: number,
  cx: number,
  cy: number,
  rInner: number,
  rOuter: number,
  pct = 80
): number {
  const icx = Math.round(cx);
  const icy = Math.round(cy);
  const ro = Math.ceil(rOuter);
  const riSq = rInner * rInner;
  const roSq = rOuter * rOuter;
  // Use 256-bin histogram instead of sort — O(n) vs O(n log n)
  const hist = new Uint16Array(256);
  let count = 0;
  for (let dy = -ro; dy <= ro; dy++) {
    const py = icy + dy;
    if (py < 0 || py >= H) continue;
    for (let dx = -ro; dx <= ro; dx++) {
      const px = icx + dx;
      if (px < 0 || px >= W) continue;
      const dSq = dx * dx + dy * dy;
      if (dSq < riSq || dSq > roSq) continue;
      hist[pixels[py * W + px]]++;
      count++;
    }
  }
  if (count === 0) return 200;
  // Find brightest pct% of values using histogram
  const cutoff = Math.floor(count * (1 - pct / 100));
  let skipped = 0;
  let sum = 0;
  let brightCount = 0;
  for (let v = 0; v < 256; v++) {
    if (hist[v] === 0) continue;
    if (skipped + hist[v] <= cutoff) {
      skipped += hist[v];
    } else {
      const take = hist[v] - Math.max(0, cutoff - skipped);
      sum += v * take;
      brightCount += take;
      skipped += hist[v] - take;
    }
  }
  return brightCount > 0 ? sum / brightCount : 200;
}

// Histogram normalization: percentile stretch (2–98), same as Python
function normalizePixels(pixels: Uint8Array): Uint8Array {
  // Sample every 4th pixel for speed
  const sample: number[] = [];
  for (let i = 0; i < pixels.length; i += 4) sample.push(pixels[i]);
  sample.sort((a, b) => a - b);
  const lo = sample[Math.floor(sample.length * 0.02)];
  const hi = sample[Math.floor(sample.length * 0.98)];
  if (hi <= lo) return pixels;
  const range = hi - lo;
  const out = new Uint8Array(pixels.length);
  for (let i = 0; i < pixels.length; i++) {
    out[i] = Math.max(0, Math.min(255, Math.round(((pixels[i] - lo) / range) * 255)));
  }
  return out;
}

// ── OpenCV mark detection ─────────────────────────────────────────────────────

interface Candidate {
  cx: number;
  cy: number;
  area: number;
}

/**
 * Adaptive threshold → morphological close → find contours →
 * filter by area, aspect ratio (≥0.60), solidity (≥0.82).
 *
 * Solidity = contourArea / (bw * bh):
 *   Solid square: ~1.0  → PASS
 *   Filled circle: π/4 ≈ 0.785 → FAIL  ← key discriminator
 */
function findMarkCandidates(
  blurred: ReturnType<typeof OpenCV.createObject>,
  W: number,
  H: number
): Candidate[] {
  // Block size must be odd and ≥3; match Python's formula
  const bsz = Math.max(31, Math.round(W * 0.18) | 1);

  const binary = OpenCV.createObject(ObjectType.Mat, 1, 1, DataTypes.CV_8UC1);
  OpenCV.invoke(
    "adaptiveThreshold",
    blurred,
    binary,
    255,
    AdaptiveThresholdTypes.ADAPTIVE_THRESH_GAUSSIAN_C,
    ThresholdTypes.THRESH_BINARY_INV,
    bsz,
    10
  );

  const kernel = OpenCV.invoke(
    "getStructuringElement",
    MorphShapes.MORPH_RECT,
    OpenCV.createObject(ObjectType.Size, 5, 5)
  );
  OpenCV.invoke("morphologyEx", binary, binary, MorphTypes.MORPH_CLOSE, kernel);

  const contours = OpenCV.createObject(ObjectType.MatVector);
  OpenCV.invoke(
    "findContours",
    binary,
    contours,
    RetrievalModes.RETR_EXTERNAL,
    ContourApproximationModes.CHAIN_APPROX_SIMPLE
  );

  const { array: contourInfos } = OpenCV.toJSValue(contours);
  const numContours = contourInfos.length;
  const minArea = (W * 0.01) ** 2;
  const maxArea = (W * 0.18) ** 2;
  const candidates: Candidate[] = [];

  for (let i = 0; i < numContours; i++) {
    const cnt = OpenCV.copyObjectFromVector(contours, i);
    const { value: area } = OpenCV.invoke("contourArea", cnt);

    if (area < minArea || area > maxArea) {
      OpenCV.releaseBuffers([cnt.id]);
      continue;
    }

    const rectHandle = OpenCV.invoke("boundingRect", cnt);
    const { x, y, width: bw, height: bh } = OpenCV.toJSValue(rectHandle);
    OpenCV.releaseBuffers([rectHandle.id]);

    if (bw < 2 || bh < 2) {
      OpenCV.releaseBuffers([cnt.id]);
      continue;
    }
    if (Math.min(bw, bh) / Math.max(bw, bh) < 0.6) {
      OpenCV.releaseBuffers([cnt.id]);
      continue;
    }
    if (area / (bw * bh) < 0.82) {
      OpenCV.releaseBuffers([cnt.id]);
      continue;
    }

    // Use bounding rect center as centroid (accurate for solid squares)
    candidates.push({ cx: x + bw / 2, cy: y + bh / 2, area });
    OpenCV.releaseBuffers([cnt.id]);
  }

  OpenCV.releaseBuffers([binary.id, kernel.id, contours.id]);
  return candidates;
}

/**
 * Find 4 corner registration marks.
 * Matches find_four_marks_strict() in Python.
 * Returns [TL, TR, BL, BR] or null.
 */
function findFourMarks(
  grayMat: ReturnType<typeof OpenCV.createObject>,
  pixels: Uint8Array,
  W: number,
  H: number
): [[number, number], [number, number], [number, number], [number, number]] | null {
  const blurred = OpenCV.createObject(ObjectType.Mat, 1, 1, DataTypes.CV_8UC1);
  OpenCV.invoke(
    "GaussianBlur",
    grayMat,
    blurred,
    OpenCV.createObject(ObjectType.Size, 5, 5),
    0
  );

  const candidates = findMarkCandidates(blurred, W, H);
  OpenCV.releaseBuffers([blurred.id]);

  if (candidates.length < 4) return null;

  // One darkest candidate per quadrant
  // Wider quadrant boundaries — marks slightly off-center still get picked up
  const quads = [
    { nx0: 0.0, nx1: 0.55, ny0: 0.0, ny1: 0.55 }, // TL
    { nx0: 0.45, nx1: 1.0, ny0: 0.0, ny1: 0.55 }, // TR
    { nx0: 0.0, nx1: 0.55, ny0: 0.45, ny1: 1.0 }, // BL
    { nx0: 0.45, nx1: 1.0, ny0: 0.45, ny1: 1.0 }, // BR
  ];

  const corners: [number, number][] = [];
  for (const { nx0, nx1, ny0, ny1 } of quads) {
    const inQ = candidates.filter(
      (c) => c.cx >= nx0 * W && c.cx < nx1 * W && c.cy >= ny0 * H && c.cy < ny1 * H
    );
    if (inQ.length === 0) return null;

    // Pick darkest: solid black squares have lower mean in 8px radius
    let best = inQ[0];
    let bestDark = ringMean(pixels, W, H, best.cx, best.cy, 0, 8);
    for (const cand of inQ.slice(1)) {
      const d = ringMean(pixels, W, H, cand.cx, cand.cy, 0, 8);
      if (d < bestDark) {
        bestDark = d;
        best = cand;
      }
    }
    corners.push([best.cx, best.cy]);
  }

  const [tl, tr, bl, br] = corners as [
    [number, number],
    [number, number],
    [number, number],
    [number, number],
  ];

  // Geometric validation (matches Python)
  const rectW = (tr[0] - tl[0] + br[0] - bl[0]) / 2;
  const rectH = (bl[1] - tl[1] + br[1] - tr[1]) / 2;
  if (rectW < W * 0.10 || rectH < H * 0.10) return null;

  const aspect = rectH / (rectW + 1e-6);
  if (aspect < 0.5 || aspect > 4.0) return null;

  if (tl[0] >= tr[0] || bl[0] >= br[0] || tl[1] >= bl[1] || tr[1] >= br[1]) return null;

  return [tl, tr, bl, br];
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Lightweight: detect registration marks only.
 * Uses native OpenCV when available, otherwise falls back to server API.
 */
export async function detectSheet(base64: string): Promise<{
  found: boolean;
  corners?: number[][];
}> {
  if (!isNativeAvailable()) {
    try {
      const resp = await fetch(`${getApiBase()}/api/detect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: base64 }),
      });
      return await resp.json();
    } catch (e) {
      console.warn("[scan-offline] server detect fallback error:", e);
      return { found: false };
    }
  }
  try {
    const bgrMat = OpenCV.base64ToMat(base64);
    const grayMat = OpenCV.createObject(ObjectType.Mat, 1, 1, DataTypes.CV_8UC1);
    OpenCV.invoke("cvtColor", bgrMat, grayMat, ColorConversionCodes.COLOR_BGR2GRAY);
    OpenCV.releaseBuffers([bgrMat.id]);

    const { cols: W, rows: H, buffer: pixels } = OpenCV.matToBuffer(grayMat, "uint8");
    const corners = findFourMarks(grayMat, pixels, W, H);
    OpenCV.releaseBuffers([grayMat.id]);

    if (!corners) return { found: false };
    return { found: true, corners };
  } catch (e) {
    console.warn("[scan-offline] detectSheet error:", e);
    return { found: false };
  }
}

/**
 * Full scan: detect marks → perspective warp → sample bubble grid → return answers.
 * Uses native OpenCV when available, otherwise falls back to server API.
 */
export async function scanSheet(
  base64: string,
  questions: QuizQuestion[],
  choiceCount: 4 | 5 = 4,
): Promise<{ answers: string[]; confidence: number[] }> {
  if (!isNativeAvailable()) {
    const resp = await fetch(`${getApiBase()}/api/scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageBase64: base64, questions, choiceCount }),
    });
    if (!resp.ok) throw new Error("Server scan failed");
    return await resp.json();
  }

  // 1. Load → grayscale
  const bgrMat = OpenCV.base64ToMat(base64);
  const grayMat = OpenCV.createObject(ObjectType.Mat, 1, 1, DataTypes.CV_8UC1);
  OpenCV.invoke("cvtColor", bgrMat, grayMat, ColorConversionCodes.COLOR_BGR2GRAY);
  OpenCV.releaseBuffers([bgrMat.id]);

  // 2. Get gray pixels for ring-mean-based mark ranking
  const { cols: W, rows: H, buffer: pixels } = OpenCV.matToBuffer(grayMat, "uint8");

  // 3. Detect 4 registration marks
  const corners = findFourMarks(grayMat, pixels, W, H);
  if (!corners) {
    OpenCV.releaseBuffers([grayMat.id]);
    throw new Error("Sheet not aligned — make sure all 4 corner marks are visible");
  }
  const [tl, tr, bl, br] = corners;

  // 4. Perspective warp: detected corners → ideal 800×1125
  const p2f = (x: number, y: number) => OpenCV.createObject(ObjectType.Point2f, x, y);
  const srcPts = OpenCV.createObject(ObjectType.Point2fVector, [
    p2f(tl[0], tl[1]),
    p2f(tr[0], tr[1]),
    p2f(bl[0], bl[1]),
    p2f(br[0], br[1]),
  ]);
  const dstPts = OpenCV.createObject(ObjectType.Point2fVector, [
    p2f(IDEAL_CORNERS[0][0], IDEAL_CORNERS[0][1]),
    p2f(IDEAL_CORNERS[1][0], IDEAL_CORNERS[1][1]),
    p2f(IDEAL_CORNERS[2][0], IDEAL_CORNERS[2][1]),
    p2f(IDEAL_CORNERS[3][0], IDEAL_CORNERS[3][1]),
  ]);

  const M = OpenCV.invoke("getPerspectiveTransform", srcPts, dstPts, DecompTypes.DECOMP_LU);
  const warpedMat = OpenCV.createObject(ObjectType.Mat, 1, 1, DataTypes.CV_8UC1);
  const warpSize = OpenCV.createObject(ObjectType.Size, WARP_W, WARP_H);
  const borderVal = OpenCV.createObject(ObjectType.Scalar, 0);
  OpenCV.invoke(
    "warpPerspective",
    grayMat,
    warpedMat,
    M,
    warpSize,
    InterpolationFlags.INTER_LINEAR,
    BorderTypes.BORDER_CONSTANT,
    borderVal
  );
  OpenCV.releaseBuffers([grayMat.id, srcPts.id, dstPts.id, M.id, warpSize.id, borderVal.id]);

  // 5. Get warped pixel buffer
  const { cols: wW, rows: wH, buffer: rawPixels } = OpenCV.matToBuffer(warpedMat, "uint8");

  OpenCV.releaseBuffers([warpedMat.id]);

  // 6. Histogram normalization (percentile stretch 2–98, same as Python)
  const warpedPixels = normalizePixels(rawPixels);

  // 7. Sample bubble grid using dynamic layout
  const layout = computeGridLayout(questions.length, choiceCount);
  const answers: string[] = [];
  const confidence: number[] = [];

  for (let q = 0; q < layout.questionCount; q++) {
    const ratios: number[] = [];
    for (let c = 0; c < layout.choiceCount; c++) {
      const { nx, ny } = layout.bubbleCenter(q, c);
      const cx = nx * wW;
      const cy = ny * wH;
      const inner = ringMean(warpedPixels, wW, wH, cx, cy, 0, layout.innerR);
      const outer = ringBright(warpedPixels, wW, wH, cx, cy, layout.outerR1, layout.outerR2);
      const ratio = (outer - inner) / Math.max(outer, 64);
      ratios.push(ratio);
    }

    const sorted = [...ratios].sort((a, b) => b - a);
    const best = sorted[0];
    const second = sorted[1] ?? 0;
    const gap = best - second;
    const bestIdx = ratios.indexOf(best);

    if (best >= layout.minRatio && gap >= layout.minGap) {
      answers.push(layout.letters[bestIdx]);
      confidence.push(Math.min(1, gap / 0.4));
    } else {
      answers.push("?");
      confidence.push(0);
    }
  }

  return { answers, confidence };
}

/**
 * Combined detect + scan in a single pass.
 * One base64→Mat decode, one grayscale conversion — avoids double processing.
 * Returns null if marks not found (no error thrown), or answers if successful.
 */
export async function detectAndScan(
  base64: string,
  questions: QuizQuestion[],
  choiceCount: 4 | 5 = 4,
): Promise<{ found: false } | { found: true; answers: string[]; confidence: number[]; corners: [number, number][]; imageSize: [number, number] }> {
  if (!isNativeAvailable()) {
    // Server fallback: detect first, then scan if found
    try {
      const detectResp = await fetch(`${getApiBase()}/api/detect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: base64 }),
      });
      const detectData = await detectResp.json();
      if (!detectData.found) return { found: false };

      const scanResp = await fetch(`${getApiBase()}/api/scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: base64, questions, choiceCount }),
      });
      if (!scanResp.ok) return { found: false };
      const scanData = await scanResp.json();
      const detectedCorners = detectData.corners || [[0,0],[0,0],[0,0],[0,0]];
      return { found: true, ...scanData, corners: detectedCorners, imageSize: [0, 0] as [number, number] };
    } catch {
      return { found: false };
    }
  }

  // Single OpenCV session: decode → gray → detect → warp → sample
  const bgrMat = OpenCV.base64ToMat(base64);
  const grayMat = OpenCV.createObject(ObjectType.Mat, 1, 1, DataTypes.CV_8UC1);
  OpenCV.invoke("cvtColor", bgrMat, grayMat, ColorConversionCodes.COLOR_BGR2GRAY);
  OpenCV.releaseBuffers([bgrMat.id]);

  const { cols: W, rows: H, buffer: pixels } = OpenCV.matToBuffer(grayMat, "uint8");
  const corners = findFourMarks(grayMat, pixels, W, H);

  if (!corners) {
    OpenCV.releaseBuffers([grayMat.id]);
    return { found: false };
  }

  // Marks found — continue straight to warp + bubble sampling
  const [tl, tr, bl, br] = corners;
  const p2f = (x: number, y: number) => OpenCV.createObject(ObjectType.Point2f, x, y);
  const srcPts = OpenCV.createObject(ObjectType.Point2fVector, [
    p2f(tl[0], tl[1]), p2f(tr[0], tr[1]), p2f(bl[0], bl[1]), p2f(br[0], br[1]),
  ]);
  const dstPts = OpenCV.createObject(ObjectType.Point2fVector, [
    p2f(IDEAL_CORNERS[0][0], IDEAL_CORNERS[0][1]),
    p2f(IDEAL_CORNERS[1][0], IDEAL_CORNERS[1][1]),
    p2f(IDEAL_CORNERS[2][0], IDEAL_CORNERS[2][1]),
    p2f(IDEAL_CORNERS[3][0], IDEAL_CORNERS[3][1]),
  ]);

  const M = OpenCV.invoke("getPerspectiveTransform", srcPts, dstPts, DecompTypes.DECOMP_LU);
  const warpedMat = OpenCV.createObject(ObjectType.Mat, 1, 1, DataTypes.CV_8UC1);
  const warpSize = OpenCV.createObject(ObjectType.Size, WARP_W, WARP_H);
  const borderVal = OpenCV.createObject(ObjectType.Scalar, 0);
  OpenCV.invoke(
    "warpPerspective", grayMat, warpedMat, M, warpSize,
    InterpolationFlags.INTER_LINEAR, BorderTypes.BORDER_CONSTANT, borderVal
  );
  OpenCV.releaseBuffers([grayMat.id, srcPts.id, dstPts.id, M.id, warpSize.id, borderVal.id]);

  const { cols: wW, rows: wH, buffer: rawPixels } = OpenCV.matToBuffer(warpedMat, "uint8");
  OpenCV.releaseBuffers([warpedMat.id]);

  const warpedPixels = normalizePixels(rawPixels);

  const layout = computeGridLayout(questions.length, choiceCount);
  const answers: string[] = [];
  const confidence: number[] = [];
  for (let q = 0; q < layout.questionCount; q++) {
    const ratios: number[] = [];
    for (let c = 0; c < layout.choiceCount; c++) {
      const { nx, ny } = layout.bubbleCenter(q, c);
      const cx = nx * wW;
      const cy = ny * wH;
      const inner = ringMean(warpedPixels, wW, wH, cx, cy, 0, layout.innerR);
      const outer = ringBright(warpedPixels, wW, wH, cx, cy, layout.outerR1, layout.outerR2);
      ratios.push((outer - inner) / Math.max(outer, 64));
    }
    const sorted = [...ratios].sort((a, b) => b - a);
    const best = sorted[0];
    const second = sorted[1] ?? 0;
    const gap = best - second;
    const bestIdx = ratios.indexOf(best);
    if (best >= layout.minRatio && gap >= layout.minGap) {
      answers.push(layout.letters[bestIdx]);
      confidence.push(Math.min(1, gap / 0.4));
    } else {
      answers.push("?");
      confidence.push(0);
    }
  }

  return { found: true, answers, confidence, corners, imageSize: [W, H] as [number, number] };
}

// ── Fallback: perspective-transform JS library ────────────────────────────────
// If react-native-fast-opencv's warpPerspective is unavailable, this alternative
// uses the already-installed `perspective-transform` package to map bubble
// positions directly from warped space back to original image coords,
// sampling from the gray pixel buffer without needing a warped Mat.
//
// Usage: replace step 4–5 in scanSheet() with this approach:
//
// export async function scanSheetFallback(base64, questions) {
//   const { cols: W, rows: H, buffer: pixels } = ...; // gray pixels from bgrMat
//   const corners = findFourMarks(...);
//   // inverse homography: warped space → original image
//   const srcFlat = [tl[0],tl[1], tr[0],tr[1], bl[0],bl[1], br[0],br[1]];
//   const dstFlat = IDEAL_CORNERS.flat();
//   const inv = PerspT(dstFlat, srcFlat); // maps ideal → original
//   for each bubble at (wx, wy):
//     const [ix, iy] = inv.transform(wx, wy);
//     const inner = ringMean(pixels, W, H, ix, iy, INNER_R_ORIG, ...);
//     ...
// }
//
// Scale factor: original image is ~800px wide; warped is 800×1125.
// Bubble sampling radii in original space ≈ radii in warped space × 0.9.

export { PerspT }; // re-export so fallback can import from one place
