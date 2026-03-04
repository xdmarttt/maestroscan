#!/usr/bin/env python3
"""
GradeSnap scan service — FastAPI + OpenCV.
Run: python3 -m uvicorn scan_service:app --reload --port 5002
"""

import base64
import io
import traceback
from typing import Optional

import cv2
import numpy as np
import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image, ImageOps
from pydantic import BaseModel

# ── Constants (must match app/sheet.tsx) ──────────────────────────────────────
SHEET_W, SHEET_H = 320, 450
WARP_W, WARP_H = 800, 1125  # preserves 320:450 aspect ratio

# Registration mark centers in NORMALIZED sheet coordinates.
# Each mark is a 20×20 black square; centers (px on 320×450 sheet):
#   TL=(19.6, 28)  TR=(300.4, 28)  BL=(19.6, 422)  BR=(300.4, 422)
REG_NORM = {
    "TL": (19.6 / SHEET_W, 28.0 / SHEET_H),
    "TR": (300.4 / SHEET_W, 28.0 / SHEET_H),
    "BL": (19.6 / SHEET_W, 422.0 / SHEET_H),
    "BR": (300.4 / SHEET_W, 422.0 / SHEET_H),
}

GRID_ROWS, GRID_COLS = 5, 4
LETTERS = ["A", "B", "C", "D"]
SAMPLE_RADIUS = 22         # px in warped space (bubble interior radius ≈ 27px)
MIN_FILL_GAP = 15          # filled bubble must be ≥ this darker than 2nd darkest in row

# ── FastAPI setup ──────────────────────────────────────────────────────────────
app = FastAPI()
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"]
)


class DetectRequest(BaseModel):
    imageBase64: str


class ScanRequest(BaseModel):
    imageBase64: str
    questions: list


# ── Image helpers ──────────────────────────────────────────────────────────────

def decode_gray(image_base64: str) -> np.ndarray:
    """Decode base64 image, apply EXIF rotation, return grayscale uint8 ndarray."""
    buf = base64.b64decode(image_base64)
    pil_img = Image.open(io.BytesIO(buf))
    pil_img = ImageOps.exif_transpose(pil_img)
    return np.array(pil_img.convert("L"), dtype=np.uint8)


def _ring_mean(gray: np.ndarray, icx: int, icy: int,
               r_inner: float, r_outer: float) -> float:
    """Mean brightness of pixels in the annulus between r_inner and r_outer."""
    H, W = gray.shape
    ri, ro = int(r_inner), int(r_outer)
    y0, y1 = max(0, icy - ro), min(H, icy + ro + 1)
    x0, x1 = max(0, icx - ro), min(W, icx + ro + 1)
    if y1 <= y0 or x1 <= x0:
        return 200.0
    patch = gray[y0:y1, x0:x1].astype(np.float32)
    ys = np.arange(y0 - icy, y1 - icy).reshape(-1, 1)
    xs = np.arange(x0 - icx, x1 - icx).reshape(1, -1)
    dsq = xs * xs + ys * ys
    mask = (dsq >= r_inner * r_inner) & (dsq <= r_outer * r_outer)
    vals = patch[mask]
    return float(vals.mean()) if vals.size > 0 else 200.0


def _ring_bright(gray: np.ndarray, icx: int, icy: int,
                 r_inner: float, r_outer: float, pct: float = 80.0) -> float:
    """
    Mean of the BRIGHTEST pct% of pixels in the annulus.

    Using the bright percentile rather than the raw mean makes the outer
    reference more robust: shadows, row labels, or any dark element that
    happens to fall in the outer ring are excluded, so the reference always
    reflects the true white-paper brightness around the bubble.
    """
    H, W = gray.shape
    ro = int(r_outer)
    y0, y1 = max(0, icy - ro), min(H, icy + ro + 1)
    x0, x1 = max(0, icx - ro), min(W, icx + ro + 1)
    if y1 <= y0 or x1 <= x0:
        return 200.0
    patch = gray[y0:y1, x0:x1].astype(np.float32)
    ys = np.arange(y0 - icy, y1 - icy).reshape(-1, 1)
    xs = np.arange(x0 - icx, x1 - icx).reshape(1, -1)
    dsq = xs * xs + ys * ys
    mask = (dsq >= r_inner * r_inner) & (dsq <= r_outer * r_outer)
    vals = patch[mask]
    if vals.size == 0:
        return 200.0
    cutoff = np.percentile(vals, 100.0 - pct)
    bright = vals[vals >= cutoff]
    return float(bright.mean()) if bright.size > 0 else float(vals.mean())


