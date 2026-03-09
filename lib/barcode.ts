/**
 * barcode.ts
 *
 * Code 128B encoder/decoder for student ID barcodes on answer sheets.
 * Zero external dependencies — uses the standard Code 128 specification.
 *
 * Binary patterns sourced from ISO/IEC 15417 (Code 128 specification).
 */

// ── Barcode region constants (normalized sheet coordinates) ──────────────────
export const BARCODE_X0 = 0.20;
export const BARCODE_X1 = 0.80;
export const BARCODE_Y0 = 0.88;
export const BARCODE_Y1 = 0.91;
export const BARCODE_LABEL_Y = 0.875;

// ── Code 128 binary patterns (authoritative source) ─────────────────────────
// Each string is the 11-module binary pattern (1=bar, 0=space) for that value.
// Values 0-102: data/function symbols. 103-105: start codes.
const BINARY = [
  "11011001100", //   0: SP
  "11001101100", //   1: !
  "11001100110", //   2: "
  "10010011000", //   3: #
  "10010001100", //   4: $
  "10001001100", //   5: %
  "10011001000", //   6: &
  "10011000100", //   7: '
  "10001100100", //   8: (
  "11001001000", //   9: )
  "11001000100", //  10: *
  "11000100100", //  11: +
  "10110011100", //  12: ,
  "10011011100", //  13: -
  "10011001110", //  14: .
  "10111001100", //  15: /
  "10011101100", //  16: 0
  "10011100110", //  17: 1
  "11001110010", //  18: 2
  "11001011100", //  19: 3
  "11001001110", //  20: 4
  "11011100100", //  21: 5
  "11001110100", //  22: 6
  "11101101110", //  23: 7
  "11101001100", //  24: 8
  "11100101100", //  25: 9
  "11100100110", //  26: :
  "11101100100", //  27: ;
  "11100110100", //  28: <
  "11100110010", //  29: =
  "11011011000", //  30: >
  "11011000110", //  31: ?
  "11000110110", //  32: @
  "10100011000", //  33: A
  "10001011000", //  34: B
  "10001000110", //  35: C
  "10110001000", //  36: D
  "10001101000", //  37: E
  "10001100010", //  38: F
  "11010001000", //  39: G
  "11000101000", //  40: H
  "11000100010", //  41: I
  "10110111000", //  42: J
  "10110001110", //  43: K
  "10001101110", //  44: L
  "10111011000", //  45: M
  "10111000110", //  46: N
  "10001110110", //  47: O
  "11101110110", //  48: P
  "11010001110", //  49: Q
  "11000101110", //  50: R
  "11011101000", //  51: S
  "11011100010", //  52: T
  "11011101110", //  53: U
  "11101011000", //  54: V
  "11101000110", //  55: W
  "11100010110", //  56: X
  "11101101000", //  57: Y
  "11101100010", //  58: Z
  "11100011010", //  59: [
  "11101111010", //  60: backslash
  "11001000010", //  61: ]
  "11110001010", //  62: ^
  "10100110000", //  63: _
  "10100001100", //  64: `
  "10010110000", //  65: a
  "10010000110", //  66: b
  "10000101100", //  67: c
  "10000100110", //  68: d
  "10110010000", //  69: e
  "10110000100", //  70: f
  "10011010000", //  71: g
  "10011000010", //  72: h
  "10000110100", //  73: i
  "10000110010", //  74: j
  "11000010010", //  75: k
  "11001010000", //  76: l
  "11110111010", //  77: m
  "11000010100", //  78: n
  "10001111010", //  79: o
  "10100111100", //  80: p
  "10010111100", //  81: q
  "10010011110", //  82: r
  "10111100100", //  83: s
  "10011110100", //  84: t
  "10011110010", //  85: u
  "11110100100", //  86: v
  "11110010100", //  87: w
  "11110010010", //  88: x
  "11011011110", //  89: y
  "11011110110", //  90: z
  "11110110110", //  91: {
  "10101111000", //  92: |
  "10100011110", //  93: }
  "10001011110", //  94: ~
  "10111101000", //  95: DEL
  "10111100010", //  96: FNC 3
  "11110101000", //  97: FNC 2
  "11110100010", //  98: SHIFT
  "10111011110", //  99: Code C
  "10111101110", // 100: Code B / FNC 4
  "11101011110", // 101: Code A / FNC 1
  "11110101110", // 102: FNC 1
  "11010000100", // 103: Start A
  "11010010000", // 104: Start B
  "11010011100", // 105: Start C
];

// Stop: 13 modules (7 elements) — includes termination bar
const STOP_BINARY = "1100011101011";

// ── Derive bar/space width patterns from binary strings ─────────────────────

function binaryToWidths(bin: string): number[] {
  const widths: number[] = [];
  let i = 0;
  while (i < bin.length) {
    const ch = bin[i];
    let run = 0;
    while (i < bin.length && bin[i] === ch) { run++; i++; }
    widths.push(run);
  }
  return widths;
}

