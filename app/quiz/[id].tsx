import React, { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  FlatList,
  ActivityIndicator,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeInDown } from "react-native-reanimated";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import Colors from "@/constants/colors";
import { getQuizById, getAnswerSheetsByQuiz } from "@/lib/queries";

export default function QuizDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const [quiz, setQuiz] = useState<any>(null);
  const [sheets, setSheets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    if (!id) return;
    const [q, s] = await Promise.all([getQuizById(id), getAnswerSheetsByQuiz(id)]);
    setQuiz(q);
    setSheets(s);
    setLoading(false);
  };

  useFocusEffect(
    useCallback(() => {
      load();
    }, [id])
  );

  const handleScan = () => {
    if (!quiz) return;

    // Derive choice count and answer key from quiz data
    const answerKey = quiz.answer_key as Record<string, string> | null;
    const format = quiz.answer_sheet_format ?? 20;
    // Format 20 = 4 choices (A-D), 50/100 = 5 choices (A-E)
    const choiceCount = format <= 20 ? 4 : 5;

    router.push({
      pathname: "/scan",
      params: {
        quizId: quiz.id,
        answerKey: answerKey ? JSON.stringify(answerKey) : "",
        totalPoints: String(quiz.total_points),
        choiceCount: String(choiceCount),
        quizTitle: quiz.title,
      },
    });
  };

  if (loading) {
    return (
      <View style={[styles.container, styles.center, { paddingTop: insets.top }]}>
        <ActivityIndicator color={Colors.accent} size="large" />
      </View>
    );
  }

  if (!quiz) {
    return (
      <View style={[styles.container, styles.center, { paddingTop: insets.top }]}>
        <Text style={styles.emptyText}>Quiz not found</Text>
      </View>
    );
  }

  const cls = quiz.classes as { subject: string; grade_level: string | null; section: string | null } | null;
  const className = cls
    ? `${cls.subject}${cls.grade_level ? ` ${cls.grade_level}` : ""}${cls.section ? ` · ${cls.section}` : ""}`
    : "";

  const categoryColors: Record<string, string> = { WW: Colors.accent, PT: Colors.warning, QA: Colors.success };
  const catColor = categoryColors[quiz.category] ?? Colors.textMuted;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={Colors.textPrimary} />
        </Pressable>
        <View style={styles.headerInfo}>
          <Text style={styles.title} numberOfLines={1}>{quiz.title}</Text>
          <Text style={styles.subtitle}>{className}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Animated.View entering={FadeInDown.duration(400)} style={styles.infoCard}>
          <View style={styles.infoRow}>
            <View style={styles.infoPill}>
              <Text style={[styles.pillText, { color: catColor }]}>{quiz.category}</Text>
            </View>
            <Text style={styles.infoLabel}>{quiz.total_points} points</Text>
            <Text style={styles.infoLabel}>{quiz.status ?? "draft"}</Text>
          </View>
          {quiz.answer_sheet_format && (
            <Text style={styles.formatInfo}>{quiz.answer_sheet_format}-item answer sheet</Text>
          )}
        </Animated.View>

        <Animated.View entering={FadeInDown.duration(400).delay(100)} style={styles.actionRow}>
          <Pressable
            onPress={handleScan}
            style={({ pressed }) => [styles.scanBtn, { flex: 1 }, pressed && { opacity: 0.8 }]}
          >
            <MaterialCommunityIcons name="line-scan" size={22} color={Colors.background} />
            <Text style={styles.scanBtnText}>Scan</Text>
          </Pressable>
          <Pressable
            onPress={() => router.push({ pathname: "/answer-key", params: { id: quiz.id } })}
            style={({ pressed }) => [styles.editKeyBtn, pressed && { opacity: 0.8 }]}
          >
            <Ionicons name="create-outline" size={20} color={Colors.accent} />
            <Text style={styles.editKeyBtnText}>Edit Key</Text>
          </Pressable>
        </Animated.View>

        {quiz.answer_key && Object.keys(quiz.answer_key as Record<string, string>).length > 0 && (
          <Animated.View entering={FadeInDown.duration(400).delay(150)} style={styles.answerKeyCard}>
            <Text style={styles.sectionTitle}>Answer Key</Text>
            <View style={styles.answerKeyGrid}>
              {Object.entries(quiz.answer_key as Record<string, string>)
                .sort(([a], [b]) => Number(a) - Number(b))
                .map(([num, answer]) => (
                  <View key={num} style={styles.answerKeyItem}>
                    <Text style={styles.answerKeyNum}>{num}</Text>
                    <View style={styles.answerKeyBubble}>
                      <Text style={styles.answerKeyLetter}>{answer}</Text>
                    </View>
                  </View>
                ))}
            </View>
          </Animated.View>
        )}

        <Animated.View entering={FadeInDown.duration(400).delay(200)} style={styles.section}>
          <Text style={styles.sectionTitle}>
            Scanned Sheets ({sheets.length})
          </Text>

          {sheets.length === 0 ? (
            <View style={styles.emptySheets}>
              <Ionicons name="scan-outline" size={32} color={Colors.textMuted} />
              <Text style={styles.emptyText}>No scanned sheets yet</Text>
              <Text style={styles.emptySubtext}>Tap "Scan Answer Sheet" to start grading</Text>
            </View>
          ) : (
            sheets.map((sheet, index) => (
              <Animated.View key={sheet.id} entering={FadeInDown.duration(300).delay(300 + index * 40)}>
                <View style={styles.sheetCard}>
                  <View style={styles.sheetLeft}>
                    <Text style={styles.sheetName}>{sheet.studentName}</Text>
                    {sheet.lrn ? <Text style={styles.sheetLrn}>LRN: {sheet.lrn}</Text> : null}
                  </View>
                  <View style={styles.sheetRight}>
                    <Text style={[styles.sheetScore, {
                      color: sheet.percentage >= 80 ? Colors.success : sheet.percentage >= 50 ? Colors.warning : Colors.error,
                    }]}>
                      {sheet.score}/{sheet.totalPoints}
                    </Text>
                    <Text style={styles.sheetPercent}>{Math.round(sheet.percentage)}%</Text>
                  </View>
                </View>
              </Animated.View>
            ))
          )}
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
    padding: 20,
    gap: 20,
    paddingBottom: 40,
  },
  infoCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 8,
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  infoPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: Colors.surfaceElevated,
  },
  pillText: {
    fontSize: 12,
    fontFamily: "Inter_700Bold",
  },
  infoLabel: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: Colors.textSecondary,
  },
  formatInfo: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: Colors.textMuted,
  },
  actionRow: {
    flexDirection: "row",
    gap: 12,
  },
  scanBtn: {
    backgroundColor: Colors.accent,
    borderRadius: 16,
    paddingVertical: 18,
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
  scanBtnText: {
    fontSize: 17,
    fontFamily: "Inter_700Bold",
    color: Colors.background,
  },
  editKeyBtn: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    paddingVertical: 18,
    paddingHorizontal: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: Colors.accent,
  },
  editKeyBtnText: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    color: Colors.accent,
  },
  answerKeyCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 12,
  },
  answerKeyGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  answerKeyItem: {
    alignItems: "center",
    gap: 4,
    width: 40,
  },
  answerKeyNum: {
    fontSize: 10,
    fontFamily: "Inter_500Medium",
    color: Colors.textMuted,
  },
  answerKeyBubble: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: Colors.accentDim,
    borderWidth: 1.5,
    borderColor: Colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  answerKeyLetter: {
    fontSize: 13,
    fontFamily: "Inter_700Bold",
    color: Colors.accent,
  },
  section: {
    gap: 12,
  },
  sectionTitle: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    color: Colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  emptySheets: {
    alignItems: "center",
    paddingVertical: 40,
    gap: 8,
  },
  emptyText: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
    color: Colors.textMuted,
  },
  emptySubtext: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: Colors.textMuted,
  },
  sheetCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sheetLeft: {
    flex: 1,
    gap: 2,
  },
  sheetName: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    color: Colors.textPrimary,
  },
  sheetLrn: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    color: Colors.textMuted,
  },
  sheetRight: {
    alignItems: "flex-end",
    gap: 2,
  },
  sheetScore: {
    fontSize: 16,
    fontFamily: "Inter_700Bold",
  },
  sheetPercent: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
    color: Colors.textMuted,
  },
});
