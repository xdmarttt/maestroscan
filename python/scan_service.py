#!/usr/bin/env python3
"""
GradeSnap scan service — FastAPI + OpenCV.
Run: python3 -m uvicorn scan_service:app --reload --port 5002
"""

import base64
import io
import os
import traceback
from typing import Optional

# Debug output path — overwritten on every scan so you always see the latest
DEBUG_IMG_PATH = os.path.join(os.path.dirname(__file__), "debug_last_scan.png")

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
#   TL=(19.6, 28)   TR=(300.4, 28)   BL=(19.6, 422)  BR=(300.4, 422)
#   CL=(19.6, 225)  CR=(300.4, 225)  ← center-side marks (added for 6-pt homography)
REG_NORM = {
    "TL": (19.6 / SHEET_W,   28.0 / SHEET_H),
    "TR": (300.4 / SHEET_W,  28.0 / SHEET_H),
    "BL": (19.6 / SHEET_W,  422.0 / SHEET_H),
    "BR": (300.4 / SHEET_W, 422.0 / SHEET_H),
    "CL": (19.6 / SHEET_W,  225.0 / SHEET_H),   # center-left
    "CR": (300.4 / SHEET_W, 225.0 / SHEET_H),   # center-right
}

SAMPLE_RADIUS = 22         # px in warped space (bubble interior radius ≈ 27px)
MIN_FILL_GAP = 15          # filled bubble must be ≥ this darker than 2nd darkest in row


# ── Dynamic grid layout (must match lib/grid-layout.ts) ──────────────────────

def compute_grid_layout(question_count: int, choice_count: int = 4):
    """Replicate lib/grid-layout.ts computeGridLayout() in Python."""
    if question_count <= 10:
        question_columns = 1
    elif question_count <= 25:
        question_columns = 2
    elif question_count <= 50:
        question_columns = 3
    elif question_count <= 75:
        question_columns = 4
    else:
        question_columns = 5

    import math
    questions_per_column = math.ceil(question_count / question_columns)
    letters = ["A", "B", "C", "D", "E"][:choice_count]

    AREA_X0, AREA_X1 = 0.10, 0.90
    AREA_Y0, AREA_Y1 = 0.15, 0.88
    COL_GAP_NORM = 0.02
    LABEL_WIDTH_NORM = 0.04

    area_w = AREA_X1 - AREA_X0
    area_h = AREA_Y1 - AREA_Y0

    col_width = (area_w - COL_GAP_NORM * (question_columns - 1)) / question_columns
    bubble_spacing_h = (col_width - LABEL_WIDTH_NORM) / choice_count
    bubble_spacing_v = area_h / questions_per_column

    MIN_BUBBLE_NORM = 10 / WARP_W
    bubble_diameter_norm = max(MIN_BUBBLE_NORM, min(bubble_spacing_h, bubble_spacing_v) * 0.72)

    REF_BUBBLE_WARPED = 55
    REF_INNER_R, REF_OUTER_R1, REF_OUTER_R2 = 16, 36, 50
    actual_bubble_warped = bubble_diameter_norm * WARP_W
    scale = actual_bubble_warped / REF_BUBBLE_WARPED
    h_spacing_px = bubble_spacing_h * WARP_W
    v_spacing_px = bubble_spacing_v * WARP_H
    max_outer_r = int(min(h_spacing_px, v_spacing_px) * 0.42)
    inner_r = max(4, round(REF_INNER_R * scale))
    outer_r1 = max(inner_r + 2, min(round(REF_OUTER_R1 * scale), max_outer_r - 2))
    outer_r2 = max(outer_r1 + 2, min(round(REF_OUTER_R2 * scale), max_outer_r))

    def bubble_center(q: int, c: int):
        q_col = q // questions_per_column
        q_row = q % questions_per_column
        col_start_x = AREA_X0 + q_col * (col_width + COL_GAP_NORM)
        nx = col_start_x + LABEL_WIDTH_NORM + (c + 0.5) * bubble_spacing_h
        ny = AREA_Y0 + (q_row + 0.5) * bubble_spacing_v
        return nx, ny

    return {
        "question_count": question_count,
        "choice_count": choice_count,
        "letters": letters,
        "question_columns": question_columns,
        "questions_per_column": questions_per_column,
        "bubble_center": bubble_center,
        "inner_r": inner_r,
        "outer_r1": outer_r1,
        "outer_r2": outer_r2,
        "min_ratio": 0.08,
        "min_gap": 0.04,
    }

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
    choiceCount: int = 4
    # [[x,y],[x,y],[x,y],[x,y]] TL,TR,BL,BR in pixels of the resized image.
    # When provided, perspective warp uses these corners directly — no mark detection.
    corners: Optional[list] = None