const PATTERNS: number[][] = BINARY.map(binaryToWidths);
const STOP_PATTERN: number[] = binaryToWidths(STOP_BINARY);

// ── Encoder ─────────────────────────────────────────────────────────────────

/**
 * Encode a string as Code 128B bar/space widths.
 * Returns flat array of alternating widths: [bar, space, bar, space, ...].
 * Starts with a bar (black), alternates.
 */
export function encodeCode128B(text: string): number[] {
  const START_B = 104;
  let checksum = START_B;
  const symbols: number[][] = [PATTERNS[START_B]];

  for (let i = 0; i < text.length; i++) {
    const val = text.charCodeAt(i) - 32;
    if (val < 0 || val > 94) continue; // skip unprintable
    symbols.push(PATTERNS[val]);
    checksum += (i + 1) * val;
  }

  symbols.push(PATTERNS[checksum % 103]);
  symbols.push(STOP_PATTERN);

  return symbols.flat();
}

/**
 * Expand bar widths to a boolean array (true = black, false = white).
 * Includes quiet zones on each side.
 */
export function barWidthsToModules(widths: number[], quietUnits = 10): boolean[] {
  const modules: boolean[] = [];
  for (let i = 0; i < quietUnits; i++) modules.push(false);
  let isBar = true;
  for (const w of widths) {
    for (let i = 0; i < w; i++) modules.push(isBar);
    isBar = !isBar;
  }
  for (let i = 0; i < quietUnits; i++) modules.push(false);
  return modules;
}

// ── Decoder ─────────────────────────────────────────────────────────────────

function patternKey(p: number[]): string {
  return p.join(",");
}

// Precompute reverse lookup: key → value
const PATTERN_LOOKUP = new Map<string, number>();
for (let i = 0; i < PATTERNS.length; i++) {
  PATTERN_LOOKUP.set(patternKey(PATTERNS[i]), i);
}

/**
 * Decode Code 128B from run-length encoded bar widths.
 * `runs` is an array of alternating bar/space pixel widths, starting with a bar.
 * Returns the decoded string or null on failure.
 */
export function decodeCode128B(runs: number[]): string | null {
  if (runs.length < 6 * 3 + 7) return null; // start + 1 char + checksum + stop = 25 elements min
  return tryDecode(runs) ?? tryDecode([...runs].reverse());
}

function tryDecode(runs: number[]): string | null {
  // Stop has 7 elements; all others have 6.
  // Total: 6 * numSymbols + 7
  if ((runs.length - 7) % 6 !== 0) return null;
  const numSymbols = (runs.length - 7) / 6;
  if (numSymbols < 3) return null; // start + 1 data + checksum minimum

  // Try two calibration strategies for unit width:
  // 1. From start symbol (first 6 runs = 11 units)
  // 2. From total barcode (all runs = 11*numSymbols + 13 units)
  const startPixels = runs.slice(0, 6).reduce((a, b) => a + b, 0);
  const totalPixels = runs.reduce((a, b) => a + b, 0);
  const totalUnits = 11 * numSymbols + 13;
  const calibrations = [startPixels / 11, totalPixels / totalUnits];

  for (const unitWidth of calibrations) {
    if (unitWidth <= 0) continue;
    const result = tryDecodeWithUnit(runs, numSymbols, unitWidth);
    if (result !== null) return result;
  }
  return null;
}

function tryDecodeWithUnit(
  runs: number[],
  numSymbols: number,
  unitWidth: number,
): string | null {
  // Quantize all runs to integer units (clamp to valid Code 128 range 1–4)
  const quantized: number[] = [];
  for (const r of runs) {
    const raw = Math.round(r / unitWidth);
    if (raw < 1 || raw > 4) return null;
    quantized.push(raw);
  }

  // Verify stop pattern (last 7 elements)
  const stopSlice = quantized.slice(-7);
  if (stopSlice.join(",") !== STOP_PATTERN.join(",")) return null;

  // Decode symbols (6 elements each, excluding stop)
  const symbols: number[] = [];
  for (let i = 0; i < numSymbols; i++) {
    const pattern = quantized.slice(i * 6, (i + 1) * 6);
    const val = PATTERN_LOOKUP.get(patternKey(pattern));
    if (val === undefined) return null;
    symbols.push(val);
  }

  // First symbol must be Start B (104)
  if (symbols[0] !== 104) return null;

  // Verify checksum
  let checksum = symbols[0];
  for (let i = 1; i < symbols.length - 1; i++) {
    checksum += i * symbols[i];
  }
  if (symbols[symbols.length - 1] !== checksum % 103) return null;

  // Extract data characters (skip start, exclude checksum)
  const data = symbols.slice(1, -1);
  return data.map((v) => String.fromCharCode(v + 32)).join("");
}
