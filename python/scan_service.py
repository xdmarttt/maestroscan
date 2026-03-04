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


def count_dark_pixels(binary: np.ndarray, cx: float, cy: float, r: int) -> int:
    """Count non-zero (dark after BINARY_INV) pixels within radius r of (cx, cy)."""
    H, W = binary.shape
    icx, icy = int(round(cx)), int(round(cy))
    y0, y1 = max(0, icy - r), min(H, icy + r + 1)
    x0, x1 = max(0, icx - r), min(W, icx + r + 1)
    if y1 <= y0 or x1 <= x0:
        return 0
    patch = binary[y0:y1, x0:x1]
    ys = np.arange(y0 - icy, y1 - icy).reshape(-1, 1)
    xs = np.arange(x0 - icx, x1 - icx).reshape(1, -1)
    mask = (xs * xs + ys * ys) <= r * r
    return int(patch[mask].sum() // 255)


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
        # Among candidates in this quadrant, pick the one closest to the
        # image corner — registration marks sit at the corners of the sheet.
        best = min(in_q, key=lambda c: (c[0] - icx) ** 2 + (c[1] - icy) ** 2)
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

        # Otsu threshold → binary image (dark pixels become white/255, bright → 0).
        # Otsu automatically finds the best global threshold for this specific image,
        # so it works regardless of exposure, screen vs paper, or lighting conditions.
        _, binary = cv2.threshold(warped, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)

        # Count dark pixels per bubble.  A filled bubble → hundreds of dark pixels.
        # An empty bubble → almost none (just the thin border line).
        BUBBLE_AREA = int(np.pi * SAMPLE_RADIUS ** 2)   # ≈ 1520 px for r=22
        bubble_counts: list[list[int]] = []
        answers: list[str] = []
        confidence: list[float] = []

        for row in range(GRID_ROWS):
            row_c: list[int] = []
            for col in range(GRID_COLS):
                nx = 0.25 + col * 0.15
                ny = 0.22 + row * 0.13
                row_c.append(count_dark_pixels(binary, nx * WARP_W, ny * WARP_H, SAMPLE_RADIUS))
            bubble_counts.append(row_c)

            sorted_c = sorted(row_c, reverse=True)
            max_c   = sorted_c[0]
            second_c = sorted_c[1] if len(sorted_c) > 1 else 0
            max_idx = row_c.index(max_c)

            fill_ratio = max_c / BUBBLE_AREA          # fraction of bubble area that's dark
            gap_ratio  = (max_c - second_c) / (BUBBLE_AREA + 1)

            # A real fill: >20% of bubble area dark AND clearly more than runner-up
            if fill_ratio > 0.20 and gap_ratio > 0.10:
                answers.append(LETTERS[max_idx])
                confidence.append(min(gap_ratio * 5, 1.0))
            else:
                answers.append("?")
                confidence.append(0.0)

        # Diagnostic: dark-pixel count at mark positions — should be high (marks are solid black)
        mark_counts = {
            k: count_dark_pixels(binary, REG_NORM[k][0] * WARP_W, REG_NORM[k][1] * WARP_H, 15)
            for k in REG_NORM
        }
        print(f"[scan] corners: {[f'({c[0]:.0f},{c[1]:.0f})' for c in corners]}")
        print(f"[scan] mark dark-px in warped (high = transform OK): {mark_counts}")
        print("[scan] bubble dark-px counts: " + "  ".join(
            f"Q{i+1}:{row_c}" for i, row_c in enumerate(bubble_counts)
        ))

        bubble_brightness = [[c / BUBBLE_AREA for c in row] for row in bubble_counts]  # keep API compat

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
