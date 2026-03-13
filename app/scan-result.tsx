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
import Colors from "@/constants/colors";
import { getAnswerSheetById, getQuizById, updateAnswerSheet } from "@/lib/queries";

type Choice = "A" | "B" | "C" | "D" | "E";

export default function ScanResultScreen() {
  const { sheetId, quizId } = useLocalSearchParams<{ sheetId: string; quizId: string }>();
  const insets = useSafeAreaInsets();
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
      <View style={[styles.container, styles.center, { paddingTop: insets.top }]}>
        <ActivityIndicator color={Colors.accent} size="large" />
      </View>
    );
  }

  if (!sheet || !quiz) {
    return (
      <View style={[styles.container, styles.center, { paddingTop: insets.top }]}>
        <Text style={styles.emptyText}>Result not found</Text>
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
    if (percentage >= 80) return Colors.success;
    if (percentage >= 50) return Colors.warning;
    return Colors.error;
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
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={Colors.textPrimary} />
        </Pressable>
        <View style={styles.headerInfo}>
          <Text style={styles.title}>Scan Result</Text>
          <Text style={styles.subtitle}>{quiz.title}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Student banner */}
        <Animated.View entering={FadeInDown.duration(400)} style={styles.studentBanner}>
          <Ionicons name="person" size={14} color={Colors.accent} />
          <Text style={styles.studentName}>{sheet.studentName}</Text>
          {sheet.lrn ? <Text style={styles.studentLrn}>LRN: {sheet.lrn}</Text> : null}
        </Animated.View>

        {/* Score card */}
        <Animated.View entering={FadeInDown.duration(400).delay(100)} style={styles.scoreCard}>
          <View style={[styles.scoreRing, { borderColor: scoreColor }]}>
            <Text style={[styles.scoreNum, { color: scoreColor }]}>{score}</Text>
            <Text style={styles.scoreOutOf}>of {totalItems}</Text>
          </View>
          <View style={styles.statsRow}>
            <View style={[styles.statPill, { borderColor: Colors.success }]}>
              <Ionicons name="checkmark-circle" size={14} color={Colors.success} />
              <Text style={[styles.statText, { color: Colors.success }]}>{score}</Text>
            </View>
            <View style={[styles.statPill, { borderColor: Colors.error }]}>
              <Ionicons name="close-circle" size={14} color={Colors.error} />
              <Text style={[styles.statText, { color: Colors.error }]}>{totalItems - score}</Text>
            </View>
            <View style={[styles.statPill, { borderColor: scoreColor }]}>
              <Text style={[styles.statText, { color: scoreColor }]}>{percentage}%</Text>
            </View>
          </View>
          {hasEdits && (
            <Text style={styles.editedHint}>Score updated based on your edits</Text>
          )}
        </Animated.View>

        {/* Question breakdown */}
        <View style={styles.sectionLabel}>
          <Text style={styles.sectionLabelText}>Answers (tap to edit)</Text>
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
              style={styles.questionRow}
            >
              <View style={styles.questionNum}>
                <Text style={[styles.questionNumText, { color: isCorrect ? Colors.success : Colors.error }]}>
                  {num}
                </Text>
              </View>
              <View style={styles.bubbleRow}>
                {choices.map((choice) => {
                  const isStudentAnswer = studentAnswer === choice;
                  const isCorrectChoice = correctAnswer === choice;
                  const isWrong = isStudentAnswer && !isCorrect;

                  let borderColor = Colors.border;
                  let bg = Colors.surfaceElevated;
                  let textColor = Colors.textMuted;

                  if (isCorrectChoice) {
                    borderColor = Colors.success;
                    bg = Colors.successDim;
                    textColor = Colors.success;
                  }
                  if (isWrong) {
                    borderColor = Colors.error;
                    bg = Colors.errorDim;
                    textColor = Colors.error;
                  }
                  if (isStudentAnswer && isCorrect) {
                    borderColor = Colors.success;
                    bg = Colors.successDim;
                    textColor = Colors.success;
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
                        <View style={styles.correctDot} />
                      )}
                    </Pressable>
                  );
                })}
              </View>
              <Ionicons
                name={isCorrect ? "checkmark-circle" : "close-circle"}
                size={18}
                color={isCorrect ? Colors.success : Colors.error}
              />
            </Animated.View>
          );
        })}

        <View style={{ height: 80 }} />
      </ScrollView>

      {/* Bottom save bar */}
      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 12 }]}>
        <Pressable
          onPress={handleSave}
          disabled={!hasEdits || saving}
          style={({ pressed }) => [
            styles.saveBtn,
            pressed && { opacity: 0.8 },
            (!hasEdits || saving) && { opacity: 0.5 },
          ]}
        >
          {saving ? (
            <ActivityIndicator color={Colors.background} />
          ) : (
            <>
              <Ionicons name="checkmark" size={20} color={Colors.background} />
              <Text style={styles.saveBtnText}>
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
    backgroundColor: Colors.background,
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
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  headerInfo: {
    flex: 1,
  },
  title: {
    fontSize: 20,
    fontFamily: "Inter_700Bold",
    color: Colors.textPrimary,
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: Colors.textSecondary,
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
    backgroundColor: Colors.accentDim,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: Colors.accent,
  },
  studentName: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    color: Colors.accent,
    flex: 1,
  },
  studentLrn: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: Colors.accent,
    opacity: 0.7,
  },
  scoreCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: Colors.border,
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
    color: Colors.textMuted,
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
    backgroundColor: Colors.surfaceElevated,
  },
  statText: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },
  editedHint: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    color: Colors.warning,
  },
  sectionLabel: {
    paddingTop: 4,
  },
  sectionLabelText: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: Colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  questionRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    gap: 12,
    borderWidth: 1,
    borderColor: Colors.border,
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
    backgroundColor: Colors.success,
  },
  bottomBar: {
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  saveBtn: {
    backgroundColor: Colors.accent,
    borderRadius: 16,
    paddingVertical: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    shadowColor: Colors.accent,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 16,
    shadowOpacity: 0.3,
    elevation: 6,
  },
  saveBtnText: {
    fontSize: 16,
    fontFamily: "Inter_700Bold",
    color: Colors.background,
  },
  emptyText: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
    color: Colors.textMuted,
  },
});