# ── Image helpers ──────────────────────────────────────────────────────────────

def decode_gray(image_base64: str) -> np.ndarray:
    """Decode base64 image, apply EXIF rotation, return grayscale uint8 ndarray."""
    buf = base64.b64decode(image_base64)
    pil_img = Image.open(io.BytesIO(buf))
    pil_img = ImageOps.exif_transpose(pil_img)
    # expo-image-manipulator strips EXIF when resizing, leaving raw landscape pixels.
    # The answer sheet is always portrait (taller than wide), so if we receive a
    # landscape image it means EXIF rotation was lost — rotate back to portrait.
    if pil_img.width > pil_img.height:
        pil_img = pil_img.rotate(90, expand=True)  # 90° CCW — standard iOS sensor fix
        print(f"[decode] landscape image auto-rotated to portrait ({pil_img.width}×{pil_img.height})")
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

def _find_mark_candidates(
    gray: np.ndarray,
) -> list[tuple[float, float, float]]:
    """
    Run adaptive threshold + contour filter to find all square-ish dark blobs.
    Returns list of (cx, cy, area) tuples — registration mark candidates.
    """
    H, W = gray.shape
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    bsz = max(31, round(W * 0.18) | 1)
    thresh = cv2.adaptiveThreshold(
        blurred, 255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV,
        bsz, 10
    )
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
    thresh = cv2.morphologyEx(thresh, cv2.MORPH_CLOSE, kernel)
    contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    min_area = (W * 0.010) ** 2
    max_area = (W * 0.180) ** 2
    cands: list[tuple[float, float, float]] = []
    for cnt in contours:
        area = cv2.contourArea(cnt)
        if not (min_area <= area <= max_area):
            continue
        x, y, bw, bh = cv2.boundingRect(cnt)
        if bw < 2 or bh < 2:
            continue
        # Bounding-box aspect ratio: reject elongated shapes (keep near-square)
        if min(bw, bh) / max(bw, bh) < 0.60:
            continue
        # Solidity: area / bounding-box area
        #   Square (registration mark): ~1.0  → PASS
        #   Circle (filled bubble):      π/4 ≈ 0.785 → FAIL
        # This is the key filter that keeps squares and rejects circles.
        if area / (bw * bh) < 0.82:
            continue
        M_cnt = cv2.moments(cnt)
        if M_cnt["m00"] < 1:
            continue
        cx = M_cnt["m10"] / M_cnt["m00"]
        cy = M_cnt["m01"] / M_cnt["m00"]
        cands.append((cx, cy, area))
    return cands


