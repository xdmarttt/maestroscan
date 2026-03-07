import sharp from "sharp";
// @ts-ignore — no type definitions for this package
import PerspT from "perspective-transform";
import { computeGridLayout, SHEET_W, SHEET_H, WARP_W, WARP_H } from "../lib/grid-layout";

// Registration mark corners in NORMALIZED sheet coordinates (0–1)
const REG_NORM = {
  TL: [19.6 / SHEET_W, 28 / SHEET_H] as [number, number],
  TR: [300.4 / SHEET_W, 28 / SHEET_H] as [number, number],
  BL: [19.6 / SHEET_W, 422 / SHEET_H] as [number, number],
  BR: [300.4 / SHEET_W, 422 / SHEET_H] as [number, number],
};

const FILL_THRESHOLD = 128; // brightness below this = filled bubble

export interface ScanResult {
  answers: string[];
  confidence: number[];
  debugInfo: {
    corners: [number, number][];
    bubbleBrightness: number[][];
    imageSize: [number, number];
  };
}

export interface DetectResult {
  found: boolean;
  corners?: [number, number][];
}

export async function detectSheet(imageBase64: string): Promise<DetectResult> {
  try {
    const buf = Buffer.from(imageBase64, "base64");
    // .rotate() with no args auto-rotates based on EXIF orientation (iPhone stores portrait as sideways)
    // No normalize — need absolute brightness values
    const { data: pixels, info } = await sharp(buf)
      .rotate()
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const W = info.width;
    const H = info.height;
    const px = pixels as unknown as Uint8Array;

    // ── Check 1: Centre of frame must be bright white ────────────────────────
    // A paper sheet fills the frame; its interior (where bubbles are) is white.
    // A random room scene won't have a uniformly bright white centre.
    const cW = Math.round(W * 0.28);
    const cH = Math.round(H * 0.28);
    const centerBright = sampleRect(px, W, H, (W - cW) / 2, (H - cH) / 2, cW, cH, 4);
    if (centerBright < 165) {
      console.log("[detect] rejected: centre too dark", Math.round(centerBright));
      return { found: false };
    }

    // ── Find the 4 darkest corner regions ───────────────────────────────────
    const corners = findRegistrationMarks(px, W, H);
    const [tl, tr, bl, br] = corners;

    // ── Check 2: Each mark must be dark + surrounded by bright white paper ───
    const WIN = Math.round(W * 0.055);
    const OUTER = Math.round(W * 0.14);
    const markBrightnesses: number[] = [];
    for (const [cx, cy] of corners) {
      const markBright = sampleRect(px, W, H, cx - WIN / 2, cy - WIN / 2, WIN, WIN, 2);
      const outerBright = sampleRect(px, W, H, cx - OUTER / 2, cy - OUTER / 2, OUTER, OUTER, 4);
      if (markBright > 50 || outerBright < 150 || outerBright / markBright < 3.5) {
        console.log("[detect] rejected: mark check", Math.round(markBright), Math.round(outerBright));
        return { found: false };
      }
      markBrightnesses.push(markBright);
    }

    // ── Check 3: All 4 marks must be similar brightness (same black ink) ─────
    // Real registration marks are identical black squares printed on paper.
    // Random dark objects in a room have very different brightness values.
    const markMin = Math.min(...markBrightnesses);
    const markMax = Math.max(...markBrightnesses);
    if (markMax - markMin > 30) {
      console.log("[detect] rejected: marks not uniform", markBrightnesses.map(Math.round));
      return { found: false };
    }

    // ── Check 4: Geometric spread ────────────────────────────────────────────
    const spreadX = Math.min(tr[0] - tl[0], br[0] - bl[0]);
    const spreadY = Math.min(bl[1] - tl[1], br[1] - tr[1]);
    if (spreadX < W * 0.35 || spreadY < H * 0.35) {
      console.log("[detect] rejected: spread too small", Math.round(spreadX), Math.round(spreadY));
      return { found: false };
    }

    // ── Check 5: Aspect ratio ≈ 1.4 portrait (320×450 sheet) ─────────────────
    const rectW = (tr[0] - tl[0] + br[0] - bl[0]) / 2;
    const rectH = (bl[1] - tl[1] + br[1] - tr[1]) / 2;
    const aspect = rectH / rectW;
    if (aspect < 1.0 || aspect > 1.8) {
      console.log("[detect] rejected: aspect ratio", aspect.toFixed(2));
      return { found: false };
    }

    // ── Check 6: Corner order must be geometrically consistent ───────────────
    if (tl[0] >= tr[0] || bl[0] >= br[0] || tl[1] >= bl[1] || tr[1] >= br[1]) {
      console.log("[detect] rejected: corner order wrong");
      return { found: false };
    }

    console.log("[detect] FOUND  centre:", Math.round(centerBright), "aspect:", aspect.toFixed(2), "markRange:", markMin.toFixed(0), "-", markMax.toFixed(0));
    return { found: true, corners };
  } catch {
    return { found: false };
  }
}