def fill_signal(gray: np.ndarray, cx: float, cy: float) -> float:
    """
    Self-normalising fill score for a single bubble.

    Compares the brightness INSIDE the bubble to the white paper just OUTSIDE it.
    The score is outer_brightness - inner_brightness:
      ~0        → empty bubble (interior ≈ white paper)
      large (+) → filled bubble (interior is dark, paper outside is bright)

    No global threshold is needed — works for screen, printed paper, pencil, pen,
    any lighting level.

    In warped space (800×1125), bubble radius ≈ 27px, border ≈ 4px:
      inner samples radius 0–18 px  (safely inside the bubble interior)
      outer samples radius 32–44 px (white paper outside the bubble)
      Column spacing = 120 px → outer rings never overlap adjacent bubbles ✓
    """
    INNER_R  = 18   # inside the bubble
    OUTER_R1 = 32   # inner edge of paper annulus (just past bubble border)
    OUTER_R2 = 44   # outer edge of paper annulus
    icx, icy = int(round(cx)), int(round(cy))
    inner = _ring_mean(gray, icx, icy, 0, INNER_R)
    outer = _ring_mean(gray, icx, icy, OUTER_R1, OUTER_R2)
    return outer - inner   # 0 = empty, high = filled


# ── Registration mark detection ────────────────────────────────────────────────

