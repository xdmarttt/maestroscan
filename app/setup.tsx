import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  Pressable,
  Platform,
} from "react-native";
import { router } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeInDown } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/lib/theme-context";
import {
  loadQuiz,
  saveQuiz,
  loadRoster,
  QuizQuestion,
  ChoiceLetter,
  DEFAULT_QUIZ,
} from "@/lib/quiz-storage";

const LETTERS_4 = ["A", "B", "C", "D"] as const;
const LETTERS_5 = ["A", "B", "C", "D", "E"] as const;

function makeQuestion(id: number, choiceCount: 4 | 5): QuizQuestion {
  const letters = choiceCount === 5 ? LETTERS_5 : LETTERS_4;
  return {
    id,
    text: "",
    choices: letters.map((l) => `${l}. `),
    correct: "A",
  };
}

/** Full editor card for ≤10 questions */
function QuestionEditor({
  question,
  index,
  letters,
  onChange,
}: {
  question: QuizQuestion;
  index: number;
  letters: readonly string[];
  onChange: (q: QuizQuestion) => void;
}) {
  const colors = useColors();
  return (
    <Animated.View
      entering={FadeInDown.duration(400).delay(index * 60)}
      style={[
        styles.questionCard,
        { backgroundColor: colors.surface, borderColor: colors.border },
      ]}
    >
      <Text style={[styles.questionLabel, { color: colors.accent }]}>
        Question {question.id}
      </Text>
      <TextInput
        style={[
          styles.textInput,
          {
            backgroundColor: colors.surfaceElevated,
            borderColor: colors.border,
            color: colors.textPrimary,
          },
        ]}
        value={question.text}
        onChangeText={(t) => onChange({ ...question, text: t })}
        placeholder="Enter question text..."
        placeholderTextColor={colors.textMuted}
        multiline
        returnKeyType="done"
        blurOnSubmit
      />
      <Text style={[styles.answerLabel, { color: colors.textSecondary }]}>
        Correct Answer
      </Text>
      <View style={styles.choiceRow}>
        {letters.map((letter) => (
          <Pressable
            key={letter}
            onPress={() => {
              Haptics.selectionAsync();
              onChange({ ...question, correct: letter as ChoiceLetter });
            }}
            style={({ pressed }) => [
              styles.choiceBubble,
              {
                borderColor: colors.border,
                backgroundColor: colors.surfaceElevated,
              },
              question.correct === letter && {
                borderColor: colors.accent,
                backgroundColor: colors.accentDim,
              },
              pressed && { opacity: 0.75 },
            ]}
          >
            <Text
              style={[
                styles.choiceLetter,
                { color: colors.textMuted },
                question.correct === letter && { color: colors.accent },
              ]}
            >
              {letter}
            </Text>
          </Pressable>
        ))}
      </View>
    </Animated.View>
  );
}