export async function processAnswerSheet(
  imageBase64: string,
  questionCount: number = 5,
  choiceCount: 4 | 5 = 4,
): Promise<ScanResult> {
  // 1. Load image as grayscale with contrast stretch
  // .rotate() auto-corrects EXIF orientation (iPhone portrait photos are stored sideways)
  const buf = Buffer.from(imageBase64, "base64");
  const { data: pixels, info } = await sharp(buf)
    .rotate()
    .grayscale()
    .normalize() // stretch contrast so marks are darker
    .raw()
    .toBuffer({ resolveWithObject: true });

  const W = info.width;
  const H = info.height;

  // 2. Find 4 registration marks
  const corners = findRegistrationMarks(pixels as unknown as Uint8Array, W, H);

  // 3. Build perspective transform:
  //    srcPts = ideal mark positions in warped output space
  //    dstPts = detected mark positions in the actual photo
  //    transformInverse(wx, wy) → (sx, sy) in actual photo
  const srcPts = [
    REG_NORM.TL[0] * WARP_W,
    REG_NORM.TL[1] * WARP_H,
    REG_NORM.TR[0] * WARP_W,
    REG_NORM.TR[1] * WARP_H,
    REG_NORM.BL[0] * WARP_W,
    REG_NORM.BL[1] * WARP_H,
    REG_NORM.BR[0] * WARP_W,
    REG_NORM.BR[1] * WARP_H,
  ];
  const dstPts = [
    ...corners[0], // TL in photo
    ...corners[1], // TR in photo
    ...corners[2], // BL in photo
    ...corners[3], // BR in photo
  ];

  const perspT = PerspT(srcPts, dstPts);

  // 4. Sample each bubble using dynamic layout
  const layout = computeGridLayout(questionCount, choiceCount);
  const bubbleBrightness: number[][] = [];
  const answers: string[] = [];
  const confidence: number[] = [];

  for (let q = 0; q < layout.questionCount; q++) {
    bubbleBrightness[q] = [];

    for (let c = 0; c < layout.choiceCount; c++) {
      const { nx, ny } = layout.bubbleCenter(q, c);
      const wx = nx * WARP_W;
      const wy = ny * WARP_H;

      const [sx, sy] = perspT.transform(wx, wy);
      bubbleBrightness[q][c] = sampleCircle(
        pixels as unknown as Uint8Array,
        W,
        H,
        sx,
        sy,
        layout.innerR
      );
    }

    const row_b = bubbleBrightness[q];
    const sorted = [...row_b].sort((a, b) => a - b);
    const minBrightness = sorted[0];
    const secondMin = sorted[1] ?? 255;
    const minIdx = row_b.indexOf(minBrightness);

    if (minBrightness < FILL_THRESHOLD) {
      answers.push(layout.letters[minIdx]);
      confidence.push(Math.min(1, (secondMin - minBrightness) / 80));
    } else {
      answers.push("?");
      confidence.push(0);
    }
  }

  console.log("[scan] corners:", corners.map(([x,y]) => `(${Math.round(x)},${Math.round(y)})`).join(" "));
  console.log("[scan] brightness:", bubbleBrightness.map((row, i) =>
    `Q${i+1}: ${row.map(v => Math.round(v)).join(" ")}`
  ).join("  "));

  return { answers, confidence, debugInfo: { corners, bubbleBrightness, imageSize: [W, H] } };
}

