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
import { getQuizById, updateQuizAnswerKey } from "@/lib/queries";

type Choice = "A" | "B" | "C" | "D" | "E";

export default function AnswerKeyEditor() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const [quiz, setQuiz] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [answers, setAnswers] = useState<Record<string, Choice>>({});
  const [totalItems, setTotalItems] = useState(0);
  const [choiceCount, setChoiceCount] = useState(4);

  useEffect(() => {
    if (!id) return;
    getQuizById(id).then((q) => {
      if (!q) {
        setLoading(false);
        return;
      }
      setQuiz(q);
      const format = q.answer_sheet_format ?? 20;
      setTotalItems(q.total_points || format);
      setChoiceCount(format <= 20 ? 4 : 5);

      // Load existing answer key
      const existing = q.answer_key as Record<string, string> | null;
      if (existing) {
        setAnswers(existing as Record<string, Choice>);
      }
      setLoading(false);
    });
  }, [id]);

  const choices: Choice[] = choiceCount === 5
    ? ["A", "B", "C", "D", "E"]
    : ["A", "B", "C", "D"];

  const handleSelect = (questionNum: number, choice: Choice) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setAnswers((prev) => {
      const key = String(questionNum);
      // Toggle off if same choice tapped
      if (prev[key] === choice) {
        const next = { ...prev };
        delete next[key];
        return next;
      }
      return { ...prev, [key]: choice };
    });
  };

  const handleSave = async () => {
    if (!id) return;
    const answered = Object.keys(answers).length;
    if (answered === 0) {
      Alert.alert("Empty Answer Key", "Please set at least one answer before saving.");
      return;
    }
    setSaving(true);
    const { error } = await updateQuizAnswerKey(id, answers, totalItems);
    setSaving(false);
    if (error) {
      Alert.alert("Save Failed", error);
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.back();
    }
  };

  const answeredCount = Object.keys(answers).length;

  if (loading) {
    return (
      <View style={[styles.container, styles.center, { paddingTop: insets.top, backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  if (!quiz) {
    return (
      <View style={[styles.container, styles.center, { paddingTop: insets.top, backgroundColor: colors.background }]}>
        <Text style={[styles.emptyText, { color: colors.textMuted }]}>Quiz not found</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top, backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={[styles.backBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </Pressable>
        <View style={styles.headerInfo}>
          <Text style={[styles.title, { color: colors.textPrimary }]}>Edit Answer Key</Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>{quiz.title}</Text>
        </View>
        <Pressable
          onPress={handleSave}
          disabled={saving}
          style={({ pressed }) => [
            styles.saveHeaderBtn,
            { backgroundColor: colors.accentDim, borderColor: colors.accent },
            pressed && { opacity: 0.7 },
            saving && { opacity: 0.5 },
          ]}
        >
          {saving ? (
            <ActivityIndicator color={colors.accent} size="small" />
          ) : (
            <Text style={[styles.saveHeaderBtnText, { color: colors.accent }]}>Save</Text>
          )}
        </Pressable>
      </View>

      <View style={[styles.progressBar, { backgroundColor: colors.border }]}>
        <View style={[styles.progressFill, { width: `${(answeredCount / totalItems) * 100}%`, backgroundColor: colors.accent }]} />
      </View>
      <Text style={[styles.progressText, { color: colors.textMuted }]}>
        {answeredCount} of {totalItems} answered
      </Text>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {Array.from({ length: totalItems }, (_, i) => i + 1).map((num, index) => {
          const key = String(num);
          const selected = answers[key] ?? null;

          return (
            <Animated.View
              key={num}
              entering={FadeInDown.duration(250).delay(Math.min(index * 20, 300))}
              style={[styles.questionRow, { backgroundColor: colors.surface, borderColor: colors.border }]}
            >
              <View style={styles.questionNum}>
                <Text style={[styles.questionNumText, { color: selected ? colors.accent : colors.textMuted }]}>
                  {num}
                </Text>
              </View>
              <View style={styles.bubbleRow}>
                {choices.map((choice) => {
                  const isSelected = selected === choice;
                  return (
                    <Pressable
                      key={choice}
                      onPress={() => handleSelect(num, choice)}
                      style={({ pressed }) => [
                        styles.bubble,
                        {
                          borderColor: isSelected ? colors.accent : colors.border,
                          backgroundColor: isSelected ? colors.accentDim : colors.surfaceElevated,
                        },
                        pressed && { opacity: 0.7 },
                      ]}
                    >
                      <Text
                        style={[
                          styles.bubbleText,
                          { color: isSelected ? colors.accent : colors.textMuted },
                        ]}
                      >
                        {choice}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              {selected && (
                <Ionicons name="checkmark-circle" size={18} color={colors.success} />
              )}
            </Animated.View>
          );
        })}

        <View style={{ height: 40 }} />
      </ScrollView>

      <View style={[styles.bottomBar, { borderColor: colors.border, backgroundColor: colors.surface, paddingBottom: insets.bottom + 12 }]}>
        <Pressable
          onPress={handleSave}
          disabled={saving}
          style={({ pressed }) => [
            styles.saveBtn,
            { backgroundColor: colors.accent, shadowColor: colors.accent },
            pressed && { opacity: 0.8 },
            saving && { opacity: 0.6 },
          ]}
        >
          {saving ? (
            <ActivityIndicator color={colors.background} />
          ) : (
            <>
              <Ionicons name="checkmark" size={20} color={colors.background} />
              <Text style={[styles.saveBtnText, { color: colors.background }]}>
                Save Answer Key ({answeredCount}/{totalItems})
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
    paddingBottom: 8,
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
  saveHeaderBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
  },
  saveHeaderBtnText: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
  progressBar: {
    height: 3,
    marginHorizontal: 20,
    borderRadius: 2,
    marginTop: 8,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 2,
  },
  progressText: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    marginTop: 6,
    marginBottom: 4,
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 8,
    gap: 6,
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
    width: 32,
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
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  bubbleText: {
    fontSize: 15,
    fontFamily: "Inter_700Bold",
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
