/**
 * Port of sheet-generator.html drawing logic.
 * Draws a full ScanGrade answer sheet on an offscreen canvas,
 * embedding a custom header image from the fabric.js editor.
 */

// ── Sheet constants (must match lib/grid-layout.ts + sheet-generator.html) ──
const SHEET_W = 320,
  SHEET_H = 450;
const WARP_W = 800;
const AREA_X0 = 0.1,
  AREA_X1 = 0.9;
const AREA_Y0 = 0.33,
  AREA_Y1 = 0.82;
const COL_GAP_NORM = 0.02;
const LABEL_WIDTH_NORM = 0.04;

const BARCODE_X0 = 0.2,
  BARCODE_X1 = 0.8;
const BARCODE_Y0 = 0.88,
  BARCODE_Y1 = 0.91;
const BARCODE_LABEL_Y = 0.875;

const MARK_SIZE = 20;
const MARKS = [
  { x: 9.6, y: 18 },
  { x: SHEET_W - 9.6 - MARK_SIZE, y: 18 },
  { x: 9.6, y: SHEET_H - 18 - MARK_SIZE },
  { x: SHEET_W - 9.6 - MARK_SIZE, y: SHEET_H - 18 - MARK_SIZE },
];

// ── Code 128B encoder ──
const CODE128_BINARY = [
  "11011001100","11001101100","11001100110","10010011000","10010001100",
  "10001001100","10011001000","10011000100","10001100100","11001001000",
  "11001000100","11000100100","10110011100","10011011100","10011001110",
  "10111001100","10011101100","10011100110","11001110010","11001011100",
  "11001001110","11011100100","11001110100","11101101110","11101001100",
  "11100101100","11100100110","11101100100","11100110100","11100110010",
  "11011011000","11011000110","11000110110","10100011000","10001011000",
  "10001000110","10110001000","10001101000","10001100010","11010001000",
  "11000101000","11000100010","10110111000","10110001110","10001101110",
  "10111011000","10111000110","10001110110","11101110110","11010001110",
  "11000101110","11011101000","11011100010","11011101110","11101011000",
  "11101000110","11100010110","11101101000","11101100010","11100011010",
  "11101111010","11001000010","11110001010","10100110000","10100001100",
  "10010110000","10010000110","10000101100","10000100110","10110010000",
  "10110000100","10011010000","10011000010","10000110100","10000110010",
  "11000010010","11001010000","11110111010","11000010100","10001111010",
  "10100111100","10010111100","10010011110","10111100100","10011110100",
  "10011110010","11110100100","11110010100","11110010010","11011011110",
  "11011110110","11110110110","10101111000","10100011110","10001011110",
  "10111101000","10111100010","11110101000","11110100010","10111011110",
  "10111101110","11101011110","11110101110","11010000100","11010010000",
  "11010011100",
];
const CODE128_STOP_BINARY = "1100011101011";

function binaryToWidths(bin: string): number[] {
  const w: number[] = [];
  let i = 0;
  while (i < bin.length) {
    const ch = bin[i];
    let run = 0;
    while (i < bin.length && bin[i] === ch) {
      run++;
      i++;
    }
    w.push(run);
  }
  return w;
}

const CODE128_PATTERNS = CODE128_BINARY.map(binaryToWidths);
const CODE128_STOP = binaryToWidths(CODE128_STOP_BINARY);

function encodeCode128B(text: string): number[] {
  const START_B = 104;
  let checksum = START_B;
  const symbols = [CODE128_PATTERNS[START_B]];
  for (let i = 0; i < text.length; i++) {
    const val = text.charCodeAt(i) - 32;
    if (val < 0 || val > 94) continue;
    symbols.push(CODE128_PATTERNS[val]);
    checksum += (i + 1) * val;
  }
  symbols.push(CODE128_PATTERNS[checksum % 103]);
  symbols.push(CODE128_STOP);
  return symbols.flat();
}

