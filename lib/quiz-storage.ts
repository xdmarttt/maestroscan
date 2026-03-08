import AsyncStorage from "@react-native-async-storage/async-storage";

export type ChoiceLetter = "A" | "B" | "C" | "D" | "E";

export interface QuizQuestion {
  id: number;
  text: string;
  choices: string[]; // ["A. ...", "B. ...", "C. ...", "D. ..."] or 5 choices
  correct: ChoiceLetter;
}

export interface QuizConfig {
  id: string;
  questions: QuizQuestion[];
  choiceCount: 4 | 5;
  createdAt: number;
}

export interface StudentRoster {
  students: string[];
}

const QUIZ_KEY = "gradesnap:quiz_config";
const ROSTER_KEY = "gradesnap:student_roster";

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export const DEFAULT_QUIZ: QuizConfig = {
  id: generateId(),
  choiceCount: 4,
  questions: [
    {
      id: 1,
      text: "What is the capital of France?",
      choices: ["A. Paris", "B. London", "C. Berlin", "D. Madrid"],
      correct: "A",
    },
    {
      id: 2,
      text: "What is 7 × 8?",
      choices: ["A. 54", "B. 56", "C. 58", "D. 62"],
      correct: "B",
    },
    {
      id: 3,
      text: "Which planet is closest to the Sun?",
      choices: ["A. Earth", "B. Venus", "C. Mars", "D. Mercury"],
      correct: "D",
    },
    {
      id: 4,
      text: "What is the chemical symbol for water?",
      choices: ["A. O2", "B. H2O", "C. CO2", "D. NaCl"],
      correct: "B",
    },
    {
      id: 5,
      text: "How many sides does a hexagon have?",
      choices: ["A. 5", "B. 7", "C. 8", "D. 6"],
      correct: "D",
    },
  ],
  createdAt: 0,
};

export async function loadQuiz(): Promise<QuizConfig> {
  try {
    const raw = await AsyncStorage.getItem(QUIZ_KEY);
    if (!raw) return DEFAULT_QUIZ;
    const parsed = JSON.parse(raw) as QuizConfig;
    // Migration: old configs lack choiceCount or id
    if (!parsed.choiceCount) parsed.choiceCount = 4;
    if (!parsed.id) parsed.id = generateId();
    return parsed;
  } catch {
    return DEFAULT_QUIZ;
  }
}

export async function saveQuiz(config: QuizConfig): Promise<void> {
  await AsyncStorage.setItem(QUIZ_KEY, JSON.stringify(config));
}

export async function loadRoster(): Promise<StudentRoster> {
  try {
    const raw = await AsyncStorage.getItem(ROSTER_KEY);
    if (!raw) return { students: [] };
    return JSON.parse(raw) as StudentRoster;
  } catch {
    return { students: [] };
  }
}

export async function saveRoster(roster: StudentRoster): Promise<void> {
  await AsyncStorage.setItem(ROSTER_KEY, JSON.stringify(roster));
}
