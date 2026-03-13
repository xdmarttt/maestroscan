import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Alert,
  ActivityIndicator,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeInDown } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/lib/theme-context";
import { getAnswerSheetById, getQuizById, updateAnswerSheet } from "@/lib/queries";

type Choice = "A" | "B" | "C" | "D" | "E";

export default function ScanResultScreen() {
  const { sheetId, quizId } = useLocalSearchParams<{ sheetId: string; quizId: string }>();
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const [sheet, setSheet] = useState<any>(null);
  const [quiz, setQuiz] = useState<any>(null);
  const [editedAnswers, setEditedAnswers] = useState<Record<string, string>>({});
  const [hasEdits, setHasEdits] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!sheetId || !quizId) return;
    Promise.all([getAnswerSheetById(sheetId), getQuizById(quizId)]).then(([s, q]) => {
      setSheet(s);
      setQuiz(q);
      if (s?.answers) setEditedAnswers(s.answers);
      setLoading(false);
    });
  }, [sheetId, quizId]);

  if (loading) {
    return (
      <View style={[styles.container, styles.center, { paddingTop: insets.top, backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  if (!sheet || !quiz) {
    return (
      <View style={[styles.container, styles.center, { paddingTop: insets.top, backgroundColor: colors.background }]}>
        <Text style={[styles.emptyText, { color: colors.textMuted }]}>Result not found</Text>
      </View>
    );
  }

  const answerKey = (quiz.answer_key ?? {}) as Record<string, string>;
  const totalItems = Object.keys(answerKey).length;
  const format = quiz.answer_sheet_format ?? 20;
  const choiceCount = format <= 20 ? 4 : 5;
  const choices: Choice[] = choiceCount === 5
    ? ["A", "B", "C", "D", "E"]
    : ["A", "B", "C", "D"];

  // Recalculate score from edited answers
  const score = Object.entries(answerKey).reduce((acc, [num, correct]) => {
    return acc + (editedAnswers[num] === correct ? 1 : 0);
  }, 0);
  const percentage = totalItems > 0 ? Math.round((score / totalItems) * 100) : 0;

  const getScoreColor = () => {
    if (percentage >= 80) return colors.success;
    if (percentage >= 50) return colors.warning;
    return colors.error;
  };

  const scoreColor = getScoreColor();

  const handleAnswerChange = (questionNum: string, choice: Choice) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setEditedAnswers((prev) => ({ ...prev, [questionNum]: choice }));
    setHasEdits(true);
  };

  const handleSave = async () => {
    if (!sheet?.id) return;
    setSaving(true);
    const { error } = await updateAnswerSheet({
      sheetId: sheet.id,
      answers: editedAnswers,
      rawScore: score,
      totalPoints: totalItems,
      percentage,
    });
    setSaving(false);
    if (error) {
      Alert.alert("Save Failed", error);
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.back();
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top, backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={[styles.backBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </Pressable>
        <View style={styles.headerInfo}>
          <Text style={[styles.title, { color: colors.textPrimary }]}>Scan Result</Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>{quiz.title}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Student banner */}
        <Animated.View entering={FadeInDown.duration(400)} style={[styles.studentBanner, { backgroundColor: colors.accentDim, borderColor: colors.accent }]}>
          <Ionicons name="person" size={14} color={colors.accent} />
          <Text style={[styles.studentName, { color: colors.accent }]}>{sheet.studentName}</Text>
          {sheet.lrn ? <Text style={[styles.studentLrn, { color: colors.accent }]}>LRN: {sheet.lrn}</Text> : null}
        </Animated.View>

        {/* Score card */}
        <Animated.View entering={FadeInDown.duration(400).delay(100)} style={[styles.scoreCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={[styles.scoreRing, { borderColor: scoreColor }]}>
            <Text style={[styles.scoreNum, { color: scoreColor }]}>{score}</Text>
            <Text style={[styles.scoreOutOf, { color: colors.textMuted }]}>of {totalItems}</Text>
          </View>
          <View style={styles.statsRow}>
            <View style={[styles.statPill, { borderColor: colors.success, backgroundColor: colors.surfaceElevated }]}>
              <Ionicons name="checkmark-circle" size={14} color={colors.success} />
              <Text style={[styles.statText, { color: colors.success }]}>{score}</Text>
            </View>
            <View style={[styles.statPill, { borderColor: colors.error, backgroundColor: colors.surfaceElevated }]}>
              <Ionicons name="close-circle" size={14} color={colors.error} />
              <Text style={[styles.statText, { color: colors.error }]}>{totalItems - score}</Text>
            </View>
            <View style={[styles.statPill, { borderColor: scoreColor, backgroundColor: colors.surfaceElevated }]}>
              <Text style={[styles.statText, { color: scoreColor }]}>{percentage}%</Text>
            </View>
          </View>
          {hasEdits && (
            <Text style={[styles.editedHint, { color: colors.warning }]}>Score updated based on your edits</Text>
          )}
        </Animated.View>

        {/* Question breakdown */}
        <View style={styles.sectionLabel}>
          <Text style={[styles.sectionLabelText, { color: colors.textSecondary }]}>Answers (tap to edit)</Text>
        </View>

        {Array.from({ length: totalItems }, (_, i) => i + 1).map((num, index) => {
          const key = String(num);
          const studentAnswer = editedAnswers[key] ?? "?";
          const correctAnswer = answerKey[key];
          const isCorrect = studentAnswer === correctAnswer;

          return (
            <Animated.View
              key={num}
              entering={FadeInDown.duration(250).delay(Math.min(200 + index * 20, 500))}
              style={[styles.questionRow, { backgroundColor: colors.surface, borderColor: colors.border }]}
            >
              <View style={styles.questionNum}>
                <Text style={[styles.questionNumText, { color: isCorrect ? colors.success : colors.error }]}>
                  {num}
                </Text>
              </View>
              <View style={styles.bubbleRow}>
                {choices.map((choice) => {
                  const isStudentAnswer = studentAnswer === choice;
                  const isCorrectChoice = correctAnswer === choice;
                  const isWrong = isStudentAnswer && !isCorrect;

                  let borderColor = colors.border;
                  let bg = colors.surfaceElevated;
                  let textColor = colors.textMuted;

                  if (isCorrectChoice) {
                    borderColor = colors.success;
                    bg = colors.successDim;
                    textColor = colors.success;
                  }
                  if (isWrong) {
                    borderColor = colors.error;
                    bg = colors.errorDim;
                    textColor = colors.error;
                  }
                  if (isStudentAnswer && isCorrect) {
                    borderColor = colors.success;
                    bg = colors.successDim;
                    textColor = colors.success;
                  }

                  return (
                    <Pressable
                      key={choice}
                      onPress={() => handleAnswerChange(key, choice)}
                      style={({ pressed }) => [
                        styles.bubble,
                        { borderColor, backgroundColor: bg },
                        pressed && { opacity: 0.7 },
                      ]}
                    >
                      <Text style={[styles.bubbleText, { color: textColor }]}>
                        {choice}
                      </Text>
                      {isCorrectChoice && !isStudentAnswer && (
                        <View style={[styles.correctDot, { backgroundColor: colors.success }]} />
                      )}
                    </Pressable>
                  );
                })}
              </View>
              <Ionicons
                name={isCorrect ? "checkmark-circle" : "close-circle"}
                size={18}
                color={isCorrect ? colors.success : colors.error}
              />
            </Animated.View>
          );
        })}

        <View style={{ height: 80 }} />
      </ScrollView>

      {/* Bottom save bar */}
      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 12, borderColor: colors.border, backgroundColor: colors.surface }]}>
        <Pressable
          onPress={handleSave}
          disabled={!hasEdits || saving}
          style={({ pressed }) => [
            styles.saveBtn,
            { backgroundColor: colors.accent, shadowColor: colors.accent },
            pressed && { opacity: 0.8 },
            (!hasEdits || saving) && { opacity: 0.5 },
          ]}
        >
          {saving ? (
            <ActivityIndicator color={colors.background} />
          ) : (
            <>
              <Ionicons name="checkmark" size={20} color={colors.background} />
              <Text style={[styles.saveBtnText, { color: colors.background }]}>
                Save Changes ({score}/{totalItems})
              </Text>
            </>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  center: {
    alignItems: "center",
    justifyContent: "center",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    gap: 12,
  },
  backBtn: {
    padding: 8,
    borderRadius: 12,
    borderWidth: 1,
  },
  headerInfo: {
    flex: 1,
  },
  title: {
    fontSize: 20,
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    marginTop: 2,
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 8,
    gap: 10,
  },
  studentBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
  },
  studentName: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    flex: 1,
  },
  studentLrn: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    opacity: 0.7,
  },
  scoreCard: {
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    alignItems: "center",
    gap: 14,
  },
  scoreRing: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 3,
    alignItems: "center",
    justifyContent: "center",
  },
  scoreNum: {
    fontSize: 28,
    fontFamily: "Inter_700Bold",
    lineHeight: 34,
  },
  scoreOutOf: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
  },
  statsRow: {
    flexDirection: "row",
    gap: 10,
  },
  statPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
  },
  statText: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },
  editedHint: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
  },
  sectionLabel: {
    paddingTop: 4,
  },
  sectionLabelText: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  questionRow: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    gap: 12,
    borderWidth: 1,
  },
  questionNum: {
    width: 28,
    alignItems: "center",
  },
  questionNumText: {
    fontSize: 14,
    fontFamily: "Inter_700Bold",
  },
  bubbleRow: {
    flex: 1,
    flexDirection: "row",
    gap: 8,
  },
  bubble: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  bubbleText: {
    fontSize: 14,
    fontFamily: "Inter_700Bold",
  },
  correctDot: {
    position: "absolute",
    top: -2,
    right: -2,
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  bottomBar: {
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: 1,
  },
  saveBtn: {
    borderRadius: 16,
    paddingVertical: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 16,
    shadowOpacity: 0.3,
    elevation: 6,
  },
  saveBtnText: {
    fontSize: 16,
    fontFamily: "Inter_700Bold",
  },
  emptyText: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
  },
});
