import React, { useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
} from "react-native";
import { router } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/lib/auth-context";
import { useColors } from "@/lib/theme-context";
import { useScanLimit } from "@/lib/scan-limit-context";
import type { SubscriptionTier } from "@/lib/entitlements";

const TIER_LABELS: Record<SubscriptionTier, string> = {
  free: "Free",
  solo: "Solo",
  school: "School",
  enterprise: "Enterprise",
};

const TIER_DESCRIPTIONS: Record<SubscriptionTier, string> = {
  free: "200 scans/month · 5 classes · 1 teacher",
  solo: "Unlimited scans · 80 AI generations · 3 teachers",
  school: "Unlimited everything · Full access · Activity logs",
  enterprise: "Custom scope · White-label · Priority support",
};

export default function ProfileTab() {
  const insets = useSafeAreaInsets();
  const { session, profile, signOut } = useAuth();
  const colors = useColors();
  const { tier, used, limit, refresh } = useScanLimit();

  // Re-fetch tier every time this tab comes into focus
  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh])
  );

  const isFree = tier === "free";
  const email = session?.user?.email ?? "";

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <Animated.View entering={FadeIn.duration(400)}>
        <Text style={[styles.screenTitle, { color: colors.textPrimary }]}>Profile</Text>
      </Animated.View>

      {/* Profile Card */}
      <Animated.View entering={FadeInDown.duration(400).delay(100)}>
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={[styles.avatar, { backgroundColor: colors.accentDim }]}>
            <Text style={[styles.avatarText, { color: colors.accent }]}>
              {profile?.full_name?.charAt(0)?.toUpperCase() ?? "?"}
            </Text>
          </View>
          <Text style={[styles.name, { color: colors.textPrimary }]}>
            {profile?.full_name ?? "Teacher"}
          </Text>
          {email ? (
            <Text style={[styles.email, { color: colors.textSecondary }]}>
              {email}
            </Text>
          ) : null}

          {/* Details */}
          <View style={[styles.detailsWrap, { borderTopColor: colors.border }]}>
            <View style={styles.detailRow}>
              <Ionicons name="briefcase-outline" size={16} color={colors.textMuted} />
              <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>Role</Text>
              <Text style={[styles.detailValue, { color: colors.textPrimary }]}>
                {profile?.role === "teacher" ? "Teacher" : profile?.role ?? "—"}
              </Text>
            </View>
          </View>
        </View>
      </Animated.View>

      {/* Subscription Card */}
      <Animated.View entering={FadeInDown.duration(400).delay(200)}>
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.sectionHeader}>
            <Ionicons name="card-outline" size={20} color={colors.accent} />
            <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>
              Subscription
            </Text>
          </View>

          {/* Current Plan */}
          <View style={[styles.planRow, { backgroundColor: colors.background, borderColor: colors.border }]}>
            <View>
              <View style={styles.planNameRow}>
                <Text style={[styles.planName, { color: colors.textPrimary }]}>
                  {TIER_LABELS[tier]}
                </Text>
                <View style={[
                  styles.planBadge,
                  { backgroundColor: isFree ? colors.warningDim : colors.successDim },
                ]}>
                  <Text style={[
                    styles.planBadgeText,
                    { color: isFree ? colors.warning : colors.success },
                  ]}>
                    {isFree ? "Free Plan" : "Active"}
                  </Text>
                </View>
              </View>
              <Text style={[styles.planDesc, { color: colors.textSecondary }]}>
                {TIER_DESCRIPTIONS[tier]}
              </Text>
            </View>
          </View>

          {/* Usage (free tier) */}
          {limit !== null && (
            <View style={styles.usageSection}>
              <View style={styles.usageRow}>
                <Text style={[styles.usageLabel, { color: colors.textSecondary }]}>
                  Scans this month
                </Text>
                <Text style={[styles.usageValue, { color: colors.textPrimary }]}>
                  {used} / {limit}
                </Text>
              </View>
              <View style={[styles.usageBar, { backgroundColor: colors.border }]}>
                <View
                  style={[
                    styles.usageFill,
                    {
                      backgroundColor: used / limit > 0.9 ? colors.error : colors.accent,
                      width: `${Math.min(100, (used / limit) * 100)}%`,
                    },
                  ]}
                />
              </View>
            </View>
          )}

          {/* Upgrade Button (free tier) */}
          {isFree && (
            <Pressable
              onPress={() => router.push("/upgrade" as any)}
              style={({ pressed }) => [
                styles.upgradeBtn,
                { backgroundColor: colors.accent },
                pressed && { opacity: 0.85 },
              ]}
            >
              <Ionicons name="rocket-outline" size={16} color="#FFFFFF" />
              <Text style={styles.upgradeBtnText}>Upgrade to Solo</Text>
            </Pressable>
          )}
        </View>
      </Animated.View>

      {/* Actions */}
      <Animated.View entering={FadeInDown.duration(400).delay(300)}>
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          {isFree && (
            <Pressable
              onPress={() => router.push("/upgrade" as any)}
              style={({ pressed }) => [
                styles.actionRow,
                { borderBottomColor: colors.border },
                pressed && { opacity: 0.7 },
              ]}
            >
              <View style={[styles.actionIcon, { backgroundColor: colors.accentDim }]}>
                <Ionicons name="rocket-outline" size={18} color={colors.accent} />
              </View>
              <Text style={[styles.actionText, { color: colors.textPrimary }]}>
                Manage Subscription
              </Text>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </Pressable>
          )}

          <Pressable
            onPress={signOut}
            style={({ pressed }) => [
              styles.actionRow,
              { borderBottomWidth: 0 },
              pressed && { opacity: 0.7 },
            ]}
          >
            <View style={[styles.actionIcon, { backgroundColor: colors.errorDim }]}>
              <Ionicons name="log-out-outline" size={18} color={colors.error} />
            </View>
            <Text style={[styles.actionText, { color: colors.error }]}>
              Sign Out
            </Text>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </Pressable>
        </View>
      </Animated.View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 20, gap: 20 },
  screenTitle: {
    fontFamily: "Inter_700Bold",
    fontSize: 28,
    marginBottom: 4,
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 20,
    gap: 16,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
  },
  avatarText: {
    fontFamily: "Inter_700Bold",
    fontSize: 26,
  },
  name: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 20,
    textAlign: "center",
  },
  email: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    textAlign: "center",
    marginTop: -8,
  },
  detailsWrap: {
    borderTopWidth: 1,
    paddingTop: 12,
    gap: 10,
  },
  detailRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  detailLabel: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    flex: 1,
  },
  detailValue: {
    fontFamily: "Inter_500Medium",
    fontSize: 13,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  sectionTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 16,
  },
  planRow: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
  },
  planNameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 4,
  },
  planName: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 16,
  },
  planBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  planBadgeText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 11,
  },
  planDesc: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
  },
  usageSection: { gap: 6 },
  usageRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  usageLabel: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
  },
  usageValue: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 13,
  },
  usageBar: {
    height: 6,
    borderRadius: 3,
    overflow: "hidden",
  },
  usageFill: {
    height: "100%",
    borderRadius: 3,
  },
  upgradeBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
  },
  upgradeBtnText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 15,
    color: "#FFFFFF",
  },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  actionIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  actionText: {
    fontFamily: "Inter_500Medium",
    fontSize: 15,
    flex: 1,
  },
});
