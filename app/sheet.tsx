import React from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Platform,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import Colors from "@/constants/colors";
import { QuizQuestion, DEFAULT_QUIZ } from "@/lib/quiz-storage";

// ─── Sheet dimensions (must match server/scan.ts) ─────────────────────────────
const SHEET_W = 320;
const SHEET_H = 450;

// Registration mark: 20×20 black square, 9.6px from each edge
// Centers: TL(19.6,28)  TR(300.4,28)  BL(19.6,422)  BR(300.4,422)
const MARK_SIZE = 20;
const MARK_OFFSET_X = 9.6; // from left/right edge
const MARK_OFFSET_Y = 18; // from top/bottom edge

// Bubble grid (normalized → pixel)
// col A(0) nx=0.25  B(1) nx=0.40  C(2) nx=0.55  D(3) nx=0.70
// row 0 ny=0.22  1 ny=0.35  2 ny=0.48  3 ny=0.61  4 ny=0.74
const BUBBLE_D = 22; // diameter
const BUBBLE_R = BUBBLE_D / 2;
const LETTERS = ["A", "B", "C", "D"];

function bubblePx(row: number, col: number) {
  return {
    left: (0.25 + col * 0.15) * SHEET_W - BUBBLE_R,
    top: (0.22 + row * 0.13) * SHEET_H - BUBBLE_R,
  };
}

// ─── Component ─────────────────────────────────────────────────────────────────
export default function SheetScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ questions?: string }>();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  let questions: QuizQuestion[] = DEFAULT_QUIZ.questions;
  if (params.questions) {
    try {
      questions = JSON.parse(params.questions);
    } catch {}
  }

  return (
    <View style={[styles.screen, { paddingTop: topPad }]}>
      {/* Header bar */}
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.6 }]}
        >
          <Ionicons name="chevron-back" size={24} color={Colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle}>Answer Sheet</Text>
        <View style={{ width: 32 }} />
      </View>

      {/* Instruction banner */}
      <View style={styles.banner}>
        <Ionicons name="print-outline" size={14} color={Colors.accent} />
        <Text style={styles.bannerText}>
          Screenshot this sheet and print it for students
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: bottomPad + 24 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Printable sheet ── */}
        <View style={styles.sheetContainer}>
          {/* Registration marks */}
          <View style={[styles.regMark, { left: MARK_OFFSET_X, top: MARK_OFFSET_Y }]} />
          <View style={[styles.regMark, { right: MARK_OFFSET_X, top: MARK_OFFSET_Y }]} />
          <View style={[styles.regMark, { left: MARK_OFFSET_X, bottom: MARK_OFFSET_Y }]} />
          <View style={[styles.regMark, { right: MARK_OFFSET_X, bottom: MARK_OFFSET_Y }]} />

          {/* Title */}
          <Text style={styles.sheetTitle}>GradeSnap</Text>
          <Text style={styles.sheetSubtitle}>Answer Sheet  •  5 Questions</Text>

          {/* Column headers: A B C D */}
          {LETTERS.map((letter, col) => (
            <Text
              key={letter}
              style={[
                styles.colHeader,
                {
                  left: (0.25 + col * 0.15) * SHEET_W - 8,
                  top: 0.22 * SHEET_H - 26,
                },
              ]}
            >
              {letter}
            </Text>
          ))}

          {/* Bubbles + question number labels */}
          {Array.from({ length: 5 }).map((_, row) => (
            <React.Fragment key={row}>
              {/* Row label */}
              <Text
                style={[
                  styles.rowLabel,
                  { top: (0.22 + row * 0.13) * SHEET_H - 8 },
                ]}
              >
                {row + 1}
              </Text>

              {/* Bubbles */}
              {LETTERS.map((_, col) => {
                const { left, top } = bubblePx(row, col);
                return (
                  <View
                    key={col}
                    style={[styles.bubble, { left, top }]}
                  />
                );
              })}
            </React.Fragment>
          ))}

          {/* Footer note */}
          <Text style={styles.sheetFooter}>
            Fill circles completely with dark pencil or pen
          </Text>
        </View>

        {/* Question reference */}
        <View style={styles.keySection}>
          <Text style={styles.keySectionTitle}>Questions on this quiz</Text>
          {questions.map((q) => (
            <View key={q.id} style={styles.keyRow}>
              <View style={styles.keyNumBadge}>
                <Text style={styles.keyNum}>{q.id}</Text>
              </View>
              <Text style={styles.keyText} numberOfLines={2}>{q.text}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backBtn: { padding: 4 },
  headerTitle: {
    flex: 1,
    fontSize: 20,
    fontFamily: "Inter_700Bold",
    color: Colors.textPrimary,
    textAlign: "center",
  },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginHorizontal: 16,
    marginBottom: 16,
    backgroundColor: Colors.accentDim,
    borderWidth: 1,
    borderColor: Colors.accent,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  bannerText: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    color: Colors.accent,
    flex: 1,
  },
  scrollContent: {
    alignItems: "center",
    paddingHorizontal: 16,
    gap: 24,
  },

  // ── Printable sheet ──
  sheetContainer: {
    width: SHEET_W,
    height: SHEET_H,
    backgroundColor: "#FFFFFF",
    borderRadius: 4,
    position: "relative",
    // shadow so it looks like paper
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 8,
  },
  regMark: {
    position: "absolute",
    width: MARK_SIZE,
    height: MARK_SIZE,
    backgroundColor: "#000000",
  },
  sheetTitle: {
    position: "absolute",
    top: 52,
    left: 0,
    right: 0,
    textAlign: "center",
    fontSize: 15,
    fontWeight: "800",
    color: "#000",
    letterSpacing: -0.3,
  },
  sheetSubtitle: {
    position: "absolute",
    top: 72,
    left: 0,
    right: 0,
    textAlign: "center",
    fontSize: 10,
    color: "#444",
  },
  colHeader: {
    position: "absolute",
    width: 16,
    textAlign: "center",
    fontSize: 11,
    fontWeight: "700",
    color: "#000",
  },
  rowLabel: {
    position: "absolute",
    left: SHEET_W * 0.12,
    width: 20,
    textAlign: "right",
    fontSize: 11,
    fontWeight: "600",
    color: "#333",
  },
  bubble: {
    position: "absolute",
    width: BUBBLE_D,
    height: BUBBLE_D,
    borderRadius: BUBBLE_R,
    borderWidth: 1.5,
    borderColor: "#000000",
    backgroundColor: "#FFFFFF",
  },
  sheetFooter: {
    position: "absolute",
    bottom: 30,
    left: 0,
    right: 0,
    textAlign: "center",
    fontSize: 9,
    color: "#666",
    fontStyle: "italic",
  },

  // ── Question reference ──
  keySection: {
    width: "100%",
    gap: 10,
  },
  keySectionTitle: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    color: Colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 2,
  },
  keyRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  keyNumBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: Colors.accentDim,
    borderWidth: 1,
    borderColor: Colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  keyNum: {
    fontSize: 12,
    fontFamily: "Inter_700Bold",
    color: Colors.accent,
  },
  keyText: {
    flex: 1,
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: Colors.textPrimary,
    lineHeight: 18,
  },
});
