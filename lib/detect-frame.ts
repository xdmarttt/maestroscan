/**
 * detect-frame.ts
 *
 * Worklet-compatible corner detection for VisionCamera frame processors.
 * Runs entirely on the frame processor thread — no JS thread roundtrip needed.
 *
 * This is a self-contained version of the corner detection from scan-offline.ts,
 * designed to work in a 'worklet' context with react-native-fast-opencv JSI calls.
 */

import {
  OpenCV,
  ObjectType,
  DataTypes,
  ColorConversionCodes,
  AdaptiveThresholdTypes,
  ThresholdTypes,
  MorphTypes,
  MorphShapes,
  RetrievalModes,
  ContourApproximationModes,
} from "react-native-fast-opencv";

export interface DetectionResult {
  /** All 4 corners found and geometry valid */
  found: boolean;
  /** Per-corner [x,y] in image coords (even if not all found) */
  partial: ([number, number] | null)[];
  /** Image dimensions */
  W: number;
  H: number;
}

/**
 * Detect 4 corner registration marks from a resized camera frame buffer.
 * Called from within a VisionCamera frame processor (worklet context).
 *
 * @param frameBuffer - Raw pixel buffer from vision-camera-resize-plugin
 * @param width - Width of the resized frame
 * @param height - Height of the resized frame
 * @param channels - Number of channels (3 for BGR)
 */
export function detectCornersFromFrame(
  frameBuffer: any,
  width: number,
  height: number,
  channels: number,
): DetectionResult {
  "worklet";

  const noResult: DetectionResult = { found: false, partial: [null, null, null, null], W: width, H: height };

  // Convert frame buffer → Mat → grayscale
  const src = OpenCV.frameBufferToMat(height, width, channels, frameBuffer);
  const gray = OpenCV.createObject(ObjectType.Mat, 0, 0, DataTypes.CV_8U);
  OpenCV.invoke("cvtColor", src, gray, ColorConversionCodes.COLOR_BGR2GRAY);
  OpenCV.releaseBuffers([src.id]);

  // Get pixel buffer for ringMean checks later
  const { buffer: pixels, cols: W, rows: H } = OpenCV.matToBuffer(gray, "uint8");

  // Blur for noise reduction
  const blurred = OpenCV.createObject(ObjectType.Mat, 0, 0, DataTypes.CV_8U);
  const ksize = OpenCV.createObject(ObjectType.Size, 5, 5);
  OpenCV.invoke("GaussianBlur", gray, blurred, ksize, 0);
  OpenCV.releaseBuffers([ksize.id]);

  // --- Find mark candidates using two threshold strategies ---
  const minArea = (W * 0.008) ** 2;
  const maxArea = (W * 0.15) ** 2;
  const candidates: { cx: number; cy: number; area: number }[] = [];

  // Strategy 1: Adaptive threshold
  const bsz = Math.max(15, Math.round(W * 0.10) | 1);
  const adaptBin = OpenCV.createObject(ObjectType.Mat, 0, 0, DataTypes.CV_8UC1);
  OpenCV.invoke(
    "adaptiveThreshold", blurred, adaptBin, 255,
    AdaptiveThresholdTypes.ADAPTIVE_THRESH_GAUSSIAN_C,
    ThresholdTypes.THRESH_BINARY_INV, bsz, 12,
  );
  collectCandidates(adaptBin, minArea, maxArea, candidates);
  OpenCV.releaseBuffers([adaptBin.id]);

  // Strategy 2: Fixed low threshold
  const fixedBin = OpenCV.createObject(ObjectType.Mat, 0, 0, DataTypes.CV_8UC1);
  OpenCV.invoke("threshold", blurred, fixedBin, 80, 255, ThresholdTypes.THRESH_BINARY_INV);
  collectCandidates(fixedBin, minArea, maxArea, candidates);
  OpenCV.releaseBuffers([fixedBin.id, blurred.id]);

  if (candidates.length < 4) {
    OpenCV.releaseBuffers([gray.id]);
    return noResult;
  }

  // Filter small candidates (keep >= 40% of largest)
  const maxCandArea = Math.max(...candidates.map((c) => c.area));
  const filtered = candidates.filter((c) => c.area >= maxCandArea * 0.4);
  if (filtered.length < 4) {
    OpenCV.releaseBuffers([gray.id]);
    return noResult;
  }

  // --- Pick one darkest candidate per quadrant ---
  const quads = [
    { nx0: 0.0, nx1: 0.55, ny0: 0.0, ny1: 0.55 }, // TL
    { nx0: 0.45, nx1: 1.0, ny0: 0.0, ny1: 0.55 }, // TR
    { nx0: 0.0, nx1: 0.55, ny0: 0.45, ny1: 1.0 }, // BL
    { nx0: 0.45, nx1: 1.0, ny0: 0.45, ny1: 1.0 }, // BR
  ];

  const partial: ([number, number] | null)[] = [];
  const cornerDarkness: number[] = [];

  for (const { nx0, nx1, ny0, ny1 } of quads) {
    const inQ = filtered.filter(
      (c) => c.cx >= nx0 * W && c.cx < nx1 * W && c.cy >= ny0 * H && c.cy < ny1 * H,
    );
    if (inQ.length === 0) { partial.push(null); cornerDarkness.push(999); continue; }

    const darkEnough = inQ.filter(
      (c) => ringMeanWorklet(pixels, W, H, c.cx, c.cy, 0, 8) < 190,
    );
    if (darkEnough.length === 0) { partial.push(null); cornerDarkness.push(999); continue; }

    const best = darkEnough.reduce((a, b) => (b.area > a.area ? b : a));
    const bestDark = ringMeanWorklet(pixels, W, H, best.cx, best.cy, 0, 8);
    partial.push([best.cx, best.cy]);
    cornerDarkness.push(bestDark);
  }

  OpenCV.releaseBuffers([gray.id]);

  // Need all 4 for geometric validation
  if (partial.some((c) => c === null)) return { found: false, partial, W, H };

  // All 4 must be genuinely dark
  for (const d of cornerDarkness) {
    if (d > 190) return { found: false, partial, W, H };
  }

  const [tl, tr, bl, br] = partial as [[number, number], [number, number], [number, number], [number, number]];

  // Geometric validation
  const rectW = (tr[0] - tl[0] + br[0] - bl[0]) / 2;
  const rectH = (bl[1] - tl[1] + br[1] - tr[1]) / 2;
  if (rectW < W * 0.10 || rectH < H * 0.10) return { found: false, partial, W, H };

  const aspect = rectH / (rectW + 1e-6);
  if (aspect < 0.5 || aspect > 3.0) return { found: false, partial, W, H };
  if (tl[0] >= tr[0] || bl[0] >= br[0] || tl[1] >= bl[1] || tr[1] >= br[1]) return { found: false, partial, W, H };

  // Parallel-sides check
  const topW = tr[0] - tl[0];
  const botW = br[0] - bl[0];
  const leftH = bl[1] - tl[1];
  const rightH = br[1] - tr[1];
  if (topW / botW < 0.3 || topW / botW > 3.0) return { found: false, partial, W, H };
  if (leftH / rightH < 0.3 || leftH / rightH > 3.0) return { found: false, partial, W, H };

  // Contrast check
  const centerX = (tl[0] + tr[0] + bl[0] + br[0]) / 4;
  const centerY = (tl[1] + tr[1] + bl[1] + br[1]) / 4;
  const centerBright = ringMeanWorklet(pixels, W, H, centerX, centerY, 0, 16);
  const avgCornerDark = cornerDarkness.reduce((a, b) => a + b, 0) / 4;
  if (centerBright - avgCornerDark < 25) return { found: false, partial, W, H };

  return { found: true, partial, W, H };
}

