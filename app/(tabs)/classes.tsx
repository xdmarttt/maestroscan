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
import { getClasses } from "@/lib/queries";

interface ClassItem {
  id: string;
  subject: string;
  gradeLevel: string | null;
  section: string | null;
  schoolYear: string;
  quarter: "Q1" | "Q2" | "Q3" | "Q4";
  studentCount: number;
  createdAt: string | null;
}

type SortBy = "newest" | "subject" | "students";

export default function ClassesTab() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortBy>("newest");

  const load = async () => {
    const data = await getClasses();
    setClasses(data);
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
    let list = classes;

    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (c) =>
          c.subject.toLowerCase().includes(q) ||
          (c.section ?? "").toLowerCase().includes(q) ||
          (c.gradeLevel ?? "").toLowerCase().includes(q)
      );
    }

    const sorted = [...list];
    sorted.sort((a, b) => {
      switch (sortBy) {
        case "newest":
          return (b.createdAt ?? "").localeCompare(a.createdAt ?? "");
        case "subject":
          return a.subject.localeCompare(b.subject);
        case "students":
          return b.studentCount - a.studentCount;
        default:
          return 0;
      }
    });
    return sorted;
  }, [classes, search, sortBy]);

  const sortOptions: { key: SortBy; label: string }[] = [
    { key: "newest", label: "Newest" },
    { key: "subject", label: "Subject" },
    { key: "students", label: "Students" },
  ];

  const renderClass = ({ item, index }: { item: ClassItem; index: number }) => (
    <Animated.View entering={FadeInDown.duration(400).delay(index * 60)}>
      <Pressable
        onPress={() => router.push({ pathname: "/class/[id]", params: { id: item.id } })}
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
        <View style={styles.cardHeader}>
          <View style={[styles.subjectBadge, { backgroundColor: colors.accentDim }]}>
            <Ionicons name="book" size={16} color={colors.accent} />
          </View>
          <View style={styles.cardMeta}>
            <Text
              style={[
                styles.quarterBadge,
                { color: colors.accent, backgroundColor: colors.accentDim },
              ]}
            >
              {item.quarter}
            </Text>
          </View>
        </View>
        <Text style={[styles.subject, { color: colors.textPrimary }]}>{item.subject}</Text>
        <Text style={[styles.detail, { color: colors.textSecondary }]}>
          {item.gradeLevel ? `Grade ${item.gradeLevel}` : ""}
          {item.section ? ` · ${item.section}` : ""}
        </Text>
        <View style={styles.cardFooter}>
          <Ionicons name="people-outline" size={14} color={colors.textMuted} />
          <Text style={[styles.footerText, { color: colors.textMuted }]}>
            {item.studentCount} students
          </Text>
          <Text style={[styles.footerDot, { color: colors.textMuted }]}>·</Text>
          <Text style={[styles.footerText, { color: colors.textMuted }]}>{item.schoolYear}</Text>
        </View>
      </Pressable>
    </Animated.View>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.textPrimary }]}>Classes</Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          {filtered.length} of {classes.length} classes
        </Text>
      </View>

      {/* Search */}
      <View style={styles.searchRow}>
        <View style={[styles.searchBox, { backgroundColor: colors.inputBackground, borderColor: colors.border }]}>
          <Ionicons name="search" size={16} color={colors.textMuted} />
          <TextInput
            style={[styles.searchInput, { color: colors.textPrimary }]}
            placeholder="Search by subject, section..."
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

      {/* Sort */}
      <View style={styles.filterRow}>
        <Text style={[styles.filterLabel, { color: colors.textMuted }]}>Sort:</Text>
        {sortOptions.map((opt) => (
          <Pressable
            key={opt.key}
            onPress={() => setSortBy(opt.key)}
            style={[
              styles.filterChip,
              { backgroundColor: colors.surface, borderColor: colors.border },
              sortBy === opt.key && { backgroundColor: colors.accentDim, borderColor: colors.accent },
            ]}
          >
            <Text
              style={[
                styles.filterChipText,
                { color: colors.textMuted },
                sortBy === opt.key && { color: colors.accent },
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
          <View style={[styles.emptyIcon, { backgroundColor: colors.accentDim }]}>
            <Ionicons name="book-outline" size={32} color={colors.accent} />
          </View>
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
            {classes.length === 0 ? "No classes yet" : "No matching classes"}
          </Text>
          <Text style={[styles.emptySubtext, { color: colors.textMuted }]}>
            {classes.length === 0
              ? "Create classes from the web dashboard"
              : "Try adjusting your search"}
          </Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          renderItem={renderClass}
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
    alignItems: "center",
    gap: 8,
  },
  filterLabel: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
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
    gap: 8,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 8,
    shadowOpacity: 1,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  subjectBadge: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  cardMeta: {
    flexDirection: "row",
    gap: 8,
  },
  quarterBadge: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    overflow: "hidden",
  },
  subject: {
    fontSize: 18,
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.3,
  },
  detail: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
  },
  cardFooter: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 4,
  },
  footerText: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
  footerDot: {
    fontSize: 12,
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