// ── Grid layout ──
function computeGridLayout(questionCount: number, choiceCount: number) {
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
  const areaW = AREA_X1 - AREA_X0;
  const areaH = AREA_Y1 - AREA_Y0;
  const colWidth =
    (areaW - COL_GAP_NORM * (questionColumns - 1)) / questionColumns;
  const bubbleSpacingH = (colWidth - LABEL_WIDTH_NORM) / choiceCount;
  const bubbleSpacingV = areaH / questionsPerColumn;
  const MIN_BUBBLE_NORM = 10 / WARP_W;
  const bubbleDiameterNorm = Math.max(
    MIN_BUBBLE_NORM,
    Math.min(bubbleSpacingH, bubbleSpacingV) * 0.72,
  );

  function bubbleCenter(q: number, c: number) {
    const qCol = Math.floor(q / questionsPerColumn);
    const qRow = q % questionsPerColumn;
    const colStartX = AREA_X0 + qCol * (colWidth + COL_GAP_NORM);
    const nx = colStartX + LABEL_WIDTH_NORM + (c + 0.5) * bubbleSpacingH;
    const ny = AREA_Y0 + (qRow + 0.5) * bubbleSpacingV;
    return { nx, ny };
  }

  function labelX(q: number) {
    const qCol = Math.floor(q / questionsPerColumn);
    return (
      AREA_X0 + qCol * (colWidth + COL_GAP_NORM) + LABEL_WIDTH_NORM * 0.5
    );
  }

  return {
    questionCount,
    choiceCount,
    letters,
    questionColumns,
    questionsPerColumn,
    bubbleDiameterNorm,
    bubbleDiameterSheet: bubbleDiameterNorm * SHEET_W,
    colWidth,
    bubbleSpacingH,
    bubbleSpacingV,
    bubbleCenter,
    labelX,
  };
}

// ── Main draw ──
export interface SheetOpts {
  questionCount: number;
  choiceCount: 4 | 5;
  headerImageDataUrl?: string; // from fabric.js canvas
}

