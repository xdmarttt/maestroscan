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
import { decodeCode128B } from "./barcode";

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
let LineTypes: any = null;

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
    LineTypes = mod.LineTypes;
    _nativeAvailable = true;
  } catch {
    _nativeAvailable = false;
    console.warn("[scan-offline] Native OpenCV not available — using server fallback");
  }
  return _nativeAvailable;
}

/** Pre-load native OpenCV module + JIT-compile a tiny Mat to warm up the JSI bridge. */
export function warmupOpenCV(): void {
  if (!isNativeAvailable()) return;
  try {
    const m = OpenCV.createObject(ObjectType.Mat, 1, 1, DataTypes.CV_8UC1);
    OpenCV.releaseBuffers([m.id]);
  } catch {}
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

// ringBright removed — outer ring now uses ringMean for speed

// ── OpenCV mark detection ─────────────────────────────────────────────────────

interface Candidate {
  cx: number;
  cy: number;
  area: number;
}

/**
 * Threshold a (possibly downscaled) blurred image, find contours,
 * and collect square-ish dark blob candidates.
 *
 * Uses morph OPEN (erode→dilate) to break thin pixel bridges between
 * marks and the desk background at sheet edges.
 */
function collectCandidatesFromBinary(
  binary: ReturnType<typeof OpenCV.createObject>,
  minArea: number,
  maxArea: number,
  existing: Candidate[],
): void {
  // Morph OPEN: break thin connections between marks and desk background
  const kszCand = OpenCV.createObject(ObjectType.Size, 3, 3);
  const kernel = OpenCV.invoke(
    "getStructuringElement",
    MorphShapes.MORPH_RECT,
    kszCand,
  );
  OpenCV.releaseBuffers([kszCand.id]);
  OpenCV.invoke("morphologyEx", binary, binary, MorphTypes.MORPH_OPEN, kernel);

  const contours = OpenCV.createObject(ObjectType.MatVector);
  OpenCV.invoke(
    "findContours",
    binary,
    contours,
    RetrievalModes.RETR_EXTERNAL,
    ContourApproximationModes.CHAIN_APPROX_SIMPLE
  );

  const { array: contourInfos } = OpenCV.toJSValue(contours);
  for (let i = 0; i < contourInfos.length; i++) {
    const cnt = OpenCV.copyObjectFromVector(contours, i);
    const { value: area } = OpenCV.invoke("contourArea", cnt);

    if (area < minArea || area > maxArea) {
      OpenCV.releaseBuffers([cnt.id]);
      continue;
    }

    const rectHandle = OpenCV.invoke("boundingRect", cnt);
    const { x, y, width: bw, height: bh } = OpenCV.toJSValue(rectHandle);
    OpenCV.releaseBuffers([rectHandle.id, cnt.id]);

    if (bw < 2 || bh < 2) continue;
    // Relaxed: perspective makes squares trapezoidal
    if (Math.min(bw, bh) / Math.max(bw, bh) < 0.5) continue;
    // Relaxed: printing artifacts + perspective lower solidity
    if (area / (bw * bh) < 0.65) continue;

    const cx = x + bw / 2;
    const cy = y + bh / 2;

    // Dedup: skip if too close to an existing candidate
    const isDup = existing.some(
      (e) => Math.abs(e.cx - cx) < bw && Math.abs(e.cy - cy) < bh
    );
    if (!isDup) existing.push({ cx, cy, area });
  }

  OpenCV.releaseBuffers([kernel.id, contours.id]);
}

/**
 * Find mark candidates using two complementary threshold strategies:
 * 1. Adaptive threshold — handles uneven lighting
 * 2. Fixed low threshold — catches very dark marks regardless of context
 *
 * Both use morph OPEN to break mark↔background connections at sheet edges.
 */
function findMarkCandidates(
  blurred: ReturnType<typeof OpenCV.createObject>,
  W: number,
): Candidate[] {
  const minArea = (W * 0.008) ** 2;
  const maxArea = (W * 0.15) ** 2;
  const candidates: Candidate[] = [];

  // Strategy 1: Adaptive threshold — moderate block size, higher C for selectivity
  const bsz = Math.max(15, Math.round(W * 0.10) | 1);
  const adaptBin = OpenCV.createObject(ObjectType.Mat, 1, 1, DataTypes.CV_8UC1);
  OpenCV.invoke(
    "adaptiveThreshold",
    blurred,
    adaptBin,
    255,
    AdaptiveThresholdTypes.ADAPTIVE_THRESH_GAUSSIAN_C,
    ThresholdTypes.THRESH_BINARY_INV,
    bsz,
    12
  );
  collectCandidatesFromBinary(adaptBin, minArea, maxArea, candidates);
  OpenCV.releaseBuffers([adaptBin.id]);

  // Strategy 2: Fixed low threshold — marks are the darkest blobs in the image.
  // This catches marks that adaptive misses at sheet edges (where desk background
  // pulls the local mean dark, making marks "not dark enough" relative to it).
  const fixedBin = OpenCV.createObject(ObjectType.Mat, 1, 1, DataTypes.CV_8UC1);
  OpenCV.invoke(
    "threshold",
    blurred,
    fixedBin,
    80,
    255,
    ThresholdTypes.THRESH_BINARY_INV
  );
  collectCandidatesFromBinary(fixedBin, minArea, maxArea, candidates);
  OpenCV.releaseBuffers([fixedBin.id]);

  return candidates;
}

interface MarkDetectionResult {
  /** Validated corners [TL, TR, BL, BR] or null if geometric checks fail */
  corners: [[number, number], [number, number], [number, number], [number, number]] | null;
  /** Per-quadrant best candidate (even if full validation fails) */
  partial: ([number, number] | null)[];
  /** Detected midpoint marks [leftMid, rightMid] or null */
  midpoints?: ([number, number] | null)[];
}

/**
 * Find 4 corner registration marks.
 * Downscales large images for speed and better threshold behavior,
 * then maps results back to original coordinates.
 * Returns validated corners + per-quadrant partial results.
 */
function findFourMarks(
  grayMat: ReturnType<typeof OpenCV.createObject>,
  pixels: Uint8Array,
  W: number,
  H: number
): MarkDetectionResult {
  // Downscale large images — improves speed and threshold robustness.
  // Mark detection doesn't need full resolution.
  const MAX_DIM = 800;
  const needScale = Math.max(W, H) > MAX_DIM;
  const scale = needScale ? MAX_DIM / Math.max(W, H) : 1;
  const sW = Math.round(W * scale);
  const sH = Math.round(H * scale);

  let workMat = grayMat;
  if (needScale) {
    workMat = OpenCV.createObject(ObjectType.Mat, 1, 1, DataTypes.CV_8UC1);
    const dsize = OpenCV.createObject(ObjectType.Size, sW, sH);
    OpenCV.invoke("resize", grayMat, workMat, dsize, 0, 0, InterpolationFlags.INTER_AREA);
    OpenCV.releaseBuffers([dsize.id]);
  }

  const blurred = OpenCV.createObject(ObjectType.Mat, 1, 1, DataTypes.CV_8UC1);
  OpenCV.invoke(
    "GaussianBlur",
    workMat,
    blurred,
    OpenCV.createObject(ObjectType.Size, 5, 5),
    0
  );
  if (needScale) OpenCV.releaseBuffers([workMat.id]);

  const candidates = findMarkCandidates(blurred, sW);
  OpenCV.releaseBuffers([blurred.id]);

  const EMPTY: MarkDetectionResult = { corners: null, partial: [null, null, null, null] };

  if (candidates.length < 4) return EMPTY;

  // Filter out small candidates (midpoints are 10×10, corners are 20×20).
  // Keep only candidates whose area is at least 40% of the largest candidate.
  const maxCandArea = Math.max(...candidates.map(c => c.area));
  const filtered = candidates.filter(c => c.area >= maxCandArea * 0.4);
  if (filtered.length < 4) return EMPTY;

  // Scale ALL candidates back to original image coordinates (before separating)
  if (needScale) {
    const invScale = 1 / scale;
    for (const c of candidates) {
      c.cx *= invScale;
      c.cy *= invScale;
    }
  }

  // Keep all candidates (incl. small midpoint marks) for midpoint detection later
  const allCandidates = candidates.map(c => ({ ...c })); // deep copy

  candidates.length = 0;
  candidates.push(...filtered);

  // One darkest candidate per quadrant (using original-resolution pixels)
  const quads = [
    { nx0: 0.0, nx1: 0.55, ny0: 0.0, ny1: 0.55 }, // TL
    { nx0: 0.45, nx1: 1.0, ny0: 0.0, ny1: 0.55 }, // TR
    { nx0: 0.0, nx1: 0.55, ny0: 0.45, ny1: 1.0 }, // BL
    { nx0: 0.45, nx1: 1.0, ny0: 0.45, ny1: 1.0 }, // BR
  ];

  const partial: ([number, number] | null)[] = [];
  const cornerDarkness: number[] = [];
  for (const { nx0, nx1, ny0, ny1 } of quads) {
    const inQ = candidates.filter(
      (c) => c.cx >= nx0 * W && c.cx < nx1 * W && c.cy >= ny0 * H && c.cy < ny1 * H
    );
    if (inQ.length === 0) { partial.push(null); cornerDarkness.push(999); continue; }

    // Pick largest dark candidate — corners (20×20) are bigger than midpoints (10×10)
    const darkEnough = inQ.filter(
      (c) => ringMean(pixels, W, H, c.cx, c.cy, 0, 8) < 190
    );
    if (darkEnough.length === 0) { partial.push(null); cornerDarkness.push(999); continue; }
    const best = darkEnough.reduce((a, b) => (b.area > a.area ? b : a));
    const bestDark = ringMean(pixels, W, H, best.cx, best.cy, 0, 8);
    partial.push([best.cx, best.cy]);
    cornerDarkness.push(bestDark);
  }

  // Need all 4 for geometric validation
  if (partial.some(c => c === null)) return { corners: null, partial };

  // All 4 corners must be genuinely dark — reject random objects
  for (const d of cornerDarkness) {
    if (d > 190) return { corners: null, partial };
  }

  const [tl, tr, bl, br] = partial as [
    [number, number],
    [number, number],
    [number, number],
    [number, number],
  ];

  // Geometric validation
  const rectW = (tr[0] - tl[0] + br[0] - bl[0]) / 2;
  const rectH = (bl[1] - tl[1] + br[1] - tr[1]) / 2;
  if (rectW < W * 0.10 || rectH < H * 0.10) return { corners: null, partial };

  const aspect = rectH / (rectW + 1e-6);
  if (aspect < 0.5 || aspect > 3.0) return { corners: null, partial };

  if (tl[0] >= tr[0] || bl[0] >= br[0] || tl[1] >= bl[1] || tr[1] >= br[1]) return { corners: null, partial };

  // Parallel-sides check
  const topW = tr[0] - tl[0];
  const botW = br[0] - bl[0];
  const leftH = bl[1] - tl[1];
  const rightH = br[1] - tr[1];
  if (topW / botW < 0.3 || topW / botW > 3.0) return { corners: null, partial };
  if (leftH / rightH < 0.3 || leftH / rightH > 3.0) return { corners: null, partial };

  // Contrast check: center of sheet must be brighter than the corner marks.
  const centerX = (tl[0] + tr[0] + bl[0] + br[0]) / 4;
  const centerY = (tl[1] + tr[1] + bl[1] + br[1]) / 4;
  const centerBright = ringMean(pixels, W, H, centerX, centerY, 0, 16);
  const avgCornerDark = cornerDarkness.reduce((a, b) => a + b, 0) / 4;
  if (centerBright - avgCornerDark < 25) return { corners: null, partial };

  // Detect midpoint marks (smaller 10×10 squares at left & right edges, vertically centered).
  // These are in allCandidates but were filtered out of corners by the 40% area filter.
  // Look for small dark candidates in the left-mid and right-mid zones.
  const midY0 = 0.35, midY1 = 0.65; // vertical center band
  const midpoints: ([number, number] | null)[] = [null, null];

  // Left midpoint: left 20% of sheet, vertical center
  const leftMidCands = allCandidates.filter(c =>
    c.cx < tl[0] + (tr[0] - tl[0]) * 0.15 &&
    c.cy >= tl[1] + (bl[1] - tl[1]) * midY0 &&
    c.cy <= tl[1] + (bl[1] - tl[1]) * midY1 &&
    c.area < maxCandArea * 0.5 // smaller than corners
  );
  if (leftMidCands.length > 0) {
    const best = leftMidCands.reduce((a, b) => ringMean(pixels, W, H, a.cx, a.cy, 0, 6) < ringMean(pixels, W, H, b.cx, b.cy, 0, 6) ? a : b);
    midpoints[0] = [best.cx, best.cy];
  }

  // Right midpoint: right 20% of sheet, vertical center
  const rightMidCands = allCandidates.filter(c =>
    c.cx > tr[0] - (tr[0] - tl[0]) * 0.15 &&
    c.cy >= tr[1] + (br[1] - tr[1]) * midY0 &&
    c.cy <= tr[1] + (br[1] - tr[1]) * midY1 &&
    c.area < maxCandArea * 0.5
  );
  if (rightMidCands.length > 0) {
    const best = rightMidCands.reduce((a, b) => ringMean(pixels, W, H, a.cx, a.cy, 0, 6) < ringMean(pixels, W, H, b.cx, b.cy, 0, 6) ? a : b);
    midpoints[1] = [best.cx, best.cy];
  }

  return { corners: [tl, tr, bl, br], partial, midpoints };
}

// ── Student ID barcode reading ───────────────────────────────────────────────

// Barcode region on the sheet (normalized 0-1 coordinates)
const BARCODE_X0 = 0.18;
const BARCODE_X1 = 0.82;
const BARCODE_SCAN_LINES = [0.888, 0.893, 0.898, 0.903, 0.908];
const BARCODE_SAMPLES = 500; // horizontal sample points per scan line

/**
 * Read student ID from a Code 128B barcode at the bottom of the sheet.
 * Samples multiple horizontal scan lines across the barcode region via PerspT,
 * averages them for noise reduction, then decodes the bar pattern.
 * Returns decoded string or null if unreadable.
 */
function binarizeAdaptive(profile: Float64Array, window: number): number[] | null {
  const N = profile.length;
  const half = Math.floor(window / 2);

  // Compute prefix sums for O(1) local average
  const prefix = new Float64Array(N + 1);
  for (let i = 0; i < N; i++) prefix[i + 1] = prefix[i] + profile[i];

  // Binarize: bar (1) if below local average, space (0) if above
  const binary = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    const lo = Math.max(0, i - half);
    const hi = Math.min(N - 1, i + half);
    const localAvg = (prefix[hi + 1] - prefix[lo]) / (hi - lo + 1);
    binary[i] = profile[i] < localAvg ? 1 : 0;
  }

  // Skip leading quiet zone (spaces)
  let start = 0;
  while (start < N && binary[start] === 0) start++;
  if (start >= N) return null;

  // Run-length encode from first bar
  const runs: number[] = [];
  let cur = 1; // 1 = bar
  let len = 1;
  for (let i = start + 1; i < N; i++) {
    if (binary[i] === cur) {
      len++;
    } else {
      runs.push(len);
      cur = binary[i];
      len = 1;
    }
  }
  runs.push(len);
  // Trim trailing space (quiet zone)
  if (runs.length > 0 && runs.length % 2 === 0) runs.pop();
  return runs;
}