def _find_center_marks(
    gray: np.ndarray,
    cands: list[tuple[float, float, float]],
    tl: tuple[float, float],
    tr: tuple[float, float],
    bl: tuple[float, float],
    br: tuple[float, float],
) -> tuple[Optional[tuple[float, float]], Optional[tuple[float, float]]]:
    """
    Given the 4 corner positions, look for center-side marks (CL, CR).

    Uses TIGHT x tolerance (±5% W) because center marks share the same
    x-column as the corner marks — bubbles and other blobs on the sheet are
    never this close to the left/right edge.  A loose x window would allow
    filled bubbles (which also pass the squareness/solidity filter) to be
    mistakenly accepted as center marks, corrupting the homography.

    Also requires genuine darkness (mean brightness < 100) so an empty
    circle border is never accepted.
    """
    H, W = gray.shape
    x_tol = W * 0.05   # tight: marks are vertically aligned with corner marks
    y_tol = W * 0.12   # loose: sheet can be at an angle
    results: list[Optional[tuple[float, float]]] = []
    for pred in [
        ((tl[0] + bl[0]) / 2, (tl[1] + bl[1]) / 2),  # CL predicted
        ((tr[0] + br[0]) / 2, (tr[1] + br[1]) / 2),  # CR predicted
    ]:
        nearby = [
            (cx, cy) for cx, cy, _ in cands
            if abs(cx - pred[0]) < x_tol and abs(cy - pred[1]) < y_tol
        ]
        if nearby:
            best = min(nearby, key=lambda c: _ring_mean(gray, int(c[0]), int(c[1]), 0, 8))
            darkness = _ring_mean(gray, int(best[0]), int(best[1]), 0, 8)
            # Must be a genuinely dark solid mark — not just a circle outline
            if darkness < 100:
                results.append(best)
            else:
                results.append(None)
        else:
            results.append(None)
    found = sum(1 for r in results if r is not None)
    if found:
        print(f"[marks] center marks found: {found}/2")
    return results[0], results[1]


def _solve_homography(
    src_pts: np.ndarray,
    dst_pts: np.ndarray,
) -> np.ndarray:
    """
    Compute perspective transform matrix.
    - 4 points  → getPerspectiveTransform (exact)
    - 5-6 points → findHomography with RANSAC (least-squares, outlier-robust)
      Falls back to 4-corner exact solve if RANSAC returns None.
    """
    if len(src_pts) == 4:
        return cv2.getPerspectiveTransform(src_pts, dst_pts)

    M, _ = cv2.findHomography(src_pts, dst_pts, cv2.RANSAC, 8.0)
    if M is not None:
        return M
    # RANSAC failed — fall back to the 4 corner points
    print("[homography] RANSAC failed, falling back to 4-corner solve")
    return cv2.getPerspectiveTransform(src_pts[:4], dst_pts[:4])


