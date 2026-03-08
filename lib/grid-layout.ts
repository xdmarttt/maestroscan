/**
 * grid-layout.ts
 *
 * Single source of truth for bubble grid positions and sizes.
 * Used by: app/sheet.tsx, lib/scan-offline.ts, server/scan.ts, app/results.tsx
 * Replicated in: python/scan_service.py (must stay in sync!)
 *
 * Given (questionCount, choiceCount) → returns everything needed to render
 * and scan a dynamic answer sheet with multi-column layout.
 */

// Sheet and warp dimensions (must match scan-offline.ts and scan_service.py)
export const SHEET_W = 320;
export const SHEET_H = 450;
export const WARP_W = 800;
export const WARP_H = 1125;

export interface GridLayout {
  questionCount: number;
  choiceCount: 4 | 5;
  letters: string[];
  questionColumns: number;
  questionsPerColumn: number;
  /** Bubble diameter in normalized [0-1] coordinates */
  bubbleDiameterNorm: number;
  /** Bubble diameter in 320×450 sheet pixels */
  bubbleDiameterSheet: number;
  /** Bubble diameter in 800×1125 warped pixels */
  bubbleDiameterWarped: number;
  /** Returns normalized (0-1) center for question q (0-based), choice c (0-based) */
  bubbleCenter: (q: number, c: number) => { nx: number; ny: number };
  /** Label (question number) X position for a given question (normalized) */
  labelX: (q: number) => number;
  // Sampling radii in warped (800×1125) pixel space
  innerR: number;
  outerR1: number;
  outerR2: number;
  // Detection thresholds
  minRatio: number;
  minGap: number;
}

// Bubble area boundaries (normalized, inside registration marks)
const AREA_X0 = 0.10;
const AREA_X1 = 0.90;
const AREA_Y0 = 0.33;
const AREA_Y1 = 0.88;

const COL_GAP_NORM = 0.02;
const LABEL_WIDTH_NORM = 0.04;

// Reference bubble: 22px on 320px sheet = 55px on 800px warped
const REF_BUBBLE_WARPED = 55;
const REF_INNER_R = 16;
const REF_OUTER_R1 = 36;
const REF_OUTER_R2 = 50;

export function computeGridLayout(
  questionCount: number,
  choiceCount: 4 | 5 = 4,
): GridLayout {
  // 1. Determine question column count
  let questionColumns: number;
  if (questionCount <= 10) questionColumns = 1;
  else if (questionCount <= 25) questionColumns = 2;
  else if (questionCount <= 50) questionColumns = 3;
  else if (questionCount <= 75) questionColumns = 4;
  else questionColumns = 5;

  const questionsPerColumn = Math.ceil(questionCount / questionColumns);
  const letters =
    choiceCount === 5
      ? ["A", "B", "C", "D", "E"]
      : ["A", "B", "C", "D"];

  // 2. Space allocation
  const areaW = AREA_X1 - AREA_X0;
  const areaH = AREA_Y1 - AREA_Y0;

  const colWidth =
    (areaW - COL_GAP_NORM * (questionColumns - 1)) / questionColumns;
  const bubbleSpacingH = (colWidth - LABEL_WIDTH_NORM) / choiceCount;
  const bubbleSpacingV = areaH / questionsPerColumn;

  // 3. Bubble size: fit within spacing, clamp to min detectable
  const MIN_BUBBLE_NORM = 10 / WARP_W;
  const bubbleDiameterNorm = Math.max(
    MIN_BUBBLE_NORM,
    Math.min(bubbleSpacingH, bubbleSpacingV) * 0.72,
  );

  // 4. Sampling radii: scale proportionally from reference,
  //    but cap outer ring so it never extends into adjacent bubbles.
  const actualBubbleWarped = bubbleDiameterNorm * WARP_W;
  const scale = actualBubbleWarped / REF_BUBBLE_WARPED;
  const hSpacingPx = bubbleSpacingH * WARP_W;
  const vSpacingPx = bubbleSpacingV * WARP_H;
  const maxOuterR = Math.floor(Math.min(hSpacingPx, vSpacingPx) * 0.42);
  const innerR = Math.max(4, Math.round(REF_INNER_R * scale));
  const outerR1 = Math.max(innerR + 2, Math.min(Math.round(REF_OUTER_R1 * scale), maxOuterR - 2));
  const outerR2 = Math.max(outerR1 + 2, Math.min(Math.round(REF_OUTER_R2 * scale), maxOuterR));

  // 5. Position functions
  function bubbleCenter(q: number, c: number): { nx: number; ny: number } {
    const qCol = Math.floor(q / questionsPerColumn);
    const qRow = q % questionsPerColumn;
    const colStartX = AREA_X0 + qCol * (colWidth + COL_GAP_NORM);
    const nx = colStartX + LABEL_WIDTH_NORM + (c + 0.5) * bubbleSpacingH;
    const ny = AREA_Y0 + (qRow + 0.5) * bubbleSpacingV;
    return { nx, ny };
  }

  function labelX(q: number): number {
    const qCol = Math.floor(q / questionsPerColumn);
    return AREA_X0 + qCol * (colWidth + COL_GAP_NORM) + LABEL_WIDTH_NORM * 0.5;
  }

  return {
    questionCount,
    choiceCount,
    letters,
    questionColumns,
    questionsPerColumn,
    bubbleDiameterNorm,
    bubbleDiameterSheet: bubbleDiameterNorm * SHEET_W,
    bubbleDiameterWarped: bubbleDiameterNorm * WARP_W,
    bubbleCenter,
    labelX,
    innerR,
    outerR1,
    outerR2,
    minRatio: 0.13,
    minGap: 0.06,
  };
}