function binarizeGlobal(profile: Float64Array, thresh: number): number[] | null {
  const N = profile.length;
  let start = 0;
  while (start < N && profile[start] >= thresh) start++;
  if (start >= N) return null;

  const runs: number[] = [];
  let isBar = true;
  let runLen = 1;
  for (let i = start + 1; i < N; i++) {
    const curBar = profile[i] < thresh;
    if (curBar === isBar) {
      runLen++;
    } else {
      runs.push(runLen);
      isBar = curBar;
      runLen = 1;
    }
  }
  runs.push(runLen);
  if (runs.length > 0 && runs.length % 2 === 0) runs.pop();
  return runs;
}

function tryDecodeRuns(runs: number[]): string | null {
  if (!runs || runs.length < 19) return null;
  // Try with and without trimming trailing noise
  for (let trim = 0; trim <= 4; trim += 2) {
    const trimmed = trim === 0 ? runs : runs.slice(0, runs.length - trim);
    if (trimmed.length < 19) break;
    const decoded = decodeCode128B(trimmed);
    if (decoded) return decoded;
  }
  return null;
}

function readStudentId(
  pixels: Uint8Array,
  W: number,
  H: number,
  corners: [number, number][],
): string | null {
  try {
    const idealFlat = IDEAL_CORNERS.flatMap(([x, y]) => [x, y]);
    const detectedFlat = corners.flatMap(([x, y]: [number, number]) => [x, y]);
    const invPersp = PerspT(idealFlat, detectedFlat);

    // Sample multiple horizontal scan lines across the barcode region and average
    const rawProfile = new Float64Array(BARCODE_SAMPLES);
    let oobCount = 0;
    for (const ny of BARCODE_SCAN_LINES) {
      for (let s = 0; s < BARCODE_SAMPLES; s++) {
        const nx = BARCODE_X0 + (s / (BARCODE_SAMPLES - 1)) * (BARCODE_X1 - BARCODE_X0);
        const [ix, iy] = invPersp.transform(nx * WARP_W, ny * WARP_H);
        const px = Math.round(ix);
        const py = Math.round(iy);
        if (px >= 0 && px < W && py >= 0 && py < H) {
          rawProfile[s] += pixels[py * W + px];
        } else {
          rawProfile[s] += 200;
          oobCount++;
        }
      }
    }
    for (let i = 0; i < BARCODE_SAMPLES; i++) {
      rawProfile[i] /= BARCODE_SCAN_LINES.length;
    }

    // Smooth with 3-sample moving average
    const profile = new Float64Array(BARCODE_SAMPLES);
    profile[0] = rawProfile[0];
    profile[BARCODE_SAMPLES - 1] = rawProfile[BARCODE_SAMPLES - 1];
    for (let i = 1; i < BARCODE_SAMPLES - 1; i++) {
      profile[i] = (rawProfile[i - 1] + rawProfile[i] + rawProfile[i + 1]) / 3;
    }

    let pMin = 255, pMax = 0;
    for (let i = 0; i < BARCODE_SAMPLES; i++) {
      if (profile[i] < pMin) pMin = profile[i];
      if (profile[i] > pMax) pMax = profile[i];
    }
    const contrast = pMax - pMin;
    console.log(`[scan] barcode profile: min=${pMin.toFixed(0)} max=${pMax.toFixed(0)} contrast=${contrast.toFixed(0)} oob=${oobCount}/${BARCODE_SCAN_LINES.length * BARCODE_SAMPLES}`);
    if (contrast < 30) {
      console.log("[scan] barcode: no contrast, skipping");
      return null;
    }

    // Strategy 1: Local adaptive threshold (robust to ink bleed & perspective)
    // Window ≈ 2-3x widest bar. At ~3 samples/module, widest bar = 4 modules ≈ 12 samples.
    for (const window of [25, 35, 19]) {
      const runs = binarizeAdaptive(profile, window);
      if (!runs) continue;
      const decoded = tryDecodeRuns(runs);
      if (decoded) {
        console.log(`[scan] barcode: "${decoded}" (adaptive w=${window}, runs=${runs.length})`);
        return decoded;
      }
    }

    // Strategy 2: Global threshold fallback (multiple levels)
    for (const frac of [0.50, 0.45, 0.55, 0.40, 0.60]) {
      const thresh = pMin + contrast * frac;
      const runs = binarizeGlobal(profile, thresh);
      if (!runs) continue;
      const decoded = tryDecodeRuns(runs);
      if (decoded) {
        console.log(`[scan] barcode: "${decoded}" (global thresh=${frac}, runs=${runs.length})`);
        return decoded;
      }
    }

    // Debug log
    const adaptiveRuns = binarizeAdaptive(profile, 25);
    const globalRuns = binarizeGlobal(profile, pMin + contrast * 0.5);
    console.log(`[scan] barcode: decode failed (adaptive=${adaptiveRuns?.length ?? 0} global=${globalRuns?.length ?? 0} first10=${adaptiveRuns?.slice(0, 10).join(",") ?? ""})`);
    return null;
  } catch (e) {
    console.warn("[scan] barcode read error:", e);
    return null;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Lightweight: detect registration marks only.
 * Uses native OpenCV when available, otherwise falls back to server API.
 */
export async function detectSheet(base64: string): Promise<{
  found: boolean;
  corners?: number[][];
  /** Per-corner candidates [TL, TR, BL, BR] — available even when found=false */
  partial: ([number, number] | null)[];
  /** Image dimensions of the processed frame */
  imageSize?: [number, number];
}> {
  const noResult = { found: false, partial: [null, null, null, null] as ([number, number] | null)[] };
  if (!isNativeAvailable()) {
    try {
      const resp = await fetch(`${getApiBase()}/api/detect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: base64 }),
      });
      const data = await resp.json();
      return { ...noResult, ...data };
    } catch (e) {
      console.warn("[scan-offline] server detect fallback error:", e);
      return noResult;
    }
  }
  try {
    const bgrMat = OpenCV.base64ToMat(base64);
    const grayMat = OpenCV.createObject(ObjectType.Mat, 1, 1, DataTypes.CV_8UC1);
    OpenCV.invoke("cvtColor", bgrMat, grayMat, ColorConversionCodes.COLOR_BGR2GRAY);
    OpenCV.releaseBuffers([bgrMat.id]);

    const { cols: W, rows: H, buffer: pixels } = OpenCV.matToBuffer(grayMat, "uint8");
    const result = findFourMarks(grayMat, pixels, W, H);
    OpenCV.releaseBuffers([grayMat.id]);

    return {
      found: result.corners !== null,
      corners: result.corners ?? undefined,
      partial: result.partial,
      imageSize: [W, H],
    };
  } catch (e) {
    console.warn("[scan-offline] detectSheet error:", e);
    return noResult;
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
): Promise<{ answers: string[]; confidence: number[]; corners: [[number,number],[number,number],[number,number],[number,number]] | null }> {
  if (!isNativeAvailable()) {
    const resp = await fetch(`${getApiBase()}/api/scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageBase64: base64, questions, choiceCount }),
    });
    if (!resp.ok) throw new Error("Server scan failed");
    const data = await resp.json();
    return { ...data, corners: null };
  }

  // 1. Load → grayscale
  const bgrMat = OpenCV.base64ToMat(base64);
  const grayMat = OpenCV.createObject(ObjectType.Mat, 1, 1, DataTypes.CV_8UC1);
  OpenCV.invoke("cvtColor", bgrMat, grayMat, ColorConversionCodes.COLOR_BGR2GRAY);
  OpenCV.releaseBuffers([bgrMat.id]);

  // 2. Get gray pixels for ring-mean-based mark ranking
  const { cols: W, rows: H, buffer: pixels } = OpenCV.matToBuffer(grayMat, "uint8");

  // 3. Detect 4 registration marks
  const markResult = findFourMarks(grayMat, pixels, W, H);
  if (!markResult.corners) {
    OpenCV.releaseBuffers([grayMat.id]);
    throw new Error("Sheet not aligned — make sure all 4 corner marks are visible");
  }
  const [tl, tr, bl, br] = markResult.corners;

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

  // 5. Normalize in native OpenCV (much faster than JS pixel loop)
  OpenCV.invoke("normalize", warpedMat, warpedMat, 0, 255, 32 /* NORM_MINMAX */);

  // 6. Get warped pixel buffer
  const { cols: wW, rows: wH, buffer: warpedPixels } = OpenCV.matToBuffer(warpedMat, "uint8");
  OpenCV.releaseBuffers([warpedMat.id]);

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
      const outer = ringMean(warpedPixels, wW, wH, cx, cy, layout.outerR1, layout.outerR2);
      ratios.push((outer - inner) / Math.max(outer, 64));
    }

    // Find best and second-best inline — avoids array copy + sort
    let best = -Infinity, second = -Infinity, bestIdx = 0;
    for (let i = 0; i < ratios.length; i++) {
      if (ratios[i] > best) { second = best; best = ratios[i]; bestIdx = i; }
      else if (ratios[i] > second) { second = ratios[i]; }
    }
    const gap = best - second;

    if (best >= layout.minRatio && gap >= layout.minGap) {
      answers.push(layout.letters[bestIdx]);
      confidence.push(Math.min(1, gap / 0.4));
    } else {
      answers.push("?");
      confidence.push(0);
    }
  }

  return { answers, confidence, corners: markResult.corners };
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
): Promise<{ found: false } | { found: true; answers: string[]; confidence: number[]; corners: [number, number][]; imageSize: [number, number]; studentId: string | null }> {
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

  const { cols: W, rows: H, buffer: rawPixels } = OpenCV.matToBuffer(grayMat, "uint8");

  // Blur check: compute gradient variance on pixel buffer (Laplacian-like)
  // Sample every 4th pixel for speed — still accurate enough
  let gradSum = 0, gradSumSq = 0, gradN = 0;
  for (let y = 1; y < H - 1; y += 2) {
    for (let x = 1; x < W - 1; x += 2) {
      const idx = y * W + x;
      const lap = rawPixels[idx] * 4
        - rawPixels[idx - 1] - rawPixels[idx + 1]
        - rawPixels[idx - W] - rawPixels[idx + W];
      gradSum += lap;
      gradSumSq += lap * lap;
      gradN++;
    }
  }
  const gradMean = gradSum / gradN;
  const blurVariance = gradSumSq / gradN - gradMean * gradMean;
  console.log(`[scan] blur variance: ${blurVariance.toFixed(1)}`);
  if (blurVariance < 250) {
    OpenCV.releaseBuffers([grayMat.id]);
    return { found: false, blurry: true } as any;
  }
  const markResult = findFourMarks(grayMat, rawPixels, W, H);

  if (!markResult.corners) {
    OpenCV.releaseBuffers([grayMat.id]);
    return { found: false };
  }

  const corners = markResult.corners;
  OpenCV.releaseBuffers([grayMat.id]);

  // ── Fold / curvature detection via reprojection error ────────────────────
  // Project detected midpoints through the 4-corner homography into warped space.
  // On FLAT paper all 6 marks are coplanar → residual ≈ 0 (only detection jitter).
  // On CURVED paper midpoints leave the plane → large residual.
  // This cancels perspective, rotation, and scale — only measures actual curvature.
  try {
    if (markResult.midpoints) {
      const [leftMid, rightMid] = markResult.midpoints;

      // Ideal midpoint positions in warped space (center of left/right edges)
      const idealLM: [number, number] = [
        (IDEAL_CORNERS[0][0] + IDEAL_CORNERS[2][0]) / 2,
        (IDEAL_CORNERS[0][1] + IDEAL_CORNERS[2][1]) / 2,
      ];
      const idealRM: [number, number] = [
        (IDEAL_CORNERS[1][0] + IDEAL_CORNERS[3][0]) / 2,
        (IDEAL_CORNERS[1][1] + IDEAL_CORNERS[3][1]) / 2,
      ];

      // Forward perspective: detected image coords → ideal warped coords
      const detFlat = corners.flatMap(([x, y]: [number, number]) => [x, y]);
      const idlFlat = IDEAL_CORNERS.flatMap(([x, y]) => [x, y]);
      const fwdPersp = PerspT(detFlat, idlFlat);

      const errors: number[] = [];
      if (leftMid) {
        const [px, py] = fwdPersp.transform(leftMid[0], leftMid[1]);
        errors.push(Math.sqrt((px - idealLM[0]) ** 2 + (py - idealLM[1]) ** 2));
      }
      if (rightMid) {
        const [px, py] = fwdPersp.transform(rightMid[0], rightMid[1]);
        errors.push(Math.sqrt((px - idealRM[0]) ** 2 + (py - idealRM[1]) ** 2));
      }

      if (errors.length > 0) {
        const maxErr = Math.max(...errors);
        console.log(`[scan] fold reprojection error: ${maxErr.toFixed(1)}px (detected=${errors.length})`);
        // Flat paper: < 5px noise. Curved paper: > 15px typically.
        // Two midpoints: 10px threshold (high confidence).
        // One midpoint: 25px threshold (higher bar since single detection can be noisy).
        const threshold = errors.length >= 2 ? 10 : 25;
        if (maxErr > threshold) {
          return { found: false, folded: true } as any;
        }
      }
    }
  } catch (e) {
    console.warn("[scan] fold check error:", e);
  }



  // Normalize pixel buffer to 0-255 — stabilizes ratios across exposure changes
  let pMin = 255, pMax = 0;
  for (let i = 0; i < rawPixels.length; i++) {
    if (rawPixels[i] < pMin) pMin = rawPixels[i];
    if (rawPixels[i] > pMax) pMax = rawPixels[i];
  }
  const pRange = pMax - pMin || 1;
  const pixels = new Uint8Array(rawPixels.length);
  for (let i = 0; i < rawPixels.length; i++) {
    pixels[i] = Math.round(((rawPixels[i] - pMin) / pRange) * 255);
  }

  // PerspT: map bubble positions from warped sheet coords → original image coords
  const layout = computeGridLayout(questions.length, choiceCount);
  const idealFlat = IDEAL_CORNERS.flatMap(([x, y]) => [x, y]);
  const detectedFlat = corners.flatMap(([x, y]: [number, number]) => [x, y]);
  const invPersp = PerspT(idealFlat, detectedFlat);

  // Scale sampling radii from warped space to original image space
  const rectW = (corners[1][0] - corners[0][0] + corners[3][0] - corners[2][0]) / 2;
  const rectH = (corners[2][1] - corners[0][1] + corners[3][1] - corners[1][1]) / 2;
  const idealW = IDEAL_CORNERS[1][0] - IDEAL_CORNERS[0][0];
  const idealH = IDEAL_CORNERS[2][1] - IDEAL_CORNERS[0][1];
  const radiusScale = Math.min(rectW / idealW, rectH / idealH);
  const adjInnerR = Math.max(3, Math.round(layout.innerR * radiusScale));
  const adjOuterR1 = Math.max(adjInnerR + 1, Math.round(layout.outerR1 * radiusScale));
  const adjOuterR2 = Math.max(adjOuterR1 + 1, Math.round(layout.outerR2 * radiusScale));

  // Sample answer bubbles via PerspT on original pixels.
  // Search a neighborhood around each mapped position to find the actual
  // bubble center — compensates for lens distortion & perspective error
  // (worst at sheet center, farthest from all 4 registration marks).
  // Compute spacing in original image pixels to size the search safely.
  const p00 = layout.bubbleCenter(0, 0);
  const p10 = layout.bubbleCenter(Math.min(1, layout.questionCount - 1), 0);
  const p01 = layout.bubbleCenter(0, Math.min(1, layout.choiceCount - 1));
  const vSpacingOrig = Math.abs(p10.ny - p00.ny) * WARP_H * radiusScale;
  const hSpacingOrig = Math.abs(p01.nx - p00.nx) * WARP_W * radiusScale;
  const minSpacingOrig = Math.min(hSpacingOrig, vSpacingOrig) || 20;
  // Search up to 30% of spacing — wide enough for perspective error, safe from adjacent bubbles
  const maxSafeSearch = Math.floor(minSpacingOrig / 2 - adjInnerR);
  const searchStep = Math.max(2, Math.min(maxSafeSearch, Math.round(minSpacingOrig * 0.30)));
  console.log(`[scan] grid: ${layout.questionCount}Q x ${layout.choiceCount}C, ${layout.questionColumns}col, innerR=${adjInnerR} outerR=${adjOuterR1}-${adjOuterR2} searchStep=${searchStep}px (spacing=${minSpacingOrig.toFixed(1)}px)`);
  const answers: string[] = [];
  const confidence: number[] = [];
  for (let q = 0; q < layout.questionCount; q++) {
    const ratios: number[] = [];
    for (let c = 0; c < layout.choiceCount; c++) {
      const { nx, ny } = layout.bubbleCenter(q, c);
      const [ix, iy] = invPersp.transform(nx * WARP_W, ny * WARP_H);
      // Find darkest spot in neighborhood — handles curvature-induced position drift
      let bestCx = ix, bestCy = iy, darkest = 255;
      for (let dy = -searchStep; dy <= searchStep; dy += searchStep) {
        for (let dx = -searchStep; dx <= searchStep; dx += searchStep) {
          const v = ringMean(pixels, W, H, ix + dx, iy + dy, 0, 2);
          if (v < darkest) { darkest = v; bestCx = ix + dx; bestCy = iy + dy; }
        }
      }
      const inner = ringMean(pixels, W, H, bestCx, bestCy, 0, adjInnerR);
      const outer = ringMean(pixels, W, H, bestCx, bestCy, adjOuterR1, adjOuterR2);
      ratios.push((outer - inner) / Math.max(outer, 64));
    }
    let best = -Infinity, second = -Infinity, bestIdx = 0;
    for (let i = 0; i < ratios.length; i++) {
      if (ratios[i] > best) { second = best; best = ratios[i]; bestIdx = i; }
      else if (ratios[i] > second) { second = ratios[i]; }
    }
    const gap = best - second;
    // Log first 5 questions for diagnostics
    if (q < 5) {
      console.log(`[scan] Q${q + 1}: ratios=[${ratios.map(r => r.toFixed(3)).join(",")}] best=${best.toFixed(3)} 2nd=${second.toFixed(3)} gap=${gap.toFixed(3)}`);
    }
    if (best >= layout.minRatio && second >= 0.15) {
      // Multiple bubbles filled → invalid (always wrong)
      answers.push("?");
      confidence.push(0);
    } else if (best >= layout.minRatio && gap >= layout.minGap) {
      answers.push(layout.letters[bestIdx]);
      confidence.push(Math.min(1, gap / 0.4));
    } else {
      answers.push("?");
      confidence.push(0);
    }
  }

  // Read student ID barcode from the bottom of the sheet (post-capture)
  const studentId = readStudentId(rawPixels, W, H, corners);

  return {
    found: true, answers, confidence, corners, imageSize: [W, H] as [number, number], studentId,
  };
}