/** Compact answer-key row for >10 questions (simple mode) */
function SimpleRow({
  question,
  letters,
  onChange,
}: {
  question: QuizQuestion;
  letters: readonly string[];
  onChange: (q: QuizQuestion) => void;
}) {
  const colors = useColors();
  return (
    <View style={styles.simpleRow}>
      <Text style={[styles.simpleNum, { color: colors.textSecondary }]}>
        {question.id}.
      </Text>
      {letters.map((letter) => (
        <Pressable
          key={letter}
          onPress={() => {
            Haptics.selectionAsync();
            onChange({ ...question, correct: letter as ChoiceLetter });
          }}
          style={({ pressed }) => [
            styles.simpleBubble,
            {
              borderColor: colors.border,
              backgroundColor: colors.surfaceElevated,
            },
            question.correct === letter && {
              borderColor: colors.accent,
              backgroundColor: colors.accentDim,
            },
            pressed && { opacity: 0.75 },
          ]}
        >
          <Text
            style={[
              styles.simpleLetter,
              { color: colors.textMuted },
              question.correct === letter && { color: colors.accent },
            ]}
          >
            {letter}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

export default function SetupScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const [questions, setQuestions] = useState<QuizQuestion[]>(DEFAULT_QUIZ.questions);
  const [choiceCount, setChoiceCount] = useState<4 | 5>(DEFAULT_QUIZ.choiceCount);
  const [quizId, setQuizId] = useState(DEFAULT_QUIZ.id);
  const [loaded, setLoaded] = useState(false);
  const [students, setStudents] = useState<string[]>([]);

  const letters = choiceCount === 5 ? LETTERS_5 : LETTERS_4;
  const questionCount = questions.length;
  const simpleMode = questionCount > 10;

  useEffect(() => {
    loadQuiz().then((config) => {
      setQuestions(config.questions);
      setChoiceCount(config.choiceCount);
      setQuizId(config.id);
      setLoaded(true);
    });
  }, []);

  // Reload roster when returning from students screen
  useFocusEffect(
    React.useCallback(() => {
      loadRoster().then((r) => setStudents(r.students));
    }, [])
  );

  const setQuestionCount = (count: number) => {
    const clamped = Math.max(1, Math.min(100, count));
    setQuestions((prev) => {
      if (clamped === prev.length) return prev;
      if (clamped < prev.length) return prev.slice(0, clamped);
      const added = Array.from({ length: clamped - prev.length }, (_, i) =>
        makeQuestion(prev.length + i + 1, choiceCount)
      );
      return [...prev, ...added];
    });
  };

  const handleChoiceToggle = () => {
    const next: 4 | 5 = choiceCount === 4 ? 5 : 4;
    Haptics.selectionAsync();
    setChoiceCount(next);
    const nextLetters = next === 5 ? LETTERS_5 : LETTERS_4;
    setQuestions((prev) =>
      prev.map((q) => ({
        ...q,
        choices: nextLetters.map((l) => `${l}. `),
        correct: q.correct === "E" && next === 4 ? "A" : q.correct,
      }))
    );
  };

  const updateQuestion = (index: number, updated: QuizQuestion) => {
    setQuestions((prev) => {
      const next = [...prev];
      next[index] = updated;
      return next;
    });
  };

  const currentConfig = () => ({ id: quizId, questions, choiceCount, createdAt: Date.now() });

  const handleSave = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await saveQuiz(currentConfig());
    router.back();
  };

  const navigateToSheet = async () => {
    await saveQuiz(currentConfig());
    router.push({
      pathname: "/sheet",
      params: {
        questions: JSON.stringify(questions),
        choiceCount: String(choiceCount),
      },
    });
  };

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  return (
    <View style={[styles.container, { paddingTop: topPad, backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.6 }]}
        >
          <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
        </Pressable>
        <Text style={[styles.title, { color: colors.textPrimary }]}>Quiz Setup</Text>
        <Pressable
          onPress={navigateToSheet}
          style={({ pressed }) => [
            styles.sheetBtn,
            { backgroundColor: colors.accentDim, borderColor: colors.accent },
            pressed && { opacity: 0.6 },
          ]}
        >
          <Ionicons name="document-outline" size={20} color={colors.accent} />
          <Text style={[styles.sheetBtnText, { color: colors.accent }]}>Sheet</Text>
        </Pressable>
      </View>

      {/* Config bar: question count + choice count */}
      <View style={styles.configBar}>
        {/* Question count stepper */}
        <View style={styles.configItem}>
          <Text style={[styles.configLabel, { color: colors.textSecondary }]}>Questions</Text>
          <View
            style={[
              styles.stepper,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <Pressable
              onPress={() => { Haptics.selectionAsync(); setQuestionCount(questionCount - 1); }}
              style={({ pressed }) => [styles.stepBtn, pressed && { opacity: 0.6 }]}
            >
              <Ionicons name="remove" size={18} color={colors.textPrimary} />
            </Pressable>
            <TextInput
              style={[styles.stepValue, { color: colors.textPrimary }]}
              value={String(questionCount)}
              onChangeText={(t) => {
                const n = parseInt(t, 10);
                if (!isNaN(n)) setQuestionCount(n);
              }}
              keyboardType="number-pad"
              selectTextOnFocus
              maxLength={3}
            />
            <Pressable
              onPress={() => { Haptics.selectionAsync(); setQuestionCount(questionCount + 1); }}
              style={({ pressed }) => [styles.stepBtn, pressed && { opacity: 0.6 }]}
            >
              <Ionicons name="add" size={18} color={colors.textPrimary} />
            </Pressable>
          </View>
        </View>

        {/* Choice count toggle */}
        <View style={styles.configItem}>
          <Text style={[styles.configLabel, { color: colors.textSecondary }]}>Choices</Text>
          <Pressable
            onPress={handleChoiceToggle}
            style={({ pressed }) => [
              styles.choiceToggle,
              { backgroundColor: colors.surface, borderColor: colors.border },
              pressed && { opacity: 0.6 },
            ]}
          >
            <Text style={[styles.choiceToggleText, { color: colors.accent }]}>
              A–{choiceCount === 4 ? "D" : "E"}
            </Text>
          </Pressable>
        </View>

        {/* Students button */}
        <View style={[styles.configItem, { marginLeft: "auto" }]}>
          <Text style={[styles.configLabel, { color: colors.textSecondary }]}>Students</Text>
          <Pressable
            onPress={() => router.push("/students")}
            style={({ pressed }) => [
              styles.choiceToggle,
              { backgroundColor: colors.surface, borderColor: colors.border },
              pressed && { opacity: 0.6 },
            ]}
          >
            <Text style={[styles.choiceToggleText, { color: colors.accent }]}>
              {students.length || "0"}
            </Text>
          </Pressable>
        </View>
      </View>

      <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
        {simpleMode
          ? `Set the answer key for ${questionCount} questions.`
          : `Set ${questionCount} question${questionCount > 1 ? "s" : ""} and mark the correct answer.`}
      </Text>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: bottomPad + 100 }]}
        keyboardShouldPersistTaps="handled"
      >
        {simpleMode
          ? questions.map((q, i) => (
              <SimpleRow
                key={q.id}
                question={q}
                letters={letters}
                onChange={(updated) => updateQuestion(i, updated)}
              />
            ))
          : questions.map((q, i) => (
              <QuestionEditor
                key={q.id}
                question={q}
                index={i}
                letters={letters}
                onChange={(updated) => updateQuestion(i, updated)}
              />
            ))}
      </ScrollView>

      {/* Save button */}
      <View
        style={[
          styles.footer,
          {
            paddingBottom: bottomPad + 16,
            backgroundColor: colors.surface,
            borderColor: colors.border,
          },
        ]}
      >
        <Pressable
          onPress={handleSave}
          style={({ pressed }) => [
            styles.saveBtn,
            { backgroundColor: colors.accent },
            pressed && { opacity: 0.85 },
          ]}
        >
          <Ionicons name="checkmark-circle" size={20} color={colors.background} />
          <Text style={[styles.saveBtnText, { color: colors.background }]}>Save & Go Back</Text>
        </Pressable>
      </View>

    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  backBtn: {
    padding: 4,
  },
  title: {
    flex: 1,
    fontSize: 20,
    fontFamily: "Inter_700Bold",
  },
  sheetBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  sheetBtnText: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },
  configBar: {
    flexDirection: "row",
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 16,
    alignItems: "center",
  },
  configItem: {
    gap: 4,
  },
  configLabel: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  stepper: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 10,
    borderWidth: 1,
  },
  stepBtn: {
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  stepValue: {
    minWidth: 40,
    textAlign: "center",
    fontSize: 16,
    fontFamily: "Inter_700Bold",
    paddingVertical: 6,
  },
  choiceToggle: {
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  choiceToggleText: {
    fontSize: 15,
    fontFamily: "Inter_700Bold",
  },
  subtitle: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    paddingHorizontal: 20,
    marginBottom: 8,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    gap: 14,
  },
  questionCard: {
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    gap: 10,
  },
  questionLabel: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  textInput: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    minHeight: 44,
  },
  answerLabel: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
  },
  choiceRow: {
    flexDirection: "row",
    gap: 10,
  },
  choiceBubble: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  choiceLetter: {
    fontSize: 16,
    fontFamily: "Inter_700Bold",
  },
  // Simple mode (>10 questions)
  simpleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 4,
  },
  simpleNum: {
    width: 32,
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    textAlign: "right",
    marginRight: 4,
  },
  simpleBubble: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  simpleLetter: {
    fontSize: 14,
    fontFamily: "Inter_700Bold",
  },
  footer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: 1,
  },
  saveBtn: {
    borderRadius: 14,
    paddingVertical: 15,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  saveBtnText: {
    fontSize: 16,
    fontFamily: "Inter_700Bold",
  },
});