def find_four_marks_strict(
    gray: np.ndarray,
) -> Optional[list[tuple[float, float]]]:
    """
    Find 4 corner registration marks.
    Returns [TL, TR, BL, BR] or None.
    """
    H, W = gray.shape
    cands = _find_mark_candidates(gray)

    if len(cands) < 4:
        print(f"[strict] only {len(cands)} square-ish candidates found")
        return None

    # ── One candidate per corner quadrant ─────────────────────────────────────
    quads_norm = [
        (0.00, 0.48, 0.00, 0.48),   # TL
        (0.52, 1.00, 0.00, 0.48),   # TR
        (0.00, 0.48, 0.52, 1.00),   # BL
        (0.52, 1.00, 0.52, 1.00),   # BR
    ]

    corners: list[tuple[float, float]] = []
    for (nx0, nx1, ny0, ny1) in quads_norm:
        in_q = [
            (cx, cy, a) for cx, cy, a in cands
            if nx0 * W <= cx < nx1 * W and ny0 * H <= cy < ny1 * H
        ]
        if not in_q:
            print(f"[strict] no candidate in quadrant "
                  f"x={nx0:.2f}-{nx1:.2f} y={ny0:.2f}-{ny1:.2f}")
            return None
        # Pick the darkest candidate in each quadrant. Registration marks are
        # solid black squares (uniformly dark), so they win against circle
        # outlines, text, and partially-filled bubbles that share the quadrant.
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
        cands = _find_mark_candidates(gray)
        cl, cr = _find_center_marks(gray, cands, tl, tr, bl, br)

        src_list = [tl, tr, bl, br]
        dst_list = [
            (REG_NORM["TL"][0] * WARP_W, REG_NORM["TL"][1] * WARP_H),
            (REG_NORM["TR"][0] * WARP_W, REG_NORM["TR"][1] * WARP_H),
            (REG_NORM["BL"][0] * WARP_W, REG_NORM["BL"][1] * WARP_H),
            (REG_NORM["BR"][0] * WARP_W, REG_NORM["BR"][1] * WARP_H),
        ]
        if cl is not None:
            src_list.append(cl); dst_list.append((REG_NORM["CL"][0] * WARP_W, REG_NORM["CL"][1] * WARP_H))
        if cr is not None:
            src_list.append(cr); dst_list.append((REG_NORM["CR"][0] * WARP_W, REG_NORM["CR"][1] * WARP_H))

        src_pts = np.float32(src_list)
        dst_pts = np.float32(dst_list)
        M = _solve_homography(src_pts, dst_pts)
        warped = cv2.warpPerspective(gray, M, (WARP_W, WARP_H))

        # Draw bubble target circles for visual verification (default 5q/4c)
        layout = compute_grid_layout(5, 4)
        vis = cv2.cvtColor(warped, cv2.COLOR_GRAY2BGR)
        for q in range(layout["question_count"]):
            for c in range(layout["choice_count"]):
                nx, ny = layout["bubble_center"](q, c)
                cx = int(nx * WARP_W)
                cy = int(ny * WARP_H)
                cv2.circle(vis, (cx, cy), SAMPLE_RADIUS, (0, 0, 255), 2)
                cv2.putText(vis, layout["letters"][c], (cx - 8, cy + 5),
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
        mark_keys: list[str] = []   # used by debug image writer below

        if req.corners:
            # ── Manual-alignment mode ────────────────────────────────────────────
            # The app measured the on-screen bracket positions, mapped them to
            # image pixel coordinates, and sent them here.
            # We use them directly — no mark detection needed.
            tl = (float(req.corners[0][0]), float(req.corners[0][1]))
            tr = (float(req.corners[1][0]), float(req.corners[1][1]))
            bl = (float(req.corners[2][0]), float(req.corners[2][1]))
            br = (float(req.corners[3][0]), float(req.corners[3][1]))
            corners = [tl, tr, bl, br]
            print(f"[scan] corner mode  tl={tl}  tr={tr}  bl={bl}  br={br}")

            # Map paper corners → full warp rectangle
            src_pts = np.float32([tl, tr, bl, br])
            dst_pts = np.float32([
                [0,      0     ],
                [WARP_W, 0     ],
                [0,      WARP_H],
                [WARP_W, WARP_H],
            ])
            M = cv2.getPerspectiveTransform(src_pts, dst_pts)
            warped = cv2.warpPerspective(gray, M, (WARP_W, WARP_H))

            interior_median = float(np.median(
                warped[int(WARP_H*0.1):int(WARP_H*0.9), int(WARP_W*0.1):int(WARP_W*0.9)]
            ))
            print(f"[scan] corner-warp interior: {interior_median:.0f}")
            if interior_median < 100:
                return {"error": "Image too dark — make sure the sheet is well lit"}

        else:
            # ── Auto-detect mode (fallback) ──────────────────────────────────────
            corners = find_four_marks_strict(gray)
            if corners is None:
                return {"error": "Sheet not detected — align all 4 corners to the bracket guides"}

            tl, tr, bl, br = corners
            cands = _find_mark_candidates(gray)
            cl, cr = _find_center_marks(gray, cands, tl, tr, bl, br)

            src_list = [tl, tr, bl, br]
            dst_list = [
                (REG_NORM["TL"][0] * WARP_W, REG_NORM["TL"][1] * WARP_H),
                (REG_NORM["TR"][0] * WARP_W, REG_NORM["TR"][1] * WARP_H),
                (REG_NORM["BL"][0] * WARP_W, REG_NORM["BL"][1] * WARP_H),
                (REG_NORM["BR"][0] * WARP_W, REG_NORM["BR"][1] * WARP_H),
            ]
            mark_keys = ["TL", "TR", "BL", "BR"]
            if cl is not None:
                src_list.append(cl)
                dst_list.append((REG_NORM["CL"][0] * WARP_W, REG_NORM["CL"][1] * WARP_H))
                mark_keys.append("CL")
            if cr is not None:
                src_list.append(cr)
                dst_list.append((REG_NORM["CR"][0] * WARP_W, REG_NORM["CR"][1] * WARP_H))
                mark_keys.append("CR")

            M = _solve_homography(np.float32(src_list), np.float32(dst_list))
            print(f"[scan] auto-detect from {len(src_list)} marks")
            warped = cv2.warpPerspective(gray, M, (WARP_W, WARP_H))

        # ── Normalise warped image histogram ──────────────────────────────────────
        # Stretch the tonal range so white paper → 255 and darkest ink → near 0.
        # This makes thresholds consistent regardless of printer tone or lighting.
        lo, hi = (int(v) for v in np.percentile(warped, [2, 98]))
        if hi > lo:
            warped = np.clip(
                (warped.astype(np.float32) - lo) / (hi - lo) * 255, 0, 255
            ).astype(np.uint8)

        # ── Bubble reading using dynamic layout ─────────────────────────────────
        question_count = len(req.questions)
        choice_count = max(4, min(5, req.choiceCount))
        layout = compute_grid_layout(question_count, choice_count)
        INNER_R  = layout["inner_r"]
        OUTER_R1 = layout["outer_r1"]
        OUTER_R2 = layout["outer_r2"]
        MIN_RATIO = layout["min_ratio"]
        MIN_GAP   = layout["min_gap"]

        row_ratios: list[list[float]] = []
        row_inner: list[list[float]] = []
        row_outer: list[list[float]] = []
        answers: list[str] = []
        confidence: list[float] = []

        for q in range(layout["question_count"]):
            ratios: list[float] = []
            inners: list[float] = []
            outers: list[float] = []
            for c in range(layout["choice_count"]):
                nx, ny = layout["bubble_center"](q, c)
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
                answers.append(layout["letters"][best_idx])
                confidence.append(min(gap / 0.4, 1.0))
            else:
                answers.append("?")
                confidence.append(0.0)

        print(f"[scan] src corners: tl={tl}  tr={tr}  bl={bl}  br={br}")
        for i, (ratios, inners, outers) in enumerate(
            zip(row_ratios, row_inner, row_outer)
        ):
            inner_str = ",".join(f"{v:.0f}" for v in inners)
            outer_str = ",".join(f"{v:.0f}" for v in outers)
            rat_str   = ",".join(f"{v:.2f}" for v in ratios)
            print(f"[scan] Q{i+1}: inner=[{inner_str}] outer=[{outer_str}] "
                  f"ratio=[{rat_str}]→{answers[i]}")

        # ── Save debug image ───────────────────────────────────────────────────
        try:
            vis = cv2.cvtColor(warped, cv2.COLOR_GRAY2BGR)
            for q in range(layout["question_count"]):
                for c in range(layout["choice_count"]):
                    nx, ny = layout["bubble_center"](q, c)
                    cx = int(nx * WARP_W)
                    cy = int(ny * WARP_H)
                    ratio = row_ratios[q][c]
                    filled = answers[q] == layout["letters"][c]
                    color = (0, 255, 0) if filled else (0, 0, 255)
                    thickness = 3 if filled else 1
                    cv2.circle(vis, (cx, cy), INNER_R, color, thickness)
                    cv2.putText(vis, f"{ratio:.2f}", (cx - 14, cy + 5),
                                cv2.FONT_HERSHEY_SIMPLEX, 0.35, color, 1)
            # Draw registration mark positions
            for k in mark_keys:
                mx2 = int(REG_NORM[k][0] * WARP_W)
                my2 = int(REG_NORM[k][1] * WARP_H)
                cv2.drawMarker(vis, (mx2, my2), (255, 0, 128),
                               cv2.MARKER_CROSS, 20, 2)
            small = cv2.resize(vis, (320, 450))
            cv2.imwrite(DEBUG_IMG_PATH, small)
            print(f"[scan] debug image saved → {DEBUG_IMG_PATH}")
        except Exception:
            traceback.print_exc()

        bubble_brightness = row_ratios

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
