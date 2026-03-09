import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Platform,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  withSpring,
  Easing,
  FadeIn,
  FadeInDown,
  FadeInUp,
  ZoomIn,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import Colors from "@/constants/colors";
import { loadRoster } from "@/lib/quiz-storage";

interface Question {
  id: number;
  text: string;
  choices: string[];
  correct: string;
}

function ScoreRing({ score, total }: { score: number; total: number }) {
  const percentage = (score / total) * 100;
  const progressAnim = useSharedValue(0);

  useEffect(() => {
    progressAnim.value = withDelay(
      400,
      withTiming(percentage, { duration: 900, easing: Easing.out(Easing.cubic) })
    );
  }, []);

  const getScoreColor = () => {
    if (percentage >= 80) return Colors.success;
    if (percentage >= 50) return Colors.warning;
    return Colors.error;
  };

  const color = getScoreColor();

  return (
    <Animated.View entering={ZoomIn.duration(500).delay(200)} style={styles.scoreRingWrap}>
      <View style={[styles.scoreRing, { borderColor: color, shadowColor: color }]}>
        <View style={[styles.scoreRingInner, { backgroundColor: `${color}12` }]}>
          <Text style={[styles.scoreNumber, { color }]}>{score}</Text>
          <Text style={styles.scoreOutOf}>out of {total}</Text>
        </View>
      </View>
      <View style={[styles.scoreBadge, { backgroundColor: `${color}18`, borderColor: `${color}40` }]}>
        <Text style={[styles.scoreBadgeText, { color }]}>
          {percentage >= 80 ? "Excellent" : percentage >= 50 ? "Passing" : "Needs Review"}
        </Text>
      </View>
    </Animated.View>
  );
}

function QuestionResult({
  question,
  studentAnswer,
  index,
}: {
  question: Question;
  studentAnswer: string;
  index: number;
}) {
  const isCorrect = studentAnswer === question.correct;

  return (
    <Animated.View
      entering={FadeInDown.duration(400).delay(300 + index * 120)}
      style={styles.questionCard}
    >
      <View style={styles.questionHeader}>
        <View style={[styles.questionNumBadge, { backgroundColor: Colors.surfaceElevated }]}>
          <Text style={styles.questionNum}>Q{question.id}</Text>
        </View>
        <View style={styles.questionTextWrap}>
          <Text style={styles.questionText}>{question.text}</Text>
        </View>
        <View style={[styles.resultIcon, { backgroundColor: isCorrect ? Colors.successDim : Colors.errorDim }]}>
          <Ionicons
            name={isCorrect ? "checkmark" : "close"}
            size={16}
            color={isCorrect ? Colors.success : Colors.error}
          />
        </View>
      </View>

      <View style={styles.choicesGrid}>
        {question.choices.map((choice) => {
          const letter = choice.charAt(0);
          const isCorrectChoice = letter === question.correct;
          const isStudentChoice = letter === studentAnswer;
          const isWrongStudentChoice = isStudentChoice && !isCorrect;

          let bg = Colors.surfaceElevated;
          let borderCol = Colors.border;
          let textCol = Colors.textSecondary;

          if (isCorrectChoice) {
            bg = Colors.successDim;
            borderCol = Colors.success;
            textCol = Colors.success;
          } else if (isWrongStudentChoice) {
            bg = Colors.errorDim;
            borderCol = Colors.error;
            textCol = Colors.error;
          }

          return (
            <View key={letter} style={[styles.choiceItem, { backgroundColor: bg, borderColor: borderCol }]}>
              <View style={[styles.choiceLetter, { borderColor: borderCol }]}>
                <Text style={[styles.choiceLetterText, { color: textCol }]}>{letter}</Text>
              </View>
              <Text style={[styles.choiceText, { color: textCol }]}>{choice.substring(3)}</Text>
              {isCorrectChoice && (
                <Ionicons name="checkmark-circle" size={14} color={Colors.success} />
              )}
              {isWrongStudentChoice && (
                <MaterialCommunityIcons name="target" size={14} color={Colors.error} />
              )}
            </View>
          );
        })}
      </View>

      <View style={styles.detectedRow}>
        <View style={styles.detectedItem}>
          <Text style={styles.detectedLabel}>Scanned</Text>
          <View style={[
            styles.detectedBubble,
            {
              backgroundColor: isCorrect ? Colors.successDim : Colors.errorDim,
              borderColor: isCorrect ? Colors.success : Colors.error,
            }
          ]}>
            <Text style={[styles.detectedLetter, { color: isCorrect ? Colors.success : Colors.error }]}>
              {studentAnswer}
            </Text>
          </View>
        </View>
        <View style={styles.detectedArrow}>
          <Ionicons name="arrow-forward" size={14} color={Colors.textMuted} />
        </View>
        <View style={styles.detectedItem}>
          <Text style={styles.detectedLabel}>Correct</Text>
          <View style={[styles.detectedBubble, { backgroundColor: Colors.successDim, borderColor: Colors.success }]}>
            <Text style={[styles.detectedLetter, { color: Colors.success }]}>{question.correct}</Text>
          </View>
        </View>
        <View style={styles.statusTag}>
          <Text style={[styles.statusTagText, { color: isCorrect ? Colors.success : Colors.error }]}>
            {isCorrect ? "+1 pt" : "Miss"}
          </Text>
        </View>
      </View>
    </Animated.View>
  );
}