function findRegistrationMarks(
  pixels: Uint8Array,
  W: number,
  H: number
): [number, number][] {
  // Search each corner quadrant for the darkest rectangular region (the mark).
  // Start 2% away from the absolute edge — this prevents dark table/bezel edges
  // at pixel-0 from being mistaken for registration marks.
  const quadrants = [
    { x0: W * 0.02, y0: H * 0.02, x1: W * 0.28, y1: H * 0.28 }, // TL
    { x0: W * 0.72, y0: H * 0.02, x1: W * 0.98, y1: H * 0.28 }, // TR
    { x0: W * 0.02, y0: H * 0.72, x1: W * 0.28, y1: H * 0.98 }, // BL
    { x0: W * 0.72, y0: H * 0.72, x1: W * 0.98, y1: H * 0.98 }, // BR
  ];

  // Dynamic window size: the mark is ~20/320 of the sheet width.
  // If the sheet fills ~85% of the frame, the mark scales to ~800 * 0.85 * (20/320) ≈ 42px
  const WIN = Math.round(W * 0.055); // ~5.5% of image width
  const STEP = Math.max(1, Math.round(WIN / 6));

  return quadrants.map((q) => {
    let bestX = (q.x0 + q.x1) / 2;
    let bestY = (q.y0 + q.y1) / 2;
    let bestScore = Infinity;

    // Coarse scan
    for (let y = q.y0; y < q.y1 - WIN; y += STEP) {
      for (let x = q.x0; x < q.x1 - WIN; x += STEP) {
        const avg = sampleRect(pixels, W, H, x, y, WIN, WIN, 4);
        if (avg < bestScore) {
          bestScore = avg;
          bestX = x + WIN / 2;
          bestY = y + WIN / 2;
        }
      }
    }

    // Fine scan: ±WIN/2 around coarse result, 1px step
    const fineRange = WIN;
    let fineScore = bestScore;
    let fineX = bestX;
    let fineY = bestY;

    for (let y = bestY - fineRange; y < bestY + fineRange; y += 1) {
      for (let x = bestX - fineRange; x < bestX + fineRange; x += 1) {
        const avg = sampleRect(pixels, W, H, x - WIN / 2, y - WIN / 2, WIN, WIN, 2);
        if (avg < fineScore) {
          fineScore = avg;
          fineX = x;
          fineY = y;
        }
      }
    }

    return [fineX, fineY] as [number, number];
  });
}

function sampleRect(
  pixels: Uint8Array,
  W: number,
  H: number,
  x: number,
  y: number,
  w: number,
  h: number,
  step: number
): number {
  let sum = 0;
  let count = 0;
  for (let dy = 0; dy < h; dy += step) {
    for (let dx = 0; dx < w; dx += step) {
      const px = Math.max(0, Math.min(W - 1, Math.round(x + dx)));
      const py = Math.max(0, Math.min(H - 1, Math.round(y + dy)));
      sum += pixels[py * W + px];
      count++;
    }
  }
  return count > 0 ? sum / count : 255;
}

function sampleCircle(
  pixels: Uint8Array,
  W: number,
  H: number,
  cx: number,
  cy: number,
  radius: number
): number {
  let sum = 0;
  let count = 0;
  const r2 = radius * radius;

  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy <= r2) {
        const px = Math.max(0, Math.min(W - 1, Math.round(cx + dx)));
        const py = Math.max(0, Math.min(H - 1, Math.round(cy + dy)));
        sum += pixels[py * W + px];
        count++;
      }
    }
  }

  return count > 0 ? sum / count : 255;
}
