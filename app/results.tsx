import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Platform,
  Image,
  Modal,
  Dimensions,
  Alert,
  ActivityIndicator,
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
import { useColors } from "@/lib/theme-context";
import { loadRoster } from "@/lib/quiz-storage";
import { useAuth } from "@/lib/auth-context";
import { saveAnswerSheet } from "@/lib/queries";

interface Question {
  id: number;
  text: string;
  choices: string[];
  correct: string;
}

function ScoreRing({ score, total }: { score: number; total: number }) {
  const colors = useColors();
  const percentage = (score / total) * 100;
  const progressAnim = useSharedValue(0);

  useEffect(() => {
    progressAnim.value = withDelay(
      400,
      withTiming(percentage, { duration: 900, easing: Easing.out(Easing.cubic) })
    );
  }, []);

  const getScoreColor = () => {
    if (percentage >= 80) return colors.success;
    if (percentage >= 50) return colors.warning;
    return colors.error;
  };

  const color = getScoreColor();

  return (
    <Animated.View entering={ZoomIn.duration(500).delay(200)} style={styles.scoreRingWrap}>
      <View style={[styles.scoreRing, { borderColor: color, shadowColor: color }]}>
        <View style={[styles.scoreRingInner, { backgroundColor: `${color}12` }]}>
          <Text style={[styles.scoreNumber, { color }]}>{score}</Text>
          <Text style={[styles.scoreOutOf, { color: colors.textMuted }]}>out of {total}</Text>
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
  const colors = useColors();
  const isCorrect = studentAnswer === question.correct;

  return (
    <Animated.View
      entering={FadeInDown.duration(400).delay(300 + index * 120)}
      style={[styles.questionCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      <View style={styles.questionHeader}>
        <View style={[styles.questionNumBadge, { backgroundColor: colors.surfaceElevated, borderColor: colors.border }]}>
          <Text style={[styles.questionNum, { color: colors.textMuted }]}>Q{question.id}</Text>
        </View>
        <View style={styles.questionTextWrap}>
          <Text style={[styles.questionText, { color: colors.textPrimary }]}>{question.text}</Text>
        </View>
        <View style={[styles.resultIcon, { backgroundColor: isCorrect ? colors.successDim : colors.errorDim }]}>
          <Ionicons
            name={isCorrect ? "checkmark" : "close"}
            size={16}
            color={isCorrect ? colors.success : colors.error}
          />
        </View>
      </View>

      <View style={styles.choicesGrid}>
        {question.choices.map((choice) => {
          const letter = choice.charAt(0);
          const isCorrectChoice = letter === question.correct;
          const isStudentChoice = letter === studentAnswer;
          const isWrongStudentChoice = isStudentChoice && !isCorrect;

          let bg = colors.surfaceElevated;
          let borderCol = colors.border;
          let textCol = colors.textSecondary;

          if (isCorrectChoice) {
            bg = colors.successDim;
            borderCol = colors.success;
            textCol = colors.success;
          } else if (isWrongStudentChoice) {
            bg = colors.errorDim;
            borderCol = colors.error;
            textCol = colors.error;
          }

          return (
            <View key={letter} style={[styles.choiceItem, { backgroundColor: bg, borderColor: borderCol }]}>
              <View style={[styles.choiceLetter, { borderColor: borderCol }]}>
                <Text style={[styles.choiceLetterText, { color: textCol }]}>{letter}</Text>
              </View>
              <Text style={[styles.choiceText, { color: textCol }]}>{choice.substring(3)}</Text>
              {isCorrectChoice && (
                <Ionicons name="checkmark-circle" size={14} color={colors.success} />
              )}
              {isWrongStudentChoice && (
                <MaterialCommunityIcons name="target" size={14} color={colors.error} />
              )}
            </View>
          );
        })}
      </View>

      <View style={[styles.detectedRow, { borderColor: colors.border }]}>
        <View style={styles.detectedItem}>
          <Text style={[styles.detectedLabel, { color: colors.textMuted }]}>Scanned</Text>
          <View style={[
            styles.detectedBubble,
            {
              backgroundColor: isCorrect ? colors.successDim : colors.errorDim,
              borderColor: isCorrect ? colors.success : colors.error,
            }
          ]}>
            <Text style={[styles.detectedLetter, { color: isCorrect ? colors.success : colors.error }]}>
              {studentAnswer}
            </Text>
          </View>
        </View>
        <View style={styles.detectedArrow}>
          <Ionicons name="arrow-forward" size={14} color={colors.textMuted} />
        </View>
        <View style={styles.detectedItem}>
          <Text style={[styles.detectedLabel, { color: colors.textMuted }]}>Correct</Text>
          <View style={[styles.detectedBubble, { backgroundColor: colors.successDim, borderColor: colors.success }]}>
            <Text style={[styles.detectedLetter, { color: colors.success }]}>{question.correct}</Text>
          </View>
        </View>
        <View style={styles.statusTag}>
          <Text style={[styles.statusTagText, { color: isCorrect ? colors.success : colors.error }]}>
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
  const { profile } = useAuth();
  const colors = useColors();

  const answers: string[] = JSON.parse((params.answers as string) || "[]");
  const questions: Question[] = JSON.parse((params.questions as string) || "[]");
  const studentIdParam = params.studentId as string | undefined;
  const studentId = studentIdParam ?? null;
  const scannedImage = (params.scannedImage as string) || null;
  const quizId = (params.quizId as string) || null;
  const studentNameParam = (params.studentName as string) || null;
  const savedParam = (params.saved as string) === "true";
  const [studentName, setStudentName] = useState("");
  const [showImage, setShowImage] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(savedParam);

  // Look up student name from roster by ID (skip if name already provided)
  useEffect(() => {
    if (studentNameParam) {
      setStudentName(studentNameParam);
      return;
    }
    if (!studentId) return;
    const numId = parseInt(studentId, 10);
    loadRoster().then((r) => {
      if (!isNaN(numId) && numId >= 1 && numId <= r.students.length) {
        setStudentName(r.students[numId - 1]); // 1-based ID
      } else {
        setStudentName(`Student #${studentId}`);
      }
    });
  }, [studentId, studentNameParam]);
  const score = answers.filter((a, i) => a === questions[i]?.correct).length;
  const percentage = Math.round((score / questions.length) * 100);

  const handleSaveToCloud = async () => {
    if (!quizId || !studentId || !profile?.organization_id) {
      Alert.alert("Cannot Save", "Missing quiz, student, or organization info. Ensure a barcode was scanned.");
      return;
    }
    setSaving(true);
    const answersMap: Record<string, string> = {};
    answers.forEach((a, i) => { answersMap[String(i + 1)] = a; });
    const { error } = await saveAnswerSheet({
      quizId,
      studentId,
      organizationId: profile.organization_id,
      answers: answersMap,
      rawScore: score,
      totalPoints: questions.length,
      percentage,
    });
    setSaving(false);
    if (error) {
      Alert.alert("Save Failed", error);
    } else {
      setSaved(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  };

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  useEffect(() => {
    if (score === questions.length) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  }, []);

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
      <Animated.View entering={FadeIn.duration(400)} style={[styles.headerBar, { borderColor: colors.border }]}>
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [styles.backBtn, { backgroundColor: colors.surfaceElevated }, pressed && { opacity: 0.7 }]}
        >
          <Ionicons name="arrow-back" size={20} color={colors.textPrimary} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>Scan Results</Text>
        <View style={styles.headerSpacer} />
      </Animated.View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: bottomPad + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View entering={FadeInDown.duration(400).delay(100)} style={[styles.scoreSection, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          {studentName ? (
            <View style={[styles.studentBanner, { backgroundColor: colors.accentDim, borderColor: colors.accent }]}>
              <Ionicons name="person" size={14} color={colors.accent} />
              <Text style={[styles.studentBannerText, { color: colors.accent }]}>{studentName}</Text>
            </View>
          ) : null}
          <View style={styles.scoreSectionTop}>
            <View>
              <Text style={[styles.scoreLabel, { color: colors.textPrimary }]}>Total Score</Text>
              <Text style={[styles.scoreSubLabel, { color: colors.textSecondary }]}>
                {questions.length}-question quiz • {percentage}%
              </Text>
            </View>
            <View style={styles.scoreStars}>
              {Array.from({ length: 3 }).map((_, i) => (
                <Ionicons
                  key={i}
                  name="star"
                  size={16}
                  color={i < Math.ceil(score / (questions.length / 3)) ? colors.warning : colors.border}
                />
              ))}
            </View>
          </View>
          <ScoreRing score={score} total={questions.length} />
        </Animated.View>

        <Animated.View entering={FadeInDown.duration(400).delay(200)} style={styles.statsRow}>
          <View style={[styles.statCard, { backgroundColor: colors.surface, borderColor: colors.success }]}>
            <Ionicons name="checkmark-circle" size={20} color={colors.success} />
            <Text style={[styles.statNum, { color: colors.success }]}>{score}</Text>
            <Text style={[styles.statLabel, { color: colors.textMuted }]}>Correct</Text>
          </View>
          <View style={[styles.statCard, { backgroundColor: colors.surface, borderColor: colors.error }]}>
            <Ionicons name="close-circle" size={20} color={colors.error} />
            <Text style={[styles.statNum, { color: colors.error }]}>{questions.length - score}</Text>
            <Text style={[styles.statLabel, { color: colors.textMuted }]}>Incorrect</Text>
          </View>
          <View style={[styles.statCard, { backgroundColor: colors.surface, borderColor: colors.accent }]}>
            <MaterialCommunityIcons name="percent" size={20} color={colors.accent} />
            <Text style={[styles.statNum, { color: colors.accent }]}>{percentage}%</Text>
            <Text style={[styles.statLabel, { color: colors.textMuted }]}>Score</Text>
          </View>
        </Animated.View>

        {scannedImage && (
          <Animated.View entering={FadeInDown.duration(400).delay(220)}>
            <Pressable
              onPress={() => setShowImage(true)}
              style={({ pressed }) => [styles.imagePreviewBtn, { backgroundColor: colors.surface, borderColor: colors.border }, pressed && { opacity: 0.8 }]}
            >
              <Image
                source={{ uri: `data:image/jpeg;base64,${scannedImage}` }}
                style={[styles.imageThumb, { backgroundColor: colors.surfaceElevated }]}
                resizeMode="cover"
              />
              <View style={styles.imagePreviewInfo}>
                <Text style={[styles.imagePreviewLabel, { color: colors.textPrimary }]}>Scanned Image</Text>
                <Text style={[styles.imagePreviewHint, { color: colors.textMuted }]}>Tap to view full size</Text>
              </View>
              <Ionicons name="expand-outline" size={18} color={colors.textMuted} />
            </Pressable>
          </Animated.View>
        )}

        <Animated.View entering={FadeInDown.duration(300).delay(250)} style={styles.sectionLabel}>
          <Text style={[styles.sectionLabelText, { color: colors.textSecondary }]}>Question Breakdown</Text>
        </Animated.View>

        {questions.map((q, i) => (
          <QuestionResult key={q.id} question={q} studentAnswer={answers[i] || "?"} index={i} />
        ))}

        {quizId && (
          <Animated.View entering={FadeInUp.duration(400).delay(500)} style={styles.scanAgainWrap}>
            {saved ? (
              <View style={[styles.savedBanner, { backgroundColor: colors.successDim, borderColor: colors.success }]}>
                <Ionicons name="checkmark-circle" size={20} color={colors.success} />
                <Text style={[styles.savedText, { color: colors.success }]}>Saved to MaestroGrade</Text>
              </View>
            ) : (
              <Pressable
                onPress={handleSaveToCloud}
                disabled={saving}
                style={({ pressed }) => [styles.saveBtn, { backgroundColor: colors.surface, borderColor: colors.accent }, pressed && { opacity: 0.85 }, saving && { opacity: 0.6 }]}
              >
                {saving ? (
                  <ActivityIndicator color={colors.accent} size="small" />
                ) : (
                  <>
                    <Ionicons name="cloud-upload-outline" size={18} color={colors.accent} />
                    <Text style={[styles.saveBtnText, { color: colors.accent }]}>Save to Cloud</Text>
                  </>
                )}
              </Pressable>
            )}
          </Animated.View>
        )}

        <Animated.View entering={FadeInUp.duration(400).delay(600)} style={styles.scanAgainWrap}>
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              router.back();
            }}
            style={({ pressed }) => [styles.scanAgainBtn, { backgroundColor: colors.accent, shadowColor: colors.accent }, pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] }]}
          >
            <MaterialCommunityIcons name="line-scan" size={18} color={colors.background} />
            <Text style={[styles.scanAgainText, { color: colors.background }]}>Scan Another Sheet</Text>
          </Pressable>
        </Animated.View>
      </ScrollView>
      {scannedImage && (
        <Modal visible={showImage} transparent animationType="fade" onRequestClose={() => setShowImage(false)}>
          <Pressable style={styles.imageModalBackdrop} onPress={() => setShowImage(false)}>
            <View style={styles.imageModalHeader}>
              <Pressable onPress={() => setShowImage(false)} style={[styles.imageModalClose, { backgroundColor: colors.surfaceElevated }]}>
                <Ionicons name="close" size={22} color={colors.textPrimary} />
              </Pressable>
            </View>
            <Image
              source={{ uri: `data:image/jpeg;base64,${scannedImage}` }}
              style={styles.imageModalFull}
              resizeMode="contain"
            />
          </Pressable>
        </Modal>
      )}
    </View>
  );
}

const SCREEN_WIDTH = Dimensions.get("window").width;

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  headerBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    flex: 1,
    textAlign: "center",
    fontSize: 17,
    fontFamily: "Inter_600SemiBold",
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
    borderRadius: 20,
    padding: 20,
    gap: 20,
    borderWidth: 1,
  },
  studentBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
  },
  studentBannerText: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
  },
  scoreSectionTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
  },
  scoreLabel: {
    fontSize: 18,
    fontFamily: "Inter_700Bold",
  },
  scoreSubLabel: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
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
    letterSpacing: 0.3,
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
  questionCard: {
    borderRadius: 18,
    padding: 16,
    gap: 14,
    borderWidth: 1,
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
  },
  questionNum: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.5,
  },
  questionTextWrap: {
    flex: 1,
  },
  questionText: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
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
  },
  detectedItem: {
    alignItems: "center",
    gap: 4,
  },
  detectedLabel: {
    fontSize: 10,
    fontFamily: "Inter_400Regular",
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
  savedBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 16,
    paddingVertical: 16,
    borderWidth: 1,
  },
  savedText: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
  },
  saveBtn: {
    borderRadius: 16,
    paddingVertical: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    borderWidth: 1,
  },
  saveBtnText: {
    fontSize: 16,
    fontFamily: "Inter_700Bold",
  },
  scanAgainWrap: {
    marginTop: 6,
  },
  scanAgainBtn: {
    borderRadius: 16,
    paddingVertical: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 16,
    shadowOpacity: 0.4,
    elevation: 8,
  },
  scanAgainText: {
    fontSize: 16,
    fontFamily: "Inter_700Bold",
  },
  imagePreviewBtn: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 16,
    padding: 12,
    gap: 12,
    borderWidth: 1,
  },
  imageThumb: {
    width: 56,
    height: 72,
    borderRadius: 8,
  },
  imagePreviewInfo: {
    flex: 1,
    gap: 2,
  },
  imagePreviewLabel: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
  imagePreviewHint: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
  imageModalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.95)",
    justifyContent: "center",
    alignItems: "center",
  },
  imageModalHeader: {
    position: "absolute",
    top: 50,
    right: 20,
    zIndex: 10,
  },
  imageModalClose: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  imageModalFull: {
    width: SCREEN_WIDTH - 32,
    height: (SCREEN_WIDTH - 32) * 1.4,
    borderRadius: 12,
  },
});
