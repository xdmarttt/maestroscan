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
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeInDown } from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/lib/theme-context";
import { getAllStudents } from "@/lib/queries";

interface StudentItem {
  id: string;
  full_name: string;
  lrn: string;
  grade_level: string | null;
  section: string | null;
  status: string | null;
  access_code: string;
}

type StatusFilter = "all" | "active" | "inactive";
type SortBy = "name" | "lrn" | "grade";

export default function StudentsTab() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const [students, setStudents] = useState<StudentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sortBy, setSortBy] = useState<SortBy>("name");

  const load = async () => {
    const data = await getAllStudents();
    setStudents(data as StudentItem[]);
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
    let list = students;

    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (s) =>
          s.full_name.toLowerCase().includes(q) ||
          s.lrn.toLowerCase().includes(q)
      );
    }

    if (statusFilter !== "all") {
      list = list.filter((s) => (s.status ?? "active") === statusFilter);
    }

    const sorted = [...list];
    sorted.sort((a, b) => {
      switch (sortBy) {
        case "name":
          return a.full_name.localeCompare(b.full_name);
        case "lrn":
          return a.lrn.localeCompare(b.lrn);
        case "grade":
          return (a.grade_level ?? "").localeCompare(b.grade_level ?? "");
        default:
          return 0;
      }
    });
    return sorted;
  }, [students, search, statusFilter, sortBy]);

  const statusOptions: { key: StatusFilter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "active", label: "Active" },
    { key: "inactive", label: "Inactive" },
  ];

  const sortOptions: { key: SortBy; label: string }[] = [
    { key: "name", label: "Name" },
    { key: "lrn", label: "LRN" },
    { key: "grade", label: "Grade" },
  ];

  const renderStudent = ({ item, index }: { item: StudentItem; index: number }) => (
    <Animated.View entering={FadeInDown.duration(300).delay(index * 30)}>
      <View
        style={[
          styles.card,
          {
            backgroundColor: colors.surface,
            borderColor: colors.border,
            shadowColor: colors.cardShadow,
          },
        ]}
      >
        <View style={[styles.avatar, { backgroundColor: colors.accentDim }]}>
          <Text style={[styles.avatarText, { color: colors.accent }]}>
            {item.full_name
              .split(" ")
              .map((w) => w[0])
              .slice(0, 2)
              .join("")
              .toUpperCase()}
          </Text>
        </View>
        <View style={styles.info}>
          <Text style={[styles.name, { color: colors.textPrimary }]}>{item.full_name}</Text>
          <Text style={[styles.detail, { color: colors.textMuted }]}>
            LRN: {item.lrn}
            {item.grade_level ? ` · Grade ${item.grade_level}` : ""}
            {item.section ? ` · ${item.section}` : ""}
          </Text>
        </View>
        <View
          style={[
            styles.statusBadge,
            {
              backgroundColor:
                item.status === "active" ? colors.successDim : colors.errorDim,
            },
          ]}
        >
          <View
            style={[
              styles.statusDot,
              {
                backgroundColor:
                  item.status === "active" ? colors.success : colors.error,
              },
            ]}
          />
        </View>
      </View>
    </Animated.View>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.textPrimary }]}>Students</Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          {filtered.length} of {students.length} students
        </Text>
      </View>

      {/* Search */}
      <View style={styles.searchRow}>
        <View style={[styles.searchBox, { backgroundColor: colors.inputBackground, borderColor: colors.border }]}>
          <Ionicons name="search" size={16} color={colors.textMuted} />
          <TextInput
            style={[styles.searchInput, { color: colors.textPrimary }]}
            placeholder="Search by name or LRN..."
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

      {/* Filters */}
      <View style={styles.filterRow}>
        <View style={styles.filterGroup}>
          {statusOptions.map((opt) => (
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
        <View style={styles.filterGroup}>
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
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} size="large" />
        </View>
      ) : filtered.length === 0 ? (
        <View style={styles.center}>
          <View style={[styles.emptyIcon, { backgroundColor: colors.successDim }]}>
            <Ionicons name="people-outline" size={32} color={colors.success} />
          </View>
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
            {students.length === 0 ? "No students yet" : "No matching students"}
          </Text>
          <Text style={[styles.emptySubtext, { color: colors.textMuted }]}>
            {students.length === 0
              ? "Add students from the web dashboard"
              : "Try adjusting your search or filters"}
          </Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          renderItem={renderStudent}
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
    justifyContent: "space-between",
    gap: 12,
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
    gap: 8,
  },
  card: {
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 4,
    shadowOpacity: 1,
    elevation: 1,
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    fontSize: 14,
    fontFamily: "Inter_700Bold",
  },
  info: {
    flex: 1,
    gap: 2,
  },
  name: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
  },
  detail: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
  statusBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
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
