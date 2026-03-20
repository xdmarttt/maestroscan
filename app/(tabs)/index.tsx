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
import Animated, { FadeInDown, FadeIn } from "react-native-reanimated";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useAuth } from "@/lib/auth-context";
import { useTheme, useColors } from "@/lib/theme-context";
import { getDashboardStats } from "@/lib/queries";

import MaestroLogo from "@/components/MaestroLogo";

interface Stats {
  totalStudents: number;
  quizzesThisMonth: number;
  totalClasses: number;
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
      icon: "people" as const,
      color: colors.accent,
      bg: colors.accentDim,
      route: "/students" as const,
    },
    {
      label: "Quizzes",
      value: stats?.quizzesThisMonth ?? 0,
      icon: "document-text" as const,
      color: colors.warning,
      bg: colors.warningDim,
      route: "/quizzes" as const,
    },
    {
      label: "Classes",
      value: stats?.totalClasses ?? 0,
      icon: "book" as const,
      color: colors.success,
      bg: colors.successDim,
      route: "/classes" as const,
    },
  ];

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}
      contentContainerStyle={styles.contentContainer}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />
      }
    >
      {/* Top bar */}
      <Animated.View entering={FadeIn.duration(400)} style={styles.topBar}>
        <View style={styles.logoRow}>
          <MaestroLogo size={30} />
          <Text style={[styles.logoText, { color: colors.textPrimary }]}>MaestroScan</Text>
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

      {/* Hero greeting */}
      <Animated.View
        entering={FadeInDown.duration(500).delay(100)}
        style={[styles.heroCard, { backgroundColor: colors.accent }]}
      >
        <View style={styles.heroContent}>
          <Text style={styles.heroGreeting}>
            {getGreeting()},
          </Text>
          <Text style={styles.heroName}>{firstName}</Text>
          <Text style={styles.heroSubtitle}>
            Here's your teaching overview
          </Text>
        </View>
        <View style={styles.heroIconWrap}>
          <MaestroLogo size={64} />
        </View>
      </Animated.View>

      {/* Stats */}
      <View style={styles.statsList}>
        {statCards.map((card, i) => (
          <Animated.View key={card.label} entering={FadeInDown.duration(400).delay(250 + i * 80)}>
            <Pressable
              onPress={() => router.push(card.route)}
              style={({ pressed }) => [
                styles.statRow,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                },
                pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] },
              ]}
            >
              <View style={[styles.statIcon, { backgroundColor: card.bg }]}>
                <Ionicons name={card.icon} size={20} color={card.color} />
              </View>
              <View style={styles.statTextCol}>
                <Text style={[styles.statValue, { color: colors.textPrimary }]}>{card.value}</Text>
                <Text style={[styles.statLabel, { color: colors.textSecondary }]}>{card.label}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </Pressable>
          </Animated.View>
        ))}
      </View>

      {/* Tip */}
      <Animated.View entering={FadeInDown.duration(400).delay(650)}>
        <View
          style={[
            styles.tipCard,
            { backgroundColor: colors.accentDim, borderColor: colors.accent + "30" },
          ]}
        >
          <View style={styles.tipHeader}>
            <MaterialCommunityIcons name="lightbulb-on-outline" size={18} color={colors.accent} />
            <Text style={[styles.tipTitle, { color: colors.accent }]}>Tip</Text>
          </View>
          <Text style={[styles.tipText, { color: colors.textSecondary }]}>
            Open a quiz and tap "Quick Scan" to grade answer sheets instantly.
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
    gap: 20,
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

  // Hero
  heroCard: {
    borderRadius: 20,
    padding: 24,
    flexDirection: "row",
    alignItems: "center",
    overflow: "hidden",
  },
  heroContent: {
    flex: 1,
  },
  heroGreeting: {
    fontSize: 15,
    fontFamily: "Inter_500Medium",
    color: "rgba(255,255,255,0.75)",
  },
  heroName: {
    fontSize: 28,
    fontFamily: "Inter_700Bold",
    color: "#FFFFFF",
    letterSpacing: -0.5,
    marginTop: 2,
  },
  heroSubtitle: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: "rgba(255,255,255,0.6)",
    marginTop: 6,
  },
  heroIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 16,
    overflow: "hidden",
    opacity: 0.25,
  },

  // Stats
  statsList: {
    gap: 10,
  },
  statRow: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    gap: 14,
  },
  statIcon: {
    width: 44,
    height: 44,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  statTextCol: {
    flex: 1,
    gap: 1,
  },
  statValue: {
    fontSize: 22,
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.5,
  },
  statLabel: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },

  // Tip
  tipCard: {
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    gap: 6,
  },
  tipHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  tipTitle: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },
  tipText: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    lineHeight: 18,
  },
});
