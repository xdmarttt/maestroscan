import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  Platform,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated";
import { useColors } from "@/lib/theme-context";
import { useScanLimit } from "@/lib/scan-limit-context";
import { useIAP, IAP_PRODUCTS } from "@/lib/iap";

type BillingInterval = "monthly" | "yearly";

const SOLO_PLANS = {
  monthly: {
    sku: IAP_PRODUCTS.SOLO_MONTHLY,
    price: "₱349",
    label: "per month",
    note: "Flexible monthly billing",
  },
  yearly: {
    sku: IAP_PRODUCTS.SOLO_YEARLY,
    price: "₱3,490",
    label: "per year",
    note: "Save ₱698 — just ₱291/mo",
  },
} as const;

const SOLO_FEATURES = [
  { icon: "infinite-outline" as const, text: "Unlimited scans & quizzes" },
  { icon: "sparkles-outline" as const, text: "80 AI quiz generations / month" },
  { icon: "cloud-upload-outline" as const, text: "5 GB upload storage" },
  { icon: "layers-outline" as const, text: "5 saved header templates" },
  { icon: "people-outline" as const, text: "1 owner + 2 invited teachers" },
  { icon: "school-outline" as const, text: "Unlimited active classes" },
];

export default function UpgradeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const { tier } = useScanLimit();
  const { isPurchasing, purchase, purchaseSuccess } = useIAP();

  const isSolo = tier === "solo";

  const [interval, setInterval] = useState<BillingInterval>("yearly");
  const plan = SOLO_PLANS[interval];

  // Auto-dismiss after successful purchase
  useEffect(() => {
    if (purchaseSuccess) {
      router.back();
    }
  }, [purchaseSuccess]);

  // Determine button text based on current state
  const getButtonText = () => {
    if (isSolo) {
      // Already on Solo — switching interval
      return `Switch to ${plan.price} / ${interval === "yearly" ? "year" : "month"}`;
    }
    return `Subscribe for ${plan.price} / ${interval === "yearly" ? "year" : "month"}`;
  };

  const handlePurchase = () => {
    purchase(plan.sku);
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="close" size={28} color={colors.textPrimary} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>
          {isSolo ? "Change Plan" : "Upgrade to Solo"}
        </Text>
        <View style={{ width: 28 }} />
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + 24 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero */}
        <Animated.View entering={FadeIn.duration(400)} style={styles.hero}>
          <View
            style={[styles.heroIcon, { backgroundColor: colors.accentDim }]}
          >
            <Ionicons
              name={isSolo ? "swap-horizontal-outline" : "rocket-outline"}
              size={40}
              color={colors.accent}
            />
          </View>
          <Text style={[styles.heroTitle, { color: colors.textPrimary }]}>
            {isSolo ? "Switch billing cycle" : "Unlock unlimited scanning"}
          </Text>
          <Text style={[styles.heroSubtitle, { color: colors.textSecondary }]}>
            {isSolo
              ? "Choose monthly flexibility or save with an annual plan. Your features stay the same."
              : "Go beyond 200 scans/month with the Solo plan. Full access to all premium features."}
          </Text>
        </Animated.View>

        {/* Billing Toggle */}
        <Animated.View
          entering={FadeInDown.duration(400).delay(100)}
          style={[
            styles.toggleWrap,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <Pressable
            onPress={() => setInterval("monthly")}
            style={[
              styles.toggleBtn,
              interval === "monthly" && { backgroundColor: colors.accent },
            ]}
          >
            <Text
              style={[
                styles.toggleText,
                { color: interval === "monthly" ? "#FFFFFF" : colors.textSecondary },
              ]}
            >
              Monthly
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setInterval("yearly")}
            style={[
              styles.toggleBtn,
              interval === "yearly" && { backgroundColor: colors.accent },
            ]}
          >
            <Text
              style={[
                styles.toggleText,
                { color: interval === "yearly" ? "#FFFFFF" : colors.textSecondary },
              ]}
            >
              Yearly
            </Text>
            {interval !== "yearly" && (
              <View style={[styles.saveBadge, { backgroundColor: colors.successDim }]}>
                <Text style={[styles.saveBadgeText, { color: colors.success }]}>
                  Save 16%
                </Text>
              </View>
            )}
          </Pressable>
        </Animated.View>

        {/* Price Card */}
        <Animated.View
          entering={FadeInDown.duration(400).delay(200)}
          style={[
            styles.priceCard,
            { backgroundColor: colors.surface, borderColor: colors.accent },
          ]}
        >
          <View style={styles.priceRow}>
            <Text style={[styles.priceAmount, { color: colors.textPrimary }]}>
              {plan.price}
            </Text>
            <Text style={[styles.priceLabel, { color: colors.textSecondary }]}>
              {plan.label}
            </Text>
          </View>
          <Text style={[styles.priceNote, { color: colors.textMuted }]}>
            {plan.note}
          </Text>
          {isSolo && interval === "yearly" && (
            <View style={[styles.switchNote, { backgroundColor: colors.accentDim }]}>
              <Ionicons name="arrow-up-outline" size={14} color={colors.accent} />
              <Text style={[styles.switchNoteText, { color: colors.accent }]}>
                Upgrade — takes effect at next renewal
              </Text>
            </View>
          )}
          {isSolo && interval === "monthly" && (
            <View style={[styles.switchNote, { backgroundColor: colors.warningDim }]}>
              <Ionicons name="arrow-down-outline" size={14} color={colors.warning} />
              <Text style={[styles.switchNoteText, { color: colors.warning }]}>
                Downgrade — takes effect at next renewal
              </Text>
            </View>
          )}
        </Animated.View>

        {/* Features */}
        {!isSolo && (
          <Animated.View entering={FadeInDown.duration(400).delay(300)}>
            <Text style={[styles.featuresTitle, { color: colors.textPrimary }]}>
              Everything in Solo
            </Text>
            {SOLO_FEATURES.map((feature, i) => (
              <View key={i} style={styles.featureRow}>
                <View style={[styles.featureIcon, { backgroundColor: colors.accentDim }]}>
                  <Ionicons name={feature.icon} size={18} color={colors.accent} />
                </View>
                <Text style={[styles.featureText, { color: colors.textSecondary }]}>
                  {feature.text}
                </Text>
              </View>
            ))}
          </Animated.View>
        )}

        {/* Purchase Button */}
        <Animated.View entering={FadeInDown.duration(400).delay(isSolo ? 300 : 400)}>
          <Pressable
            onPress={handlePurchase}
            disabled={isPurchasing}
            style={({ pressed }) => [
              styles.purchaseBtn,
              { backgroundColor: colors.accent },
              pressed && { opacity: 0.85 },
              isPurchasing && { opacity: 0.6 },
            ]}
          >
            {isPurchasing ? (
              <ActivityIndicator color="#FFFFFF" size="small" />
            ) : (
              <Text style={styles.purchaseBtnText}>{getButtonText()}</Text>
            )}
          </Pressable>

          {/* Legal */}
          <Text style={[styles.legal, { color: colors.textMuted }]}>
            {Platform.OS === "ios"
              ? "Payment will be charged to your Apple ID account at confirmation. Subscription automatically renews unless canceled at least 24 hours before the end of the current period. Manage subscriptions in Settings > Apple ID > Subscriptions."
              : "Payment will be charged to your Google Play account. Subscription automatically renews unless canceled before the end of the current period."}
          </Text>
        </Animated.View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  headerTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 17,
  },
  content: {
    paddingHorizontal: 20,
    gap: 24,
  },
  hero: { alignItems: "center", gap: 12, marginTop: 8 },
  heroIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  heroTitle: {
    fontFamily: "Inter_700Bold",
    fontSize: 24,
    textAlign: "center",
  },
  heroSubtitle: {
    fontFamily: "Inter_400Regular",
    fontSize: 15,
    textAlign: "center",
    lineHeight: 22,
    paddingHorizontal: 12,
  },
  toggleWrap: {
    flexDirection: "row",
    borderRadius: 12,
    borderWidth: 1,
    padding: 4,
  },
  toggleBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 6,
  },
  toggleText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
  },
  saveBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  saveBadgeText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 11,
  },
  priceCard: {
    borderRadius: 16,
    borderWidth: 2,
    padding: 24,
    alignItems: "center",
    gap: 4,
  },
  priceRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 8,
  },
  priceAmount: {
    fontFamily: "Inter_700Bold",
    fontSize: 36,
  },
  priceLabel: {
    fontFamily: "Inter_500Medium",
    fontSize: 15,
  },
  priceNote: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
  },
  switchNote: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    marginTop: 8,
  },
  switchNoteText: {
    fontFamily: "Inter_500Medium",
    fontSize: 12,
  },
  featuresTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 16,
    marginBottom: 4,
  },
  featureRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 12,
  },
  featureIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  featureText: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    flex: 1,
  },
  purchaseBtn: {
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  purchaseBtnText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 16,
    color: "#FFFFFF",
  },
  legal: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    textAlign: "center",
    lineHeight: 16,
    marginTop: 12,
    paddingHorizontal: 8,
  },
});