export function drawSheetToCanvas(
  canvas: HTMLCanvasElement,
  opts: SheetOpts,
): Promise<void> {
  return new Promise((resolve) => {
    const S = 3;
    const W = SHEET_W * S;
    const H = SHEET_H * S;
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d")!;

    // White bg
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, W, H);

    // Draw header image if provided
    const afterHeader = () => {
      // Registration marks (on top of everything)
      ctx.fillStyle = "#000";
      for (const m of MARKS) {
        ctx.fillRect(m.x * S, m.y * S, MARK_SIZE * S, MARK_SIZE * S);
      }
      const MID_SIZE = 10;
      const midOff = (MARK_SIZE - MID_SIZE) / 2;
      const midY = (SHEET_H - MID_SIZE) / 2;
      ctx.fillRect(
        (9.6 + midOff) * S,
        midY * S,
        MID_SIZE * S,
        MID_SIZE * S,
      );
      ctx.fillRect(
        (SHEET_W - 9.6 - MARK_SIZE + midOff) * S,
        midY * S,
        MID_SIZE * S,
        MID_SIZE * S,
      );

      // Answer section header
      const tableX = 32;
      ctx.fillStyle = "#222";
      ctx.font = `bold ${7 * S}px Arial`;
      ctx.textAlign = "left";
      ctx.fillText("ANSWER SECTION", tableX * S, 131 * S);

      ctx.fillStyle = "#888";
      ctx.font = `${4.5 * S}px Arial`;
      ctx.fillText(
        "Shade the circle of the correct answer completely.",
        tableX * S,
        136.5 * S,
      );

      // Bubble grid
      const layout = computeGridLayout(opts.questionCount, opts.choiceCount);
      const bubbleD = layout.bubbleDiameterSheet;
      const bubbleR = bubbleD / 2;
      const headerFontSize = Math.max(5, Math.min(8, bubbleD * 0.55));
      const labelFontSize = Math.max(5, Math.min(8, bubbleD * 0.55));

      // Column separators
      ctx.strokeStyle = "#ddd";
      ctx.lineWidth = 0.5 * S;
      for (let qCol = 1; qCol < layout.questionColumns; qCol++) {
        const colStartX =
          AREA_X0 +
          qCol * (layout.colWidth + COL_GAP_NORM) -
          COL_GAP_NORM / 2;
        const sx = colStartX * SHEET_W * S;
        ctx.beginPath();
        ctx.moveTo(sx, (AREA_Y0 * SHEET_H - 4) * S);
        ctx.lineTo(sx, (AREA_Y1 * SHEET_H + 2) * S);
        ctx.stroke();
      }

      // Column headers (A, B, C, D ...)
      ctx.fillStyle = "#222";
      ctx.font = `bold ${headerFontSize * S}px Arial`;
      ctx.textAlign = "center";
      for (let qCol = 0; qCol < layout.questionColumns; qCol++) {
        const q0 = qCol * layout.questionsPerColumn;
        for (let c = 0; c < layout.choiceCount; c++) {
          const { nx, ny } = layout.bubbleCenter(q0, c);
          ctx.fillText(
            layout.letters[c],
            nx * SHEET_W * S,
            (ny * SHEET_H - bubbleD - 1) * S,
          );
        }
      }

      // Bubbles
      for (let q = 0; q < opts.questionCount; q++) {
        ctx.fillStyle = "#444";
        ctx.font = `600 ${labelFontSize * S}px Arial`;
        ctx.textAlign = "right";
        const lx = layout.labelX(q) * SHEET_W;
        const { ny } = layout.bubbleCenter(q, 0);
        ctx.fillText(
          String(q + 1),
          (lx + 2) * S,
          (ny * SHEET_H + labelFontSize * 0.35) * S,
        );

        for (let c = 0; c < layout.choiceCount; c++) {
          const { nx, ny: by } = layout.bubbleCenter(q, c);
          const cx = nx * SHEET_W * S;
          const cy = by * SHEET_H * S;
          const r = bubbleR * S;
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.strokeStyle = "#333";
          ctx.lineWidth = 1.2 * S;
          ctx.stroke();
        }
      }

      // Barcode section
      ctx.strokeStyle = "#999";
      ctx.lineWidth = 0.5 * S;
      ctx.beginPath();
      ctx.moveTo(BARCODE_X0 * SHEET_W * S, BARCODE_LABEL_Y * SHEET_H * S);
      ctx.lineTo(BARCODE_X1 * SHEET_W * S, BARCODE_LABEL_Y * SHEET_H * S);
      ctx.stroke();

      ctx.fillStyle = "#222";
      ctx.font = `bold ${5 * S}px Arial`;
      ctx.textAlign = "left";
      ctx.fillText(
        "STUDENT NO.",
        BARCODE_X0 * SHEET_W * S,
        (BARCODE_LABEL_Y * SHEET_H - 3) * S,
      );

      // Empty barcode placeholder
      ctx.strokeStyle = "#ccc";
      ctx.lineWidth = 0.5 * S;
      ctx.setLineDash([3 * S, 3 * S]);
      ctx.strokeRect(
        BARCODE_X0 * SHEET_W * S,
        BARCODE_Y0 * SHEET_H * S,
        (BARCODE_X1 - BARCODE_X0) * SHEET_W * S,
        (BARCODE_Y1 - BARCODE_Y0) * SHEET_H * S,
      );
      ctx.setLineDash([]);

      // Footer
      const tableW = SHEET_W - 64;
      ctx.strokeStyle = "#000";
      ctx.lineWidth = 1.5 * S;
      ctx.beginPath();
      ctx.moveTo(tableX * S, (SHEET_H - 22) * S);
      ctx.lineTo((tableX + tableW) * S, (SHEET_H - 22) * S);
      ctx.stroke();

      ctx.fillStyle = "#888";
      ctx.font = `${4.5 * S}px Arial`;
      ctx.textAlign = "center";
      ctx.fillText("GradeSnap", (SHEET_W / 2) * S, (SHEET_H - 16) * S);
      ctx.font = `${4 * S}px Arial`;
      ctx.fillText(
        `${opts.questionCount} items · Do not reproduce without permission`,
        (SHEET_W / 2) * S,
        (SHEET_H - 10) * S,
      );
      ctx.textAlign = "left";

      resolve();
    };

    // If header image provided, draw it first then continue
    if (opts.headerImageDataUrl) {
      const img = new Image();
      img.onload = () => {
        // Header zone: (20, 20) to (300, 140) in sheet coords → at 3x scale
        const hx = 20 * S;
        const hy = 20 * S;
        const hw = 280 * S; // HEADER_WIDTH * S
        const hh = 120 * S; // HEADER_HEIGHT * S
        ctx.drawImage(img, hx, hy, hw, hh);
        afterHeader();
      };
      img.src = opts.headerImageDataUrl;
    } else {
      afterHeader();
    }
  });
}

export async function generatePdf(
  headerDataUrl: string,
  questionCount: number,
  choiceCount: 4 | 5,
): Promise<void> {
  const { jsPDF } = await import("jspdf");

  const offscreen = document.createElement("canvas");
  await drawSheetToCanvas(offscreen, {
    questionCount,
    choiceCount,
    headerImageDataUrl: headerDataUrl,
  });

  const imgData = offscreen.toDataURL("image/png");

  // Letter size: 612 x 792 pt
  const pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: "letter" });
  const pageW = 612;
  const pageH = 792;
  const imgW = offscreen.width;
  const imgH = offscreen.height;

  // Scale to fit page
  const scale = Math.min(pageW / imgW, pageH / imgH);
  const drawW = imgW * scale;
  const drawH = imgH * scale;
  const offsetX = (pageW - drawW) / 2;
  const offsetY = (pageH - drawH) / 2;

  pdf.addImage(imgData, "PNG", offsetX, offsetY, drawW, drawH);
  pdf.save("answer-sheet.pdf");
}
