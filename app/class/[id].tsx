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
import Colors from "@/constants/colors";
import { getClassById, getStudentsByClass, getQuizzesByClass } from "@/lib/queries";

export default function ClassDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
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
      <View style={[styles.container, styles.center, { paddingTop: insets.top }]}>
        <ActivityIndicator color={Colors.accent} size="large" />
      </View>
    );
  }

  if (!classData) {
    return (
      <View style={[styles.container, styles.center, { paddingTop: insets.top }]}>
        <Text style={styles.emptyText}>Class not found</Text>
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
          <Text style={styles.title}>{classData.subject}</Text>
          <Text style={styles.subtitle}>
            {classData.gradeLevel ? `Grade ${classData.gradeLevel}` : ""}
            {classData.section ? ` · ${classData.section}` : ""}
            {` · ${classData.quarter}`}
          </Text>
        </View>
      </View>

      <View style={styles.tabRow}>
        <Pressable
          onPress={() => setTab("quizzes")}
          style={[styles.tabBtn, tab === "quizzes" && styles.tabBtnActive]}
        >
          <Text style={[styles.tabText, tab === "quizzes" && styles.tabTextActive]}>
            Quizzes ({quizzes.length})
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setTab("students")}
          style={[styles.tabBtn, tab === "students" && styles.tabBtnActive]}
        >
          <Text style={[styles.tabText, tab === "students" && styles.tabTextActive]}>
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
              <Text style={styles.emptyText}>No quizzes for this class</Text>
            </View>
          }
          renderItem={({ item, index }) => (
            <Animated.View entering={FadeInDown.duration(300).delay(index * 40)}>
              <Pressable
                onPress={() => router.push({ pathname: "/quiz/[id]", params: { id: item.id } })}
                style={({ pressed }) => [styles.card, pressed && { opacity: 0.7 }]}
              >
                <View style={styles.cardRow}>
                  <Text style={styles.cardTitle}>{item.title}</Text>
                  <Text style={styles.cardPoints}>{item.total_points} pts</Text>
                </View>
                <Text style={styles.cardSub}>
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
              <Text style={styles.emptyText}>No students enrolled</Text>
            </View>
          }
          renderItem={({ item, index }: { item: any; index: number }) => (
            <Animated.View entering={FadeInDown.duration(300).delay(index * 30)}>
              <View style={styles.studentCard}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>
                    {item.full_name
                      ?.split(" ")
                      .map((w: string) => w[0])
                      .slice(0, 2)
                      .join("")
                      .toUpperCase() ?? "?"}
                  </Text>
                </View>
                <View style={styles.studentInfo}>
                  <Text style={styles.studentName}>{item.full_name}</Text>
                  <Text style={styles.studentDetail}>LRN: {item.lrn}</Text>
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
    fontSize: 22,
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
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  tabBtnActive: {
    backgroundColor: Colors.accentDim,
    borderColor: Colors.accent,
  },
  tabText: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    color: Colors.textMuted,
  },
  tabTextActive: {
    color: Colors.accent,
  },
  list: {
    padding: 20,
    paddingTop: 8,
    gap: 10,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border,
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
    color: Colors.textPrimary,
    flex: 1,
  },
  cardPoints: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    color: Colors.textSecondary,
  },
  cardSub: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: Colors.textMuted,
  },
  studentCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: Colors.surfaceElevated,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    fontSize: 13,
    fontFamily: "Inter_700Bold",
    color: Colors.accent,
  },
  studentInfo: {
    flex: 1,
    gap: 2,
  },
  studentName: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    color: Colors.textPrimary,
  },
  studentDetail: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: Colors.textMuted,
  },
  emptyCenter: {
    paddingVertical: 60,
    alignItems: "center",
  },
  emptyText: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
    color: Colors.textMuted,
  },
});