def find_four_marks_strict(
    gray: np.ndarray,
) -> Optional[list[tuple[float, float]]]:
    """
    Find 4 registration marks using adaptive thresholding + contour detection.
    Works like QR code scanning: adaptive threshold handles any lighting,
    printed paper, or screen display without needing absolute brightness values.
    Returns [TL, TR, BL, BR] or None.
    """
    H, W = gray.shape

    # ── Denoise (reduces JPEG artifacts) ──────────────────────────────────────
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)

    # ── Adaptive threshold ────────────────────────────────────────────────────
    # Block size must be larger than the mark so the mark is judged relative
    # to its surroundings (same principle as QR code decoders).
    # Marks are ~6% of sheet width; block = ~3× that.
    bsz = max(31, round(W * 0.18) | 1)   # must be odd
    thresh = cv2.adaptiveThreshold(
        blurred, 255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV,
        bsz, 10
    )

    # ── Close gaps (JPEG compression / screen anti-aliasing) ─────────────────
    # 5×5 kernel fills interior holes that JPEG leaves inside black marks.
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
    thresh = cv2.morphologyEx(thresh, cv2.MORPH_CLOSE, kernel)

    # ── Find + filter contours ─────────────────────────────────────────────────
    contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    # Marks are ≈6% of sheet width in the photo.
    # Accept a wide range to handle distance variation (1% – 18% of image width).
    min_area = (W * 0.010) ** 2
    max_area = (W * 0.180) ** 2

    cands: list[tuple[float, float, float]] = []   # (cx, cy, area)
    for cnt in contours:
        area = cv2.contourArea(cnt)
        if not (min_area <= area <= max_area):
            continue
        x, y, bw, bh = cv2.boundingRect(cnt)
        if bw < 2 or bh < 2:
            continue
        # Must be roughly square (allow perspective distortion ~2:1 max)
        squareness = min(bw, bh) / max(bw, bh)
        if squareness < 0.45:
            continue
        # Must be mostly filled (solid square, not a circle outline)
        solidity = area / (bw * bh)
        if solidity < 0.40:
            continue
        # Moments-based centroid is more accurate than bounding-box centre
        M_cnt = cv2.moments(cnt)
        if M_cnt["m00"] < 1:
            continue
        cx = M_cnt["m10"] / M_cnt["m00"]
        cy = M_cnt["m01"] / M_cnt["m00"]
        cands.append((cx, cy, area))

    if len(cands) < 4:
        print(f"[strict] only {len(cands)} square-ish candidates found")
        return None

    # ── One candidate per corner quadrant ─────────────────────────────────────
    # 4% dead-band at centre prevents a single mark from qualifying for two zones.
    quads_norm = [
        (0.00, 0.48, 0.00, 0.48),   # TL
        (0.52, 1.00, 0.00, 0.48),   # TR
        (0.00, 0.48, 0.52, 1.00),   # BL
        (0.52, 1.00, 0.52, 1.00),   # BR
    ]
    # Ideal image-corner for each quadrant (marks should be near image edges)
    ideal_corners = [(0, 0), (W, 0), (0, H), (W, H)]

    corners: list[tuple[float, float]] = []
    for (nx0, nx1, ny0, ny1), (icx, icy) in zip(quads_norm, ideal_corners):
        in_q = [
            (cx, cy, a) for cx, cy, a in cands
            if nx0 * W <= cx < nx1 * W and ny0 * H <= cy < ny1 * H
        ]
        if not in_q:
            print(f"[strict] no candidate in quadrant "
                  f"x={nx0:.2f}-{nx1:.2f} y={ny0:.2f}-{ny1:.2f}")
            return None
        # Pick the DARKEST candidate — registration marks are solid black.
        # "Closest to corner" risks picking shadows, thumbs, or debris at the
        # image edge instead of the actual mark.
        best = min(in_q, key=lambda c: _ring_mean(gray, int(c[0]), int(c[1]), 0, 8))
        corners.append((best[0], best[1]))

    tl, tr, bl, br = corners

    # ── Geometric validation ────────────────────────────────────────────────────
    rect_w = (tr[0] - tl[0] + br[0] - bl[0]) / 2
    rect_h = (bl[1] - tl[1] + br[1] - tr[1]) / 2

    # Sheet must span at least 15% of the frame
    if rect_w < W * 0.15 or rect_h < H * 0.15:
        print(f"[strict] reject: spread too small {rect_w:.0f}×{rect_h:.0f}")
        return None

    # Aspect ratio ≈ 1.4 (320:450); allow wider range for angled shots
    aspect = rect_h / (rect_w + 1e-6)
    if not 0.60 <= aspect <= 3.50:
        print(f"[strict] reject: aspect {aspect:.2f}")
        return None

    # Corner ordering must be geometrically consistent
    if tl[0] >= tr[0] or bl[0] >= br[0] or tl[1] >= bl[1] or tr[1] >= br[1]:
        print("[strict] reject: corner order wrong")
        return None

    # ── Interior brightness check ─────────────────────────────────────────────
    # A real answer sheet has a white/bright interior (paper or bright screen).
    # Random scenes (dark desk, clothing, wall) fail this check.
    # Quick warp at small resolution to avoid slowing down detection.
    W_s, H_s = 160, 225
    src_pts_chk = np.float32([tl, tr, bl, br])
    dst_pts_chk = np.float32([[0, 0], [W_s, 0], [0, H_s], [W_s, H_s]])
    M_chk = cv2.getPerspectiveTransform(src_pts_chk, dst_pts_chk)
    small_warp = cv2.warpPerspective(gray, M_chk, (W_s, H_s))
    # Sample the central 60% — excludes the corner marks themselves.
    mx, my = W_s // 5, H_s // 5
    interior = small_warp[my : H_s - my, mx : W_s - mx]
    median_bright = float(np.median(interior))
    if median_bright < 140:
        print(f"[strict] reject: interior median={median_bright:.0f} (not bright paper/screen)")
        return None

    print(
        f"[strict] FOUND  aspect={aspect:.2f}  "
        f"rect={rect_w:.0f}×{rect_h:.0f}  "
        f"interior={median_bright:.0f}  candidates={len(cands)}"
    )
    return [tl, tr, bl, br]


# ── Detect endpoint ────────────────────────────────────────────────────────────

