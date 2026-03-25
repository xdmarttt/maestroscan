import React, { useState, useCallback, useMemo } from "react";
import {
  View,
  Text,
  TextInput,
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

type CategoryFilter = "all" | "WW" | "PT" | "QA";
type StatusFilter = "all" | "published" | "draft" | "done";
type SortBy = "newest" | "title" | "points";

export default function QuizzesTab() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const [quizzes, setQuizzes] = useState<QuizItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sortBy, setSortBy] = useState<SortBy>("newest");

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

  const filtered = useMemo(() => {
    let list = quizzes;

    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (quiz) =>
          quiz.title.toLowerCase().includes(q) ||
          (quiz.classes?.subject ?? "").toLowerCase().includes(q)
      );
    }

    if (categoryFilter !== "all") {
      list = list.filter((quiz) => quiz.category === categoryFilter);
    }

    if (statusFilter !== "all") {
      list = list.filter((quiz) => (quiz.status ?? "draft") === statusFilter);
    }

    const sorted = [...list];
    sorted.sort((a, b) => {
      switch (sortBy) {
        case "newest":
          return (b.created_at ?? "").localeCompare(a.created_at ?? "");
        case "title":
          return a.title.localeCompare(b.title);
        case "points":
          return b.total_points - a.total_points;
        default:
          return 0;
      }
    });
    return sorted;
  }, [quizzes, search, categoryFilter, statusFilter, sortBy]);

  // category filter removed per user request

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
          {filtered.length} of {quizzes.length} quizzes
        </Text>
      </View>

      {/* Search */}
      <View style={styles.searchRow}>
        <View style={[styles.searchBox, { backgroundColor: colors.inputBackground, borderColor: colors.border }]}>
          <Ionicons name="search" size={16} color={colors.textMuted} />
          <TextInput
            style={[styles.searchInput, { color: colors.textPrimary }]}
            placeholder="Search by title or subject..."
            placeholderTextColor={colors.textMuted}
            value={search}
            onChangeText={setSearch}
            autoCorrect={false}
          />
          {search.length > 0 && (
            <Pressable onPress={() => setSearch("")}>
              <Ionicons name="close-circle" size={16} color={colors.textMuted} />
            </Pressable>
          )}
        </View>
      </View>

      {/* Status Filter */}
      <View style={styles.filterRow}>
        {([
          { key: "all", label: "All" },
          { key: "published", label: "Published" },
          { key: "draft", label: "Draft" },
          { key: "done", label: "Done" },
        ] as { key: StatusFilter; label: string }[]).map((opt) => (
          <Pressable
            key={opt.key}
            onPress={() => setStatusFilter(opt.key)}
            style={[
              styles.filterChip,
              { backgroundColor: colors.surface, borderColor: colors.border },
              statusFilter === opt.key && { backgroundColor: colors.accentDim, borderColor: colors.accent },
            ]}
          >
            <Text
              style={[
                styles.filterChipText,
                { color: colors.textMuted },
                statusFilter === opt.key && { color: colors.accent },
              ]}
            >
              {opt.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} size="large" />
        </View>
      ) : filtered.length === 0 ? (
        <View style={styles.center}>
          <View style={[styles.emptyIcon, { backgroundColor: colors.warningDim }]}>
            <Ionicons name="document-text-outline" size={32} color={colors.warning} />
          </View>
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
            {quizzes.length === 0 ? "No quizzes yet" : "No matching quizzes"}
          </Text>
          <Text style={[styles.emptySubtext, { color: colors.textMuted }]}>
            {quizzes.length === 0
              ? "Create quizzes from the web dashboard"
              : "Try adjusting your search or filters"}
          </Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
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
    paddingBottom: 8,
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
  searchRow: {
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    height: 40,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    padding: 0,
  },
  filterRow: {
    paddingHorizontal: 20,
    paddingBottom: 8,
    flexDirection: "row",
    gap: 8,
  },
  filterGroup: {
    flexDirection: "row",
    gap: 6,
  },
  filterChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
  filterChipText: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
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
