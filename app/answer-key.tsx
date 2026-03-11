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
import { getQuizById, updateQuizAnswerKey } from "@/lib/queries";

type Choice = "A" | "B" | "C" | "D" | "E";

export default function AnswerKeyEditor() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
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

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={Colors.textPrimary} />
        </Pressable>
        <View style={styles.headerInfo}>
          <Text style={styles.title}>Edit Answer Key</Text>
          <Text style={styles.subtitle}>{quiz.title}</Text>
        </View>
        <Pressable
          onPress={handleSave}
          disabled={saving}
          style={({ pressed }) => [styles.saveHeaderBtn, pressed && { opacity: 0.7 }, saving && { opacity: 0.5 }]}
        >
          {saving ? (
            <ActivityIndicator color={Colors.accent} size="small" />
          ) : (
            <Text style={styles.saveHeaderBtnText}>Save</Text>
          )}
        </Pressable>
      </View>

      <View style={styles.progressBar}>
        <View style={[styles.progressFill, { width: `${(answeredCount / totalItems) * 100}%` }]} />
      </View>
      <Text style={styles.progressText}>
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
              style={styles.questionRow}
            >
              <View style={styles.questionNum}>
                <Text style={[styles.questionNumText, selected && { color: Colors.accent }]}>
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
                        isSelected && styles.bubbleSelected,
                        pressed && { opacity: 0.7 },
                      ]}
                    >
                      <Text
                        style={[
                          styles.bubbleText,
                          isSelected && styles.bubbleTextSelected,
                        ]}
                      >
                        {choice}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              {selected && (
                <Ionicons name="checkmark-circle" size={18} color={Colors.success} />
              )}
            </Animated.View>
          );
        })}

        <View style={{ height: 40 }} />
      </ScrollView>

      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 12 }]}>
        <Pressable
          onPress={handleSave}
          disabled={saving}
          style={({ pressed }) => [styles.saveBtn, pressed && { opacity: 0.8 }, saving && { opacity: 0.6 }]}
        >
          {saving ? (
            <ActivityIndicator color={Colors.background} />
          ) : (
            <>
              <Ionicons name="checkmark" size={20} color={Colors.background} />
              <Text style={styles.saveBtnText}>
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
    paddingBottom: 8,
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
  saveHeaderBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: Colors.accentDim,
    borderWidth: 1,
    borderColor: Colors.accent,
  },
  saveHeaderBtnText: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    color: Colors.accent,
  },
  progressBar: {
    height: 3,
    backgroundColor: Colors.border,
    marginHorizontal: 20,
    borderRadius: 2,
    marginTop: 8,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    backgroundColor: Colors.accent,
    borderRadius: 2,
  },
  progressText: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: Colors.textMuted,
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
    backgroundColor: Colors.surface,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    gap: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  questionNum: {
    width: 32,
    alignItems: "center",
  },
  questionNumText: {
    fontSize: 14,
    fontFamily: "Inter_700Bold",
    color: Colors.textMuted,
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
    borderColor: Colors.border,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.surfaceElevated,
  },
  bubbleSelected: {
    borderColor: Colors.accent,
    backgroundColor: Colors.accentDim,
  },
  bubbleText: {
    fontSize: 15,
    fontFamily: "Inter_700Bold",
    color: Colors.textMuted,
  },
  bubbleTextSelected: {
    color: Colors.accent,
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
