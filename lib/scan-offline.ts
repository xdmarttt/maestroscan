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
import jsQR from "jsqr";
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
  const kernel = OpenCV.invoke(
    "getStructuringElement",
    MorphShapes.MORPH_RECT,
    OpenCV.createObject(ObjectType.Size, 3, 3)
  );
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

/**
 * Find 4 corner registration marks.
 * Downscales large images for speed and better threshold behavior,
 * then maps results back to original coordinates.
 * Returns [TL, TR, BL, BR] or null.
 */
function findFourMarks(
  grayMat: ReturnType<typeof OpenCV.createObject>,
  pixels: Uint8Array,
  W: number,
  H: number
): [[number, number], [number, number], [number, number], [number, number]] | null {
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

  if (candidates.length < 4) return null;

  // Scale candidates back to original image coordinates
  if (needScale) {
    const invScale = 1 / scale;
    for (const c of candidates) {
      c.cx *= invScale;
      c.cy *= invScale;
    }
  }

  // One darkest candidate per quadrant (using original-resolution pixels)
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

  // Geometric validation
  const rectW = (tr[0] - tl[0] + br[0] - bl[0]) / 2;
  const rectH = (bl[1] - tl[1] + br[1] - tr[1]) / 2;
  if (rectW < W * 0.10 || rectH < H * 0.10) return null;

  const aspect = rectH / (rectW + 1e-6);
  if (aspect < 0.5 || aspect > 4.0) return null;

  if (tl[0] >= tr[0] || bl[0] >= br[0] || tl[1] >= bl[1] || tr[1] >= br[1]) return null;

  return [tl, tr, bl, br];
}

// ── QR code decoding ─────────────────────────────────────────────────────────

// QR scan region in normalized sheet coordinates (top-right area)
// Covers QR at header bar area: ~x=0.65-0.90, y=0.09-0.20 on 320×450 sheet
const QR_NX0 = 0.60;
const QR_NX1 = 0.95;
const QR_NY0 = 0.06;
const QR_NY1 = 0.24;

/**
 * Decode a QR code from the top-right region of the detected sheet.
 * Uses PerspT inverse mapping to produce a RECTIFIED (perspective-corrected)
 * image of the QR region — same technique as bubble sampling.
 * Returns parsed { quizId, studentName } or null.
 */
function decodeSheetQR(
  pixels: Uint8Array,
  W: number,
  H: number,
  corners: [[number, number], [number, number], [number, number], [number, number]],
): { quizId: string; studentName: string } | null {
  try {
    const idealFlat = IDEAL_CORNERS.flatMap(([x, y]) => [x, y]);
    const detectedFlat = corners.flatMap(([x, y]) => [x, y]);
    const invPersp = PerspT(idealFlat, detectedFlat);

    // Rectified output size — subsample by 2 to keep transform count low
    // (~14K transforms instead of ~57K, still enough resolution for jsQR)
    const SUB = 2;
    const outW = Math.round((QR_NX1 - QR_NX0) * WARP_W / SUB);
    const outH = Math.round((QR_NY1 - QR_NY0) * WARP_H / SUB);
    if (outW < 10 || outH < 10) return null;

    // Sample rectified QR region: for each output pixel, map through
    // inverse perspective to get the original image coordinate
    const gray = new Uint8Array(outW * outH);
    const wxBase = QR_NX0 * WARP_W;
    const wyBase = QR_NY0 * WARP_H;

    for (let y = 0; y < outH; y++) {
      for (let x = 0; x < outW; x++) {
        const [ix, iy] = invPersp.transform(wxBase + x * SUB, wyBase + y * SUB);
        const px = Math.round(ix);
        const py = Math.round(iy);
        gray[y * outW + x] =
          px >= 0 && px < W && py >= 0 && py < H
            ? pixels[py * W + px]
            : 255;
      }
    }

    // Normalize contrast: stretch min/max to 0-255
    let gMin = 255, gMax = 0;
    for (let i = 0; i < gray.length; i++) {
      if (gray[i] < gMin) gMin = gray[i];
      if (gray[i] > gMax) gMax = gray[i];
    }
    const gRange = gMax - gMin || 1;

    // Convert to RGBA with contrast normalization (jsQR needs Uint8ClampedArray RGBA)
    const rgba = new Uint8ClampedArray(outW * outH * 4);
    for (let i = 0; i < gray.length; i++) {
      const v = Math.round(((gray[i] - gMin) / gRange) * 255);
      const j = i * 4;
      rgba[j] = v;
      rgba[j + 1] = v;
      rgba[j + 2] = v;
      rgba[j + 3] = 255;
    }

    const result = jsQR(rgba, outW, outH);
    console.log(`[QR] rectified=${outW}x${outH} decoded=${result?.data ?? 'null'}`);
    if (!result?.data) return null;

    // Parse GS:<quizId>:<studentName>
    const parts = result.data.split(":");
    if (parts.length >= 3 && parts[0] === "GS") {
      console.log(`[QR] student=${parts.slice(2).join(":")}`);
      return { quizId: parts[1], studentName: parts.slice(2).join(":") };
    }
    return null;
  } catch (e) {
    console.warn('[QR] decode error:', e);
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
): Promise<{ found: false } | { found: true; answers: string[]; confidence: number[]; corners: [number, number][]; imageSize: [number, number]; studentName?: string; quizId?: string }> {
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

  // Single OpenCV session: decode → gray → detect → sample
  const bgrMat = OpenCV.base64ToMat(base64);
  const grayMat = OpenCV.createObject(ObjectType.Mat, 1, 1, DataTypes.CV_8UC1);
  OpenCV.invoke("cvtColor", bgrMat, grayMat, ColorConversionCodes.COLOR_BGR2GRAY);
  OpenCV.releaseBuffers([bgrMat.id]);

  const { cols: W, rows: H, buffer: rawPixels } = OpenCV.matToBuffer(grayMat, "uint8");
  const corners = findFourMarks(grayMat, rawPixels, W, H);

  if (!corners) {
    OpenCV.releaseBuffers([grayMat.id]);
    return { found: false };
  }

  OpenCV.releaseBuffers([grayMat.id]);

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

  // Decode QR code from sheet (non-blocking, returns null if no QR)
  const qrResult = decodeSheetQR(pixels, W, H, corners);

  // Use PerspT to map bubble positions from warped space → original image space.
  const layout = computeGridLayout(questions.length, choiceCount);

  // Inverse perspective: warped sheet coords → original image coords
  const idealFlat = IDEAL_CORNERS.flatMap(([x, y]) => [x, y]);
  const detectedFlat = corners.flatMap(([x, y]) => [x, y]);
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

  const answers: string[] = [];
  const confidence: number[] = [];
  for (let q = 0; q < layout.questionCount; q++) {
    const ratios: number[] = [];
    for (let c = 0; c < layout.choiceCount; c++) {
      const { nx, ny } = layout.bubbleCenter(q, c);
      const [ix, iy] = invPersp.transform(nx * WARP_W, ny * WARP_H);
      const inner = ringMean(pixels, W, H, ix, iy, 0, adjInnerR);
      const outer = ringMean(pixels, W, H, ix, iy, adjOuterR1, adjOuterR2);
      ratios.push((outer - inner) / Math.max(outer, 64));
    }
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

  return {
    found: true, answers, confidence, corners, imageSize: [W, H] as [number, number],
    ...(qrResult ? { studentName: qrResult.studentName, quizId: qrResult.quizId } : {}),
  };
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