// --- Helpers (inlined for worklet compatibility) ---

function ringMeanWorklet(
  pixels: Uint8Array, W: number, H: number,
  cx: number, cy: number, rInner: number, rOuter: number,
): number {
  "worklet";
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

function collectCandidates(
  binary: any, minArea: number, maxArea: number,
  candidates: { cx: number; cy: number; area: number }[],
): void {
  "worklet";

  // Morph OPEN: break thin connections
  const kernel = OpenCV.invoke(
    "getStructuringElement",
    MorphShapes.MORPH_RECT,
    OpenCV.createObject(ObjectType.Size, 3, 3),
  );
  OpenCV.invoke("morphologyEx", binary, binary, MorphTypes.MORPH_OPEN, kernel);

  const contours = OpenCV.createObject(ObjectType.MatVector);
  OpenCV.invoke(
    "findContours", binary, contours,
    RetrievalModes.RETR_EXTERNAL,
    ContourApproximationModes.CHAIN_APPROX_SIMPLE,
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
    if (Math.min(bw, bh) / Math.max(bw, bh) < 0.5) continue;
    if (area / (bw * bh) < 0.65) continue;

    const cx = x + bw / 2;
    const cy = y + bh / 2;

    // Dedup
    const isDup = candidates.some(
      (e) => Math.abs(e.cx - cx) < bw && Math.abs(e.cy - cy) < bh,
    );
    if (!isDup) candidates.push({ cx, cy, area });
  }

  OpenCV.releaseBuffers([kernel.id, contours.id]);
}