export default function ResultsScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams();

  const answers: string[] = JSON.parse((params.answers as string) || "[]");
  const questions: Question[] = JSON.parse((params.questions as string) || "[]");
  const studentIdParam = params.studentId as string | undefined;
  const studentId = studentIdParam !== undefined ? parseInt(studentIdParam, 10) : null;
  const [studentName, setStudentName] = useState("");

  // Look up student name from roster by ID
  useEffect(() => {
    if (studentId === null || isNaN(studentId)) return;
    loadRoster().then((r) => {
      if (studentId >= 1 && studentId <= r.students.length) {
        setStudentName(r.students[studentId - 1]); // 1-based ID
      } else {
        setStudentName(`Student #${studentId}`);
      }
    });
  }, [studentId]);
  const score = answers.filter((a, i) => a === questions[i]?.correct).length;
  const percentage = Math.round((score / questions.length) * 100);

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  useEffect(() => {
    if (score === questions.length) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  }, []);

  return (
    <View style={[styles.container, { paddingTop: topPad }]}>
      <Animated.View entering={FadeIn.duration(400)} style={styles.headerBar}>
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.7 }]}
        >
          <Ionicons name="arrow-back" size={20} color={Colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle}>Scan Results</Text>
        <View style={styles.headerSpacer} />
      </Animated.View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: bottomPad + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View entering={FadeInDown.duration(400).delay(100)} style={styles.scoreSection}>
          {studentName ? (
            <View style={styles.studentBanner}>
              <Ionicons name="person" size={14} color={Colors.accent} />
              <Text style={styles.studentBannerText}>{studentName}</Text>
            </View>
          ) : null}
          <View style={styles.scoreSectionTop}>
            <View>
              <Text style={styles.scoreLabel}>Total Score</Text>
              <Text style={styles.scoreSubLabel}>
                {questions.length}-question quiz • {percentage}%
              </Text>
            </View>
            <View style={styles.scoreStars}>
              {Array.from({ length: 3 }).map((_, i) => (
                <Ionicons
                  key={i}
                  name="star"
                  size={16}
                  color={i < Math.ceil(score / (questions.length / 3)) ? Colors.warning : Colors.border}
                />
              ))}
            </View>
          </View>
          <ScoreRing score={score} total={questions.length} />
        </Animated.View>

        <Animated.View entering={FadeInDown.duration(400).delay(200)} style={styles.statsRow}>
          <View style={[styles.statCard, { borderColor: Colors.success }]}>
            <Ionicons name="checkmark-circle" size={20} color={Colors.success} />
            <Text style={[styles.statNum, { color: Colors.success }]}>{score}</Text>
            <Text style={styles.statLabel}>Correct</Text>
          </View>
          <View style={[styles.statCard, { borderColor: Colors.error }]}>
            <Ionicons name="close-circle" size={20} color={Colors.error} />
            <Text style={[styles.statNum, { color: Colors.error }]}>{questions.length - score}</Text>
            <Text style={styles.statLabel}>Incorrect</Text>
          </View>
          <View style={[styles.statCard, { borderColor: Colors.accent }]}>
            <MaterialCommunityIcons name="percent" size={20} color={Colors.accent} />
            <Text style={[styles.statNum, { color: Colors.accent }]}>{percentage}%</Text>
            <Text style={styles.statLabel}>Score</Text>
          </View>
        </Animated.View>

        <Animated.View entering={FadeInDown.duration(300).delay(250)} style={styles.sectionLabel}>
          <Text style={styles.sectionLabelText}>Question Breakdown</Text>
        </Animated.View>

        {questions.map((q, i) => (
          <QuestionResult key={q.id} question={q} studentAnswer={answers[i] || "?"} index={i} />
        ))}

        <Animated.View entering={FadeInUp.duration(400).delay(600)} style={styles.scanAgainWrap}>
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              router.back();
            }}
            style={({ pressed }) => [styles.scanAgainBtn, pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] }]}
          >
            <MaterialCommunityIcons name="line-scan" size={18} color={Colors.background} />
            <Text style={styles.scanAgainText}>Scan Another Sheet</Text>
          </Pressable>
        </Animated.View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  headerBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderColor: Colors.border,
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: Colors.surfaceElevated,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    flex: 1,
    textAlign: "center",
    fontSize: 17,
    fontFamily: "Inter_600SemiBold",
    color: Colors.textPrimary,
  },
  headerSpacer: {
    width: 38,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 20,
    gap: 14,
  },
  scoreSection: {
    backgroundColor: Colors.surface,
    borderRadius: 20,
    padding: 20,
    gap: 20,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  studentBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: Colors.accentDim,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: Colors.accent,
  },
  studentBannerText: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    color: Colors.accent,
  },
  scoreSectionTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
  },
  scoreLabel: {
    fontSize: 18,
    fontFamily: "Inter_700Bold",
    color: Colors.textPrimary,
  },
  scoreSubLabel: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: Colors.textSecondary,
    marginTop: 2,
  },
  scoreStars: {
    flexDirection: "row",
    gap: 3,
    marginTop: 2,
  },
  scoreRingWrap: {
    alignItems: "center",
    gap: 12,
  },
  scoreRing: {
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 4,
    alignItems: "center",
    justifyContent: "center",
    shadowOffset: { width: 0, height: 0 },
    shadowRadius: 16,
    shadowOpacity: 0.4,
  },
  scoreRingInner: {
    width: 104,
    height: 104,
    borderRadius: 52,
    alignItems: "center",
    justifyContent: "center",
  },
  scoreNumber: {
    fontSize: 42,
    fontFamily: "Inter_700Bold",
    lineHeight: 50,
  },
  scoreOutOf: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    color: Colors.textMuted,
    letterSpacing: 0.3,
  },
  scoreBadge: {
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderWidth: 1,
  },
  scoreBadgeText: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.3,
  },
  statsRow: {
    flexDirection: "row",
    gap: 10,
  },
  statCard: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
  },
  statNum: {
    fontSize: 22,
    fontFamily: "Inter_700Bold",
  },
  statLabel: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    color: Colors.textMuted,
    letterSpacing: 0.3,
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
  questionCard: {
    backgroundColor: Colors.surface,
    borderRadius: 18,
    padding: 16,
    gap: 14,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  questionHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  questionNumBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  questionNum: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    color: Colors.textMuted,
    letterSpacing: 0.5,
  },
  questionTextWrap: {
    flex: 1,
  },
  questionText: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
    color: Colors.textPrimary,
    lineHeight: 20,
  },
  resultIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  choicesGrid: {
    gap: 6,
  },
  choiceItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderWidth: 1,
  },
  choiceLetter: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  choiceLetterText: {
    fontSize: 12,
    fontFamily: "Inter_700Bold",
  },
  choiceText: {
    flex: 1,
    fontSize: 13,
    fontFamily: "Inter_400Regular",
  },
  detectedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingTop: 4,
    borderTopWidth: 1,
    borderColor: Colors.border,
  },
  detectedItem: {
    alignItems: "center",
    gap: 4,
  },
  detectedLabel: {
    fontSize: 10,
    fontFamily: "Inter_400Regular",
    color: Colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  detectedBubble: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  detectedLetter: {
    fontSize: 16,
    fontFamily: "Inter_700Bold",
  },
  detectedArrow: {
    marginTop: 14,
  },
  statusTag: {
    flex: 1,
    alignItems: "flex-end",
    marginTop: 14,
  },
  statusTagText: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },
  scanAgainWrap: {
    marginTop: 6,
  },
  scanAgainBtn: {
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
    shadowOpacity: 0.4,
    elevation: 8,
  },
  scanAgainText: {
    fontSize: 16,
    fontFamily: "Inter_700Bold",
    color: Colors.background,
  },
});
