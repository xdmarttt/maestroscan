import React, { useEffect, useState } from "react";
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
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeInDown } from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/lib/theme-context";
import { getClassById, getStudentsByClass, getQuizzesByClass } from "@/lib/queries";

export default function ClassDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const [classData, setClassData] = useState<any>(null);
  const [students, setStudents] = useState<any[]>([]);
  const [quizzes, setQuizzes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"students" | "quizzes">("quizzes");

  useEffect(() => {
    if (!id) return;
    Promise.all([
      getClassById(id),
      getStudentsByClass(id),
      getQuizzesByClass(id),
    ]).then(([cls, sts, qzs]) => {
      setClassData(cls);
      setStudents(sts);
      setQuizzes(qzs);
      setLoading(false);
    });
  }, [id]);

  if (loading) {
    return (
      <View style={[styles.container, styles.center, { paddingTop: insets.top, backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  if (!classData) {
    return (
      <View style={[styles.container, styles.center, { paddingTop: insets.top, backgroundColor: colors.background }]}>
        <Text style={[styles.emptyText, { color: colors.textMuted }]}>Class not found</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top, backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          style={[styles.backBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </Pressable>
        <View style={styles.headerInfo}>
          <Text style={[styles.title, { color: colors.textPrimary }]}>{classData.subject}</Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            {classData.gradeLevel ? `Grade ${classData.gradeLevel}` : ""}
            {classData.section ? ` · ${classData.section}` : ""}
            {` · ${classData.quarter}`}
          </Text>
        </View>
      </View>

      <View style={styles.tabRow}>
        <Pressable
          onPress={() => setTab("quizzes")}
          style={[
            styles.tabBtn,
            { backgroundColor: colors.surface, borderColor: colors.border },
            tab === "quizzes" && { backgroundColor: colors.accentDim, borderColor: colors.accent },
          ]}
        >
          <Text
            style={[
              styles.tabText,
              { color: colors.textMuted },
              tab === "quizzes" && { color: colors.accent },
            ]}
          >
            Quizzes ({quizzes.length})
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setTab("students")}
          style={[
            styles.tabBtn,
            { backgroundColor: colors.surface, borderColor: colors.border },
            tab === "students" && { backgroundColor: colors.accentDim, borderColor: colors.accent },
          ]}
        >
          <Text
            style={[
              styles.tabText,
              { color: colors.textMuted },
              tab === "students" && { color: colors.accent },
            ]}
          >
            Students ({students.length})
          </Text>
        </Pressable>
      </View>

      {tab === "quizzes" ? (
        <FlatList
          data={quizzes}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.emptyCenter}>
              <Text style={[styles.emptyText, { color: colors.textMuted }]}>No quizzes for this class</Text>
            </View>
          }
          renderItem={({ item, index }) => (
            <Animated.View entering={FadeInDown.duration(300).delay(index * 40)}>
              <Pressable
                onPress={() => router.push({ pathname: "/quiz/[id]", params: { id: item.id } })}
                style={({ pressed }) => [
                  styles.card,
                  { backgroundColor: colors.surface, borderColor: colors.border },
                  pressed && { opacity: 0.7 },
                ]}
              >
                <View style={styles.cardRow}>
                  <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>{item.title}</Text>
                  <Text style={[styles.cardPoints, { color: colors.textSecondary }]}>{item.total_points} pts</Text>
                </View>
                <Text style={[styles.cardSub, { color: colors.textMuted }]}>
                  {item.category} · {item.status ?? "draft"}
                </Text>
              </Pressable>
            </Animated.View>
          )}
        />
      ) : (
        <FlatList
          data={students}
          keyExtractor={(item: any) => item.id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.emptyCenter}>
              <Text style={[styles.emptyText, { color: colors.textMuted }]}>No students enrolled</Text>
            </View>
          }
          renderItem={({ item, index }: { item: any; index: number }) => (
            <Animated.View entering={FadeInDown.duration(300).delay(index * 30)}>
              <View
                style={[
                  styles.studentCard,
                  { backgroundColor: colors.surface, borderColor: colors.border },
                ]}
              >
                <View style={[styles.avatar, { backgroundColor: colors.surfaceElevated }]}>
                  <Text style={[styles.avatarText, { color: colors.accent }]}>
                    {item.full_name
                      ?.split(" ")
                      .map((w: string) => w[0])
                      .slice(0, 2)
                      .join("")
                      .toUpperCase() ?? "?"}
                  </Text>
                </View>
                <View style={styles.studentInfo}>
                  <Text style={[styles.studentName, { color: colors.textPrimary }]}>{item.full_name}</Text>
                  <Text style={[styles.studentDetail, { color: colors.textMuted }]}>LRN: {item.lrn}</Text>
                </View>
              </View>
            </Animated.View>
          )}
        />
      )}
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
    paddingBottom: 12,
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
    fontSize: 22,
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    marginTop: 2,
  },
  tabRow: {
    flexDirection: "row",
    paddingHorizontal: 20,
    gap: 8,
    marginBottom: 8,
  },
  tabBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
  },
  tabText: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
  },
  list: {
    padding: 20,
    paddingTop: 8,
    gap: 10,
  },
  card: {
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    gap: 4,
  },
  cardRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  cardTitle: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    flex: 1,
  },
  cardPoints: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
  },
  cardSub: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
  studentCard: {
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    fontSize: 13,
    fontFamily: "Inter_700Bold",
  },
  studentInfo: {
    flex: 1,
    gap: 2,
  },
  studentName: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
  studentDetail: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
  emptyCenter: {
    paddingVertical: 60,
    alignItems: "center",
  },
  emptyText: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
  },
});