/**
 * Generate a debug image: perspective-warped tight crop with colored circles
 * drawn at each bubble position showing detected vs correct answers.
 *
 * Saves the result as a JPEG file at `outputPath`.
 * Caller should convert the file to base64 (e.g. via ImageManipulator).
 */
export function generateDebugImage(
  base64: string,
  corners: [[number, number], [number, number], [number, number], [number, number]],
  answers: string[],
  questions: { correct: string }[],
  choiceCount: 4 | 5,
  outputPath: string,
): void {
  if (!isNativeAvailable()) return;

  // 1. Decode → grayscale
  const bgrMat = OpenCV.base64ToMat(base64);
  const grayMat = OpenCV.createObject(ObjectType.Mat, 1, 1, DataTypes.CV_8UC1);
  OpenCV.invoke("cvtColor", bgrMat, grayMat, ColorConversionCodes.COLOR_BGR2GRAY);
  OpenCV.releaseBuffers([bgrMat.id]);

  // 2. Perspective warp to 800×1125
  const p2f = (x: number, y: number) => OpenCV.createObject(ObjectType.Point2f, x, y);
  const [tl, tr, bl, br] = corners;
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
  const warpedGray = OpenCV.createObject(ObjectType.Mat, 1, 1, DataTypes.CV_8UC1);
  const warpSize = OpenCV.createObject(ObjectType.Size, WARP_W, WARP_H);
  const borderVal = OpenCV.createObject(ObjectType.Scalar, 0);
  OpenCV.invoke(
    "warpPerspective", grayMat, warpedGray, M, warpSize,
    InterpolationFlags.INTER_LINEAR, BorderTypes.BORDER_CONSTANT, borderVal,
  );
  OpenCV.releaseBuffers([grayMat.id, srcPts.id, dstPts.id, M.id, warpSize.id, borderVal.id]);

  // 3. Gray → BGR for colored drawing
  const colorMat = OpenCV.createObject(ObjectType.Mat, 1, 1, DataTypes.CV_8UC3);
  OpenCV.invoke("cvtColor", warpedGray, colorMat, ColorConversionCodes.COLOR_GRAY2BGR);
  OpenCV.releaseBuffers([warpedGray.id]);

  // 4. Draw circles at bubble positions
  const layout = computeGridLayout(questions.length, choiceCount);
  const radius = Math.max(6, layout.outerR1);

  const green = OpenCV.createObject(ObjectType.Scalar, 0, 200, 0);
  const red = OpenCV.createObject(ObjectType.Scalar, 0, 0, 220);
  const gray = OpenCV.createObject(ObjectType.Scalar, 140, 140, 140);

  for (let q = 0; q < layout.questionCount; q++) {
    const detected = answers[q] ?? "?";
    for (let c = 0; c < layout.choiceCount; c++) {
      const letter = layout.letters[c];
      const { nx, ny } = layout.bubbleCenter(q, c);
      const cx = Math.round(nx * WARP_W);
      const cy = Math.round(ny * WARP_H);
      const center = OpenCV.createObject(ObjectType.Point, cx, cy);

      if (letter === detected) {
        const isCorrect = detected === questions[q]?.correct;
        OpenCV.invoke("circle", colorMat, center, radius, isCorrect ? green : red, -1, LineTypes.LINE_8);
      } else {
        OpenCV.invoke("circle", colorMat, center, radius, gray, 2, LineTypes.LINE_8);
      }
      OpenCV.releaseBuffers([center.id]);
    }
  }

  OpenCV.releaseBuffers([green.id, red.id, gray.id]);

  // 5. Save to file
  OpenCV.saveMatToFile(colorMat, outputPath, "jpeg", 0.8);
  OpenCV.releaseBuffers([colorMat.id]);
}

export { PerspT }; // re-export for results overlay
