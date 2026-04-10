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
import { useScanLimit } from "@/lib/scan-limit-context";

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
  const { profile } = useAuth();
  const { isDark, toggleTheme } = useTheme();
  const colors = useColors();
  const [stats, setStats] = useState<Stats | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const { used, limit, refresh: refreshLimit } = useScanLimit();

  const loadStats = async () => {
    const data = await getDashboardStats();
    setStats(data);
  };

  useEffect(() => {
    loadStats();
    refreshLimit();
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([loadStats(), refreshLimit()]);
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

      {/* Upgrade Banner (free tier only) */}
      {limit !== null && (
        <Animated.View entering={FadeInDown.duration(400).delay(200)}>
          <Pressable
            onPress={() => router.push("/upgrade" as any)}
            style={({ pressed }) => [
              styles.upgradeBanner,
              {
                backgroundColor: colors.surface,
                borderColor: colors.accent,
              },
              pressed && { opacity: 0.9, transform: [{ scale: 0.985 }] },
            ]}
          >
            <View style={[styles.upgradeBannerIcon, { backgroundColor: colors.accentDim }]}>
              <Ionicons name="rocket-outline" size={22} color={colors.accent} />
            </View>
            <View style={styles.upgradeBannerText}>
              <Text style={[styles.upgradeBannerTitle, { color: colors.textPrimary }]}>
                Upgrade to Solo
              </Text>
              <Text style={[styles.upgradeBannerSub, { color: colors.textSecondary }]}>
                Unlimited scans, AI quizzes & more — from ₱349/mo
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.accent} />
          </Pressable>
        </Animated.View>
      )}

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

      {/* Scan Limit (free tier only) */}
      {limit !== null && (
        <Animated.View entering={FadeInDown.duration(400).delay(550)}>
          <View
            style={[
              styles.scanLimitCard,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <View style={styles.scanLimitHeader}>
              <View style={[styles.statIcon, { backgroundColor: colors.accentDim }]}>
                <Ionicons name="scan-outline" size={20} color={colors.accent} />
              </View>
              <View style={styles.statTextCol}>
                <Text style={[styles.scanLimitValue, { color: colors.textPrimary }]}>
                  {Math.max(0, limit - used)} scans left
                </Text>
                <Text style={[styles.statLabel, { color: colors.textSecondary }]}>
                  {used} of {limit} used this month
                </Text>
              </View>
            </View>
            <View style={[styles.scanLimitBar, { backgroundColor: colors.border }]}>
              <View
                style={[
                  styles.scanLimitFill,
                  {
                    backgroundColor: used / limit > 0.9 ? colors.error : colors.accent,
                    width: `${Math.min(100, (used / limit) * 100)}%`,
                  },
                ]}
              />
            </View>
            <Pressable
              onPress={() => router.push("/upgrade" as any)}
              style={({ pressed }) => [
                styles.upgradeBtn,
                { backgroundColor: colors.accent },
                pressed && { opacity: 0.85 },
              ]}
            >
              <Ionicons name="rocket-outline" size={14} color="#FFFFFF" />
              <Text style={styles.upgradeBtnText}>Upgrade to Solo</Text>
            </Pressable>
          </View>
        </Animated.View>
      )}

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

  // Scan limit
  scanLimitCard: {
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    gap: 12,
  },
  scanLimitHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  scanLimitValue: {
    fontSize: 16,
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.3,
  },
  scanLimitBar: {
    height: 6,
    borderRadius: 3,
    overflow: "hidden",
  },
  scanLimitFill: {
    height: "100%",
    borderRadius: 3,
  },
  upgradeBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
    marginTop: 12,
  },
  upgradeBtnText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 13,
    color: "#FFFFFF",
  },
  upgradeBanner: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    borderRadius: 16,
    borderWidth: 1.5,
    gap: 12,
  },
  upgradeBannerIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  upgradeBannerText: {
    flex: 1,
  },
  upgradeBannerTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 15,
  },
  upgradeBannerSub: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    marginTop: 2,
  },
});
