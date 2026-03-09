import { CANVAS_DISPLAY_W } from "./constants";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ObjConfig = Record<string, any>;

export interface Template {
  id: string;
  name: string;
  description: string;
  objects: () => ObjConfig[];
}

const FONT = "Arial, sans-serif";
const W = CANVAS_DISPLAY_W; // 840
const PAD = 20; // left/right padding
const CONTENT_W = W - PAD * 2; // 800

export const templates: Template[] = [
  {
    id: "classic",
    name: "Classic",
    description: "School name, quiz title, fields, student info",
    objects: () => [
      {
        type: "textbox",
        text: "School Name",
        left: PAD, top: 10, width: CONTENT_W,
        fontSize: 28, fontWeight: "bold", fontFamily: FONT,
        fill: "#000000", textAlign: "center",
      },
      {
        type: "textbox",
        text: "QUIZ",
        left: PAD, top: 46, width: CONTENT_W,
        fontSize: 36, fontWeight: "bold", fontFamily: FONT,
        fill: "#000000", textAlign: "center",
      },
      {
        type: "textbox",
        text: "Subject: ____________    Quarter: ______    Grade & Section: ____________",
        left: PAD, top: 100, width: CONTENT_W,
        fontSize: 14, fontFamily: FONT, fill: "#000000", textAlign: "left",
      },
      {
        type: "textbox",
        text: "Teacher: ____________    Date: ____________    Total Points: ______",
        left: PAD, top: 125, width: CONTENT_W,
        fontSize: 14, fontFamily: FONT, fill: "#000000", textAlign: "left",
      },
      {
        type: "textbox",
        text: "Student Information",
        left: PAD, top: 165, width: 200,
        fontSize: 15, fontWeight: "bold", fontFamily: FONT,
        fill: "#000000", textAlign: "left",
      },
      {
        type: "textbox",
        text: "Name: ____________________________________",
        left: PAD, top: 192, width: 460,
        fontSize: 14, fontFamily: FONT, fill: "#000000", textAlign: "left",
      },
      {
        type: "textbox",
        text: "Student No.: ______________",
        left: 500, top: 192, width: 320,
        fontSize: 14, fontFamily: FONT, fill: "#000000", textAlign: "left",
      },
      {
        type: "textbox",
        text: "Score: ________ / ________",
        left: PAD, top: 222, width: 300,
        fontSize: 14, fontFamily: FONT, fill: "#000000", textAlign: "left",
      },
      {
        type: "textbox",
        text: "──────────────────────────────────────────────────────────────────────────────",
        left: PAD, top: 270, width: CONTENT_W,
        fontSize: 10, fontFamily: FONT, fill: "#999999", textAlign: "center",
      },
    ],
  },
  {
    id: "minimal",
    name: "Minimal",
    description: "Clean and simple — just name, date, score",
    objects: () => [
      {
        type: "textbox",
        text: "ANSWER SHEET",
        left: PAD, top: 30, width: CONTENT_W,
        fontSize: 32, fontWeight: "bold", fontFamily: FONT,
        fill: "#000000", textAlign: "center",
      },
      {
        type: "textbox",
        text: "Name: ______________________________________________       Date: ________________",
        left: PAD, top: 110, width: CONTENT_W,
        fontSize: 14, fontFamily: FONT, fill: "#000000", textAlign: "left",
      },
      {
        type: "textbox",
        text: "Section: ______________________       Score: ________ / ________",
        left: PAD, top: 145, width: CONTENT_W,
        fontSize: 14, fontFamily: FONT, fill: "#000000", textAlign: "left",
      },
      {
        type: "textbox",
        text: "──────────────────────────────────────────────────────────────────────────────",
        left: PAD, top: 270, width: CONTENT_W,
        fontSize: 10, fontFamily: FONT, fill: "#999999", textAlign: "center",
      },
    ],
  },
  {
    id: "formal",
    name: "Formal",
    description: "Institutional style with logo placeholder",
    objects: () => [
      {
        type: "textbox",
        text: "[LOGO]",
        left: PAD, top: 10, width: 80,
        fontSize: 12, fontFamily: FONT,
        fill: "#aaaaaa", textAlign: "center",
        backgroundColor: "#f0f0f0",
      },
      {
        type: "textbox",
        text: "Republic of the Philippines\nDepartment of Education\nSchool Name Here",
        left: 120, top: 8, width: 600,
        fontSize: 13, fontFamily: FONT,
        fill: "#000000", textAlign: "center",
      },
      {
        type: "textbox",
        text: "QUARTERLY EXAMINATION",
        left: 120, top: 72, width: 600,
        fontSize: 22, fontWeight: "bold", fontFamily: FONT,
        fill: "#000000", textAlign: "center",
      },
      {
        type: "textbox",
        text: "Subject: __________________    Grade & Section: __________________",
        left: PAD, top: 130, width: CONTENT_W,
        fontSize: 14, fontFamily: FONT, fill: "#000000", textAlign: "left",
      },
      {
        type: "textbox",
        text: "Name: ______________________________________    Date: ________________",
        left: PAD, top: 162, width: CONTENT_W,
        fontSize: 14, fontFamily: FONT, fill: "#000000", textAlign: "left",
      },
      {
        type: "textbox",
        text: "Teacher: ________________________    Score: ________ / ________",
        left: PAD, top: 194, width: CONTENT_W,
        fontSize: 14, fontFamily: FONT, fill: "#000000", textAlign: "left",
      },
      {
        type: "textbox",
        text: "──────────────────────────────────────────────────────────────────────────────",
        left: PAD, top: 270, width: CONTENT_W,
        fontSize: 10, fontFamily: FONT, fill: "#999999", textAlign: "center",
      },
    ],
  },
  {
    id: "compact",
    name: "Compact",
    description: "Two-column layout — fits more info in less space",
    objects: () => [
      {
        type: "textbox",
        text: "ANSWER SHEET",
        left: PAD, top: 14, width: 300,
        fontSize: 24, fontWeight: "bold", fontFamily: FONT,
        fill: "#000000", textAlign: "left",
      },
      {
        type: "textbox",
        text: "Subject: __________________\nQuarter: __________\nTeacher: __________________",
        left: 440, top: 10, width: 380,
        fontSize: 12, fontFamily: FONT, fill: "#555555", textAlign: "left",
      },
      {
        type: "textbox",
        text: "──────────────────────────────────────────────────────────────────────────────",
        left: PAD, top: 80, width: CONTENT_W,
        fontSize: 8, fontFamily: FONT, fill: "#cccccc", textAlign: "center",
      },
      {
        type: "textbox",
        text: "Name: _________________________________    No.: __________    Score: ______ / ______",
        left: PAD, top: 105, width: CONTENT_W,
        fontSize: 14, fontFamily: FONT, fill: "#000000", textAlign: "left",
      },
      {
        type: "textbox",
        text: "Section: _________________________________    Date: ______________________",
        left: PAD, top: 138, width: CONTENT_W,
        fontSize: 14, fontFamily: FONT, fill: "#000000", textAlign: "left",
      },
      {
        type: "textbox",
        text: "──────────────────────────────────────────────────────────────────────────────",
        left: PAD, top: 270, width: CONTENT_W,
        fontSize: 10, fontFamily: FONT, fill: "#999999", textAlign: "center",
      },
    ],
  },
  {
    id: "blank",
    name: "Blank",
    description: "Empty canvas — start from scratch",
    objects: () => [],
  },
];
