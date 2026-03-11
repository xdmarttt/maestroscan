import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  RefreshControl,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeInDown } from "react-native-reanimated";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import Colors from "@/constants/colors";
import { useAuth } from "@/lib/auth-context";
import { getDashboardStats } from "@/lib/queries";

interface Stats {
  totalStudents: number;
  quizzesThisMonth: number;
  totalClasses: number;
  pendingScans: number;
}

export default function HomeTab() {
  const insets = useSafeAreaInsets();
  const { profile, signOut } = useAuth();
  const [stats, setStats] = useState<Stats | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const loadStats = async () => {
    const data = await getDashboardStats();
    setStats(data);
  };

  useEffect(() => {
    loadStats();
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadStats();
    setRefreshing(false);
  };

  const firstName = profile?.full_name?.split(" ")[0] ?? "Teacher";

  const statCards = [
    { label: "Students", value: stats?.totalStudents ?? 0, icon: "people-outline" as const, color: Colors.accent },
    { label: "Quizzes", value: stats?.quizzesThisMonth ?? 0, icon: "document-text-outline" as const, color: Colors.warning },
    { label: "Classes", value: stats?.totalClasses ?? 0, icon: "book-outline" as const, color: Colors.success },
    { label: "Pending", value: stats?.pendingScans ?? 0, icon: "scan-outline" as const, color: Colors.error },
  ];

  return (
    <ScrollView
      style={[styles.container, { paddingTop: insets.top }]}
      contentContainerStyle={styles.contentContainer}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.accent} />}
    >
      <Animated.View entering={FadeInDown.duration(500)}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.greeting}>Hello, {firstName}!</Text>
            <Text style={styles.subtitle}>Here's your overview</Text>
          </View>
          <Pressable onPress={signOut} style={({ pressed }) => [styles.logoutBtn, pressed && { opacity: 0.6 }]}>
            <Ionicons name="log-out-outline" size={20} color={Colors.textSecondary} />
          </Pressable>
        </View>
      </Animated.View>

      <View style={styles.statsGrid}>
        {statCards.map((card, i) => (
          <Animated.View key={card.label} entering={FadeInDown.duration(400).delay(100 + i * 80)} style={styles.statCard}>
            <View style={[styles.statIcon, { backgroundColor: `${card.color}15` }]}>
              <Ionicons name={card.icon} size={20} color={card.color} />
            </View>
            <Text style={styles.statValue}>{card.value}</Text>
            <Text style={styles.statLabel}>{card.label}</Text>
          </Animated.View>
        ))}
      </View>

      <Animated.View entering={FadeInDown.duration(400).delay(500)}>
        {/* <Pressable
          onPress={() => router.push("/scan")}
          style={({ pressed }) => [styles.scanBtn, pressed && { opacity: 0.8 }]}
        >
          <MaterialCommunityIcons name="line-scan" size={22} color={Colors.background} />
          <Text style={styles.scanBtnText}>Quick Scan</Text>
        </Pressable> */}
      </Animated.View>

      <Animated.View entering={FadeInDown.duration(400).delay(600)} style={styles.quickActions}>
        <Text style={styles.sectionTitle}>Quick Actions</Text>
        <View style={styles.actionRow}>
          <Pressable
            onPress={() => router.push("/classes")}
            style={({ pressed }) => [styles.actionCard, pressed && { opacity: 0.7 }]}
          >
            <Ionicons name="book-outline" size={24} color={Colors.accent} />
            <Text style={styles.actionLabel}>My Classes</Text>
          </Pressable>
          <Pressable
            onPress={() => router.push("/quizzes")}
            style={({ pressed }) => [styles.actionCard, pressed && { opacity: 0.7 }]}
          >
            <Ionicons name="document-text-outline" size={24} color={Colors.warning} />
            <Text style={styles.actionLabel}>All Quizzes</Text>
          </Pressable>
          <Pressable
            onPress={() => router.push("/students")}
            style={({ pressed }) => [styles.actionCard, pressed && { opacity: 0.7 }]}
          >
            <Ionicons name="people-outline" size={24} color={Colors.success} />
            <Text style={styles.actionLabel}>Students</Text>
          </Pressable>
        </View>
      </Animated.View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  contentContainer: {
    padding: 20,
    paddingBottom: 40,
    gap: 24,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  greeting: {
    fontSize: 26,
    fontFamily: "Inter_700Bold",
    color: Colors.textPrimary,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: Colors.textSecondary,
    marginTop: 4,
  },
  logoutBtn: {
    padding: 8,
    borderRadius: 20,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  statCard: {
    width: "47%",
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 8,
  },
  statIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  statValue: {
    fontSize: 28,
    fontFamily: "Inter_700Bold",
    color: Colors.textPrimary,
    letterSpacing: -1,
  },
  statLabel: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    color: Colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
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
  quickActions: {
    gap: 14,
  },
  sectionTitle: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    color: Colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  actionRow: {
    flexDirection: "row",
    gap: 12,
  },
  actionCard: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    paddingVertical: 20,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  actionLabel: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    color: Colors.textSecondary,
  },
});