@app.post("/api/debug-scan")
async def debug_scan(req: DetectRequest):
    """Returns the warped image as base64 PNG so you can see what the server sees."""
    try:
        gray = decode_gray(req.imageBase64)
        corners = find_four_marks_strict(gray)
        if corners is None:
            return {"found": False, "warpedImage": None}

        tl, tr, bl, br = corners
        src_pts = np.float32([tl, tr, bl, br])
        dst_pts = np.float32([
            [REG_NORM["TL"][0] * WARP_W, REG_NORM["TL"][1] * WARP_H],
            [REG_NORM["TR"][0] * WARP_W, REG_NORM["TR"][1] * WARP_H],
            [REG_NORM["BL"][0] * WARP_W, REG_NORM["BL"][1] * WARP_H],
            [REG_NORM["BR"][0] * WARP_W, REG_NORM["BR"][1] * WARP_H],
        ])
        M = cv2.getPerspectiveTransform(src_pts, dst_pts)
        warped = cv2.warpPerspective(gray, M, (WARP_W, WARP_H))

        # Draw bubble target circles for visual verification
        vis = cv2.cvtColor(warped, cv2.COLOR_GRAY2BGR)
        for row in range(GRID_ROWS):
            for col in range(GRID_COLS):
                cx = int((0.25 + col * 0.15) * WARP_W)
                cy = int((0.22 + row * 0.13) * WARP_H)
                cv2.circle(vis, (cx, cy), SAMPLE_RADIUS, (0, 0, 255), 2)
                cv2.putText(vis, LETTERS[col], (cx - 8, cy + 5),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 255), 1)

        # Scale down for transfer (800×1125 is large)
        small = cv2.resize(vis, (320, 450))
        _, buf = cv2.imencode(".png", small)
        img_b64 = base64.b64encode(buf).decode()
        return {"found": True, "warpedImage": img_b64}
    except Exception:
        traceback.print_exc()
        return {"found": False, "warpedImage": None}


@app.post("/api/detect")
async def detect(req: DetectRequest):
    """Returns {found: true} only when a valid sheet pattern is confirmed."""
    try:
        gray = decode_gray(req.imageBase64)
        result = find_four_marks_strict(gray)
        if result is None:
            return {"found": False}
        return {"found": True, "corners": [[c[0], c[1]] for c in result]}
    except Exception:
        traceback.print_exc()
        return {"found": False}


# ── Scan endpoint ──────────────────────────────────────────────────────────────

