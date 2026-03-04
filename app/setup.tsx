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
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeInDown } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";
import Colors from "@/constants/colors";
import {
  loadQuiz,
  saveQuiz,
  QuizQuestion,
  DEFAULT_QUIZ,
} from "@/lib/quiz-storage";

const LETTERS = ["A", "B", "C", "D"] as const;

function QuestionEditor({
  question,
  index,
  onChange,
}: {
  question: QuizQuestion;
  index: number;
  onChange: (q: QuizQuestion) => void;
}) {
  return (
    <Animated.View
      entering={FadeInDown.duration(400).delay(index * 60)}
      style={styles.questionCard}
    >
      <Text style={styles.questionLabel}>Question {question.id}</Text>
      <TextInput
        style={styles.textInput}
        value={question.text}
        onChangeText={(t) => onChange({ ...question, text: t })}
        placeholder="Enter question text..."
        placeholderTextColor={Colors.textMuted}
        multiline
        returnKeyType="done"
        blurOnSubmit
      />
      <Text style={styles.answerLabel}>Correct Answer</Text>
      <View style={styles.choiceRow}>
        {LETTERS.map((letter) => (
          <Pressable
            key={letter}
            onPress={() => {
              Haptics.selectionAsync();
              onChange({ ...question, correct: letter });
            }}
            style={({ pressed }) => [
              styles.choiceBubble,
              question.correct === letter && styles.choiceBubbleSelected,
              pressed && { opacity: 0.75 },
            ]}
          >
            <Text
              style={[
                styles.choiceLetter,
                question.correct === letter && styles.choiceLetterSelected,
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

export default function SetupScreen() {
  const insets = useSafeAreaInsets();
  const [questions, setQuestions] = useState<QuizQuestion[]>(
    DEFAULT_QUIZ.questions
  );

  useEffect(() => {
    loadQuiz().then((config) => setQuestions(config.questions));
  }, []);

  const updateQuestion = (index: number, updated: QuizQuestion) => {
    setQuestions((prev) => {
      const next = [...prev];
      next[index] = updated;
      return next;
    });
  };

  const handleSave = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await saveQuiz({ questions, createdAt: Date.now() });
    router.back();
  };

  const handleViewSheet = async () => {
    await saveQuiz({ questions, createdAt: Date.now() });
    router.push({ pathname: "/sheet", params: { questions: JSON.stringify(questions) } });
  };

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  return (
    <View style={[styles.container, { paddingTop: topPad }]}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.6 }]}
        >
          <Ionicons name="chevron-back" size={24} color={Colors.textPrimary} />
        </Pressable>
        <Text style={styles.title}>Quiz Setup</Text>
        <Pressable
          onPress={handleViewSheet}
          style={({ pressed }) => [styles.sheetBtn, pressed && { opacity: 0.6 }]}
        >
          <Ionicons name="document-outline" size={20} color={Colors.accent} />
          <Text style={styles.sheetBtnText}>Sheet</Text>
        </Pressable>
      </View>

      <Text style={styles.subtitle}>
        Set 5 questions and mark the correct answer for each.
      </Text>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: bottomPad + 100 }]}
        keyboardShouldPersistTaps="handled"
      >
        {questions.map((q, i) => (
          <QuestionEditor
            key={q.id}
            question={q}
            index={i}
            onChange={(updated) => updateQuestion(i, updated)}
          />
        ))}
      </ScrollView>

      {/* Save button */}
      <View style={[styles.footer, { paddingBottom: bottomPad + 16 }]}>
        <Pressable
          onPress={handleSave}
          style={({ pressed }) => [styles.saveBtn, pressed && { opacity: 0.85 }]}
        >
          <Ionicons name="checkmark-circle" size={20} color={Colors.background} />
          <Text style={styles.saveBtnText}>Save & Go Back</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
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
    color: Colors.textPrimary,
  },
  sheetBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: Colors.accentDim,
    borderWidth: 1,
    borderColor: Colors.accent,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  sheetBtnText: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: Colors.accent,
  },
  subtitle: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: Colors.textSecondary,
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
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 10,
  },
  questionLabel: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    color: Colors.accent,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  textInput: {
    backgroundColor: Colors.surfaceElevated,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 12,
    color: Colors.textPrimary,
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    minHeight: 44,
  },
  answerLabel: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    color: Colors.textSecondary,
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
    borderColor: Colors.border,
    backgroundColor: Colors.surfaceElevated,
    alignItems: "center",
    justifyContent: "center",
  },
  choiceBubbleSelected: {
    borderColor: Colors.accent,
    backgroundColor: Colors.accentDim,
  },
  choiceLetter: {
    fontSize: 16,
    fontFamily: "Inter_700Bold",
    color: Colors.textMuted,
  },
  choiceLetterSelected: {
    color: Colors.accent,
  },
  footer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingTop: 12,
    backgroundColor: Colors.surface,
    borderTopWidth: 1,
    borderColor: Colors.border,
  },
  saveBtn: {
    backgroundColor: Colors.accent,
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
    color: Colors.background,
  },
});
