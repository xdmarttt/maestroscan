import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  RefreshControl,
  Image,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeInDown, FadeIn } from "react-native-reanimated";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useAuth } from "@/lib/auth-context";
import { useTheme, useColors } from "@/lib/theme-context";
import { getDashboardStats } from "@/lib/queries";

const logoWhite = require("@/assets/images/logo-white.png");
const logoBlack = require("@/assets/images/logo-black.png");

interface Stats {
  totalStudents: number;
  quizzesThisMonth: number;
  totalClasses: number;
  pendingScans: number;
}

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

export default function HomeTab() {
  const insets = useSafeAreaInsets();
  const { profile, signOut } = useAuth();
  const { isDark, toggleTheme } = useTheme();
  const colors = useColors();
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
    {
      label: "Students",
      value: stats?.totalStudents ?? 0,
      icon: "people-outline" as const,
      color: colors.accent,
      bg: colors.accentDim,
    },
    {
      label: "Quizzes",
      value: stats?.quizzesThisMonth ?? 0,
      icon: "document-text-outline" as const,
      color: colors.warning,
      bg: colors.warningDim,
    },
    {
      label: "Classes",
      value: stats?.totalClasses ?? 0,
      icon: "book-outline" as const,
      color: colors.success,
      bg: colors.successDim,
    },
    {
      label: "Pending",
      value: stats?.pendingScans ?? 0,
      icon: "scan-outline" as const,
      color: colors.error,
      bg: colors.errorDim,
    },
  ];

  const quickActions = [
    {
      label: "My Classes",
      icon: "book-outline" as const,
      color: colors.accent,
      bg: colors.accentDim,
      route: "/classes" as const,
    },
    {
      label: "Quizzes",
      icon: "document-text-outline" as const,
      color: colors.warning,
      bg: colors.warningDim,
      route: "/quizzes" as const,
    },
    {
      label: "Students",
      icon: "people-outline" as const,
      color: colors.success,
      bg: colors.successDim,
      route: "/students" as const,
    },
  ];

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}
      contentContainerStyle={styles.contentContainer}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />
      }
    >
      {/* Header with logo, theme toggle, logout */}
      <Animated.View entering={FadeIn.duration(400)} style={styles.topBar}>
        <View style={styles.logoRow}>
          <Image source={isDark ? logoWhite : logoBlack} style={styles.logoImage} resizeMode="contain" />
          <Text style={[styles.logoText, { color: colors.textPrimary }]}>MaestroGrade</Text>
        </View>
        <View style={styles.topActions}>
          <Pressable
            onPress={toggleTheme}
            style={({ pressed }) => [
              styles.iconBtn,
              { backgroundColor: colors.surface, borderColor: colors.border },
              pressed && { opacity: 0.6 },
            ]}
          >
            <Ionicons
              name={isDark ? "sunny-outline" : "moon-outline"}
              size={18}
              color={isDark ? colors.warning : colors.accent}
            />
          </Pressable>
          <Pressable
            onPress={signOut}
            style={({ pressed }) => [
              styles.iconBtn,
              { backgroundColor: colors.surface, borderColor: colors.border },
              pressed && { opacity: 0.6 },
            ]}
          >
            <Ionicons name="log-out-outline" size={18} color={colors.textSecondary} />
          </Pressable>
        </View>
      </Animated.View>

      {/* Greeting */}
      <Animated.View entering={FadeInDown.duration(500).delay(100)}>
        <Text style={[styles.greeting, { color: colors.textPrimary }]}>
          {getGreeting()}, {firstName}
        </Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          Here's your teaching overview
        </Text>
      </Animated.View>

      {/* Stats grid */}
      <View style={styles.statsGrid}>
        {statCards.map((card, i) => (
          <Animated.View
            key={card.label}
            entering={FadeInDown.duration(400).delay(200 + i * 80)}
            style={[
              styles.statCard,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
                shadowColor: colors.cardShadow,
              },
            ]}
          >
            <View style={[styles.statIcon, { backgroundColor: card.bg }]}>
              <Ionicons name={card.icon} size={20} color={card.color} />
            </View>
            <Text style={[styles.statValue, { color: colors.textPrimary }]}>{card.value}</Text>
            <Text style={[styles.statLabel, { color: colors.textSecondary }]}>{card.label}</Text>
          </Animated.View>
        ))}
      </View>

      {/* Quick Actions */}
      <Animated.View entering={FadeInDown.duration(400).delay(550)} style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>Quick Actions</Text>
        <View style={styles.actionRow}>
          {quickActions.map((action) => (
            <Pressable
              key={action.label}
              onPress={() => router.push(action.route)}
              style={({ pressed }) => [
                styles.actionCard,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                  shadowColor: colors.cardShadow,
                },
                pressed && { opacity: 0.7, transform: [{ scale: 0.97 }] },
              ]}
            >
              <View style={[styles.actionIconWrap, { backgroundColor: action.bg }]}>
                <Ionicons name={action.icon} size={22} color={action.color} />
              </View>
              <Text style={[styles.actionLabel, { color: colors.textPrimary }]}>{action.label}</Text>
            </Pressable>
          ))}
        </View>
      </Animated.View>

      {/* Tip card */}
      <Animated.View entering={FadeInDown.duration(400).delay(650)}>
        <View
          style={[
            styles.tipCard,
            { backgroundColor: colors.accentDim, borderColor: colors.accent },
          ]}
        >
          <View style={styles.tipHeader}>
            <MaterialCommunityIcons name="lightbulb-on-outline" size={20} color={colors.accent} />
            <Text style={[styles.tipTitle, { color: colors.accent }]}>Quick Tip</Text>
          </View>
          <Text style={[styles.tipText, { color: colors.textSecondary }]}>
            Open a quiz and tap "Quick Scan" to start scanning answer sheets instantly with your camera.
          </Text>
        </View>
      </Animated.View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  contentContainer: {
    padding: 20,
    paddingBottom: 40,
    gap: 24,
  },
  topBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  logoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  logoImage: {
    width: 30,
    height: 30,
  },
  logoText: {
    fontSize: 18,
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.3,
  },
  topActions: {
    flexDirection: "row",
    gap: 8,
  },
  iconBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  greeting: {
    fontSize: 26,
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    marginTop: 4,
  },
  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  statCard: {
    width: "47%",
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    gap: 8,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 8,
    shadowOpacity: 1,
    elevation: 2,
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
    letterSpacing: -1,
  },
  statLabel: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  section: {
    gap: 14,
  },
  sectionTitle: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  actionRow: {
    flexDirection: "row",
    gap: 12,
  },
  actionCard: {
    flex: 1,
    borderRadius: 16,
    paddingVertical: 20,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    borderWidth: 1,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 8,
    shadowOpacity: 1,
    elevation: 2,
  },
  actionIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  actionLabel: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
  },
  tipCard: {
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    gap: 8,
  },
  tipHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  tipTitle: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
  tipText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    lineHeight: 20,
  },
});