@app.post("/api/scan")
async def scan(req: ScanRequest):
    """Perspective-correct the sheet, sample bubbles, return answers."""
    try:
        gray = decode_gray(req.imageBase64)
        H, W = gray.shape

        corners = find_four_marks_strict(gray)
        if corners is None:
            return {"error": "Sheet not detected — make sure all 4 corner marks are visible"}

        tl, tr, bl, br = corners

        # Perspective transform: photo corners → canonical warped space
        src_pts = np.float32([tl, tr, bl, br])
        dst_pts = np.float32([
            [REG_NORM["TL"][0] * WARP_W, REG_NORM["TL"][1] * WARP_H],
            [REG_NORM["TR"][0] * WARP_W, REG_NORM["TR"][1] * WARP_H],
            [REG_NORM["BL"][0] * WARP_W, REG_NORM["BL"][1] * WARP_H],
            [REG_NORM["BR"][0] * WARP_W, REG_NORM["BR"][1] * WARP_H],
        ])
        M = cv2.getPerspectiveTransform(src_pts, dst_pts)
        warped = cv2.warpPerspective(gray, M, (WARP_W, WARP_H))

        # ── Post-warp sanity: verify the 4 mark positions are actually dark ────────
        # If the perspective transform used the wrong contours, the expected mark
        # locations in warped space will be bright (paper) instead of dark (ink).
        # Bubble radius in warped space ≈ 27.5px; mark is 20px → 50px in warp.
        # Sample a 12px-radius circle at each expected mark center.
        mark_w = [
            (int(REG_NORM["TL"][0] * WARP_W), int(REG_NORM["TL"][1] * WARP_H)),
            (int(REG_NORM["TR"][0] * WARP_W), int(REG_NORM["TR"][1] * WARP_H)),
            (int(REG_NORM["BL"][0] * WARP_W), int(REG_NORM["BL"][1] * WARP_H)),
            (int(REG_NORM["BR"][0] * WARP_W), int(REG_NORM["BR"][1] * WARP_H)),
        ]
        mark_b = [_ring_mean(warped, mx, my, 0, 12) for mx, my in mark_w]
        # Adaptive threshold: marks must be darker than 65% of interior paper brightness.
        # Using an absolute value (130) rejects valid scans with light-ink printing.
        interior_median = float(np.median(warped[200:900, 150:650]))
        mark_threshold = min(0.65 * interior_median, 160.0)
        print(f"[scan] warp mark brightness (should be dark): {[f'{b:.0f}' for b in mark_b]}  "
              f"interior={interior_median:.0f}  threshold={mark_threshold:.0f}")
        if max(mark_b) > mark_threshold:
            return {"error": "Sheet not aligned correctly — make sure all 4 corner marks are visible and flat"}

        # ── Normalise warped image histogram ──────────────────────────────────────
        # Stretch the tonal range so white paper → 255 and darkest ink → near 0.
        # This makes thresholds consistent regardless of printer tone or lighting.
        lo, hi = (int(v) for v in np.percentile(warped, [2, 98]))
        if hi > lo:
            warped = np.clip(
                (warped.astype(np.float32) - lo) / (hi - lo) * 255, 0, 255
            ).astype(np.uint8)

        # ── Bubble reading ─────────────────────────────────────────────────────────
        # Normalised fill ratio: (outer_brightness - inner_brightness) / outer_brightness
        #
        #   ratio ≈ 0.00–0.06  → empty  (inner ≈ outer ≈ white paper)
        #   ratio ≈ 0.10–0.90  → filled (dark pencil/ink inside, bright paper outside)
        #
        # outer uses the BRIGHTEST 80% of the annulus ring so that any dark
        # element (shadow, text, crease) that falls in the ring is excluded.
        #
        # Radii in warped space (bubble radius ≈ 27.5px, border ≈ 4px thick):
        #   INNER_R  = 16   — well inside interior (safe margin from 23.75px inner edge)
        #   OUTER_R1 = 36   — starts 8px past bubble edge (clears JPEG border bleed)
        #   OUTER_R2 = 50   — more outer-ring pixels → percentile more stable
        INNER_R  = 16
        OUTER_R1 = 36
        OUTER_R2 = 50

        # ratio must exceed this to count as filled
        MIN_RATIO = 0.08
        # winner must beat runner-up by this margin (prevents noise wins)
        MIN_GAP   = 0.04

        row_ratios: list[list[float]] = []
        row_inner: list[list[float]] = []
        row_outer: list[list[float]] = []
        answers: list[str] = []
        confidence: list[float] = []

        for row in range(GRID_ROWS):
            ratios: list[float] = []
            inners: list[float] = []
            outers: list[float] = []
            for col in range(GRID_COLS):
                nx = 0.25 + col * 0.15
                ny = 0.22 + row * 0.13
                cx, cy = nx * WARP_W, ny * WARP_H
                icx, icy = int(round(cx)), int(round(cy))
                inner = _ring_mean(warped, icx, icy, 0, INNER_R)
                outer = _ring_bright(warped, icx, icy, OUTER_R1, OUTER_R2)
                ratio = (outer - inner) / max(outer, 64.0)
                ratios.append(ratio)
                inners.append(inner)
                outers.append(outer)
            row_ratios.append(ratios)
            row_inner.append(inners)
            row_outer.append(outers)

            sorted_r = sorted(ratios, reverse=True)
            best   = sorted_r[0]
            second = sorted_r[1] if len(sorted_r) > 1 else 0.0
            best_idx = ratios.index(best)
            gap = best - second

            if best >= MIN_RATIO and gap >= MIN_GAP:
                answers.append(LETTERS[best_idx])
                confidence.append(min(gap / 0.4, 1.0))
            else:
                answers.append("?")
                confidence.append(0.0)

        print(f"[scan] corners: {[f'({c[0]:.0f},{c[1]:.0f})' for c in corners]}")
        for i, (ratios, inners, outers) in enumerate(
            zip(row_ratios, row_inner, row_outer)
        ):
            inner_str = ",".join(f"{v:.0f}" for v in inners)
            outer_str = ",".join(f"{v:.0f}" for v in outers)
            rat_str   = ",".join(f"{v:.2f}" for v in ratios)
            print(f"[scan] Q{i+1}: inner=[{inner_str}] outer=[{outer_str}] "
                  f"ratio=[{rat_str}]→{answers[i]}")

        bubble_brightness = row_ratios  # higher ratio = more filled

        return {
            "answers": answers,
            "confidence": confidence,
            "debugInfo": {
                "corners": [[c[0], c[1]] for c in corners],
                "bubbleBrightness": bubble_brightness,
                "imageSize": [W, H],
            },
        }

    except Exception:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail="Scan processing failed")


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=5002, reload=False)
