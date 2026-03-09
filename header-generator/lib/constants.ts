// Answer sheet dimensions (from sheet-generator.html)
export const SHEET_W = 320;
export const SHEET_H = 450;

// Header zone: from top to just above bubble grid
// Bubble grid starts at AREA_Y0 = 0.33 normalized → Y = 148.5
// Corner marks are at Y=10, so usable header starts ~Y=20
export const HEADER_Y_START = 20;
export const HEADER_Y_END = 140; // leave ~8px gap before grid
export const HEADER_HEIGHT = HEADER_Y_END - HEADER_Y_START; // 120
export const HEADER_WIDTH = SHEET_W - 40; // 280 (20px margin each side for corner marks)

// Canvas display size (scaled up for editing)
export const CANVAS_SCALE = 3;
export const CANVAS_DISPLAY_W = HEADER_WIDTH * CANVAS_SCALE; // 840
export const CANVAS_DISPLAY_H = HEADER_HEIGHT * CANVAS_SCALE; // 360

// Dynamic placeholder tokens → sample preview values shown in PDF
export const PLACEHOLDER_PREVIEWS: Record<string, string> = {
  student_name: "Juan Dela Cruz",
  student_id: "2015-10833",
  student_no: "2015-10833",
  section: "Gr.7 – Einstein",
  grade_section: "Gr.7 – Einstein",
  date: "Mar 9, 2026",
  score: "48",
  teacher: "Ms. Garcia",
  subject: "Mathematics 7",
  quarter: "Q3",
  quiz_title: "Algebraic Expressions Quiz",
  total_points: "50",
};
