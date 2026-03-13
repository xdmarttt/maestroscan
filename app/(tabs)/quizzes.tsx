import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  RefreshControl,
  ActivityIndicator,
} from "react-native";
import { router } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeInDown } from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/lib/theme-context";
import { getAllQuizzes } from "@/lib/queries";

interface QuizItem {
  id: string;
  title: string;
  category: string;
  total_points: number;
  status: string | null;
  answer_sheet_format: number | null;
  created_at: string | null;
  classes: { subject: string; grade_level: string | null; section: string | null } | null;
}

export default function QuizzesTab() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const [quizzes, setQuizzes] = useState<QuizItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const categoryColors: Record<string, string> = {
    WW: colors.accent,
    PT: colors.warning,
    QA: colors.success,
  };

  const load = async () => {
    const data = await getAllQuizzes();
    setQuizzes(data as QuizItem[]);
    setLoading(false);
  };

  useFocusEffect(
    useCallback(() => {
      load();
    }, [])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const renderQuiz = ({ item, index }: { item: QuizItem; index: number }) => {
    const cls = item.classes;
    const className = cls
      ? `${cls.subject}${cls.grade_level ? ` ${cls.grade_level}` : ""}${cls.section ? ` · ${cls.section}` : ""}`
      : "Unknown class";
    const catColor = categoryColors[item.category] ?? colors.textMuted;

    return (
      <Animated.View entering={FadeInDown.duration(400).delay(index * 50)}>
        <Pressable
          onPress={() => router.push({ pathname: "/quiz/[id]", params: { id: item.id } })}
          style={({ pressed }) => [
            styles.card,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
              shadowColor: colors.cardShadow,
            },
            pressed && { opacity: 0.7 },
          ]}
        >
          <View style={styles.cardTop}>
            <Text
              style={[
                styles.categoryBadge,
                { color: catColor, backgroundColor: `${catColor}15` },
              ]}
            >
              {item.category}
            </Text>
            <Text style={[styles.points, { color: colors.textSecondary }]}>
              {item.total_points} pts
            </Text>
          </View>
          <Text style={[styles.quizTitle, { color: colors.textPrimary }]}>{item.title}</Text>
          <Text style={[styles.className, { color: colors.textSecondary }]}>{className}</Text>
          <View style={styles.cardFooter}>
            <View
              style={[
                styles.statusDot,
                {
                  backgroundColor:
                    item.status === "published" ? colors.success : colors.textMuted,
                },
              ]}
            />
            <Text style={[styles.statusText, { color: colors.textMuted }]}>
              {item.status ?? "draft"}
            </Text>
            {item.answer_sheet_format && (
              <>
                <Text style={[styles.dot, { color: colors.textMuted }]}>·</Text>
                <Text style={[styles.formatText, { color: colors.textMuted }]}>
                  {item.answer_sheet_format} items
                </Text>
              </>
            )}
          </View>
        </Pressable>
      </Animated.View>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.textPrimary }]}>Quizzes</Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          {quizzes.length} total quizzes
        </Text>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} size="large" />
        </View>
      ) : quizzes.length === 0 ? (
        <View style={styles.center}>
          <View style={[styles.emptyIcon, { backgroundColor: colors.warningDim }]}>
            <Ionicons name="document-text-outline" size={32} color={colors.warning} />
          </View>
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>No quizzes yet</Text>
          <Text style={[styles.emptySubtext, { color: colors.textMuted }]}>
            Create quizzes from the web dashboard
          </Text>
        </View>
      ) : (
        <FlatList
          data={quizzes}
          keyExtractor={(item) => item.id}
          renderItem={renderQuiz}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
  },
  title: {
    fontSize: 26,
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    marginTop: 4,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  list: {
    padding: 20,
    paddingTop: 8,
    gap: 12,
  },
  card: {
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    gap: 6,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 8,
    shadowOpacity: 1,
    elevation: 2,
  },
  cardTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  categoryBadge: {
    fontSize: 11,
    fontFamily: "Inter_700Bold",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    overflow: "hidden",
  },
  points: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
  },
  quizTitle: {
    fontSize: 16,
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.2,
  },
  className: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
  },
  cardFooter: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 4,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusText: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    textTransform: "capitalize",
  },
  dot: {
    fontSize: 12,
  },
  formatText: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
  emptyText: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
  },
  emptySubtext: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
  },
});
