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
import { computeGridLayout, SHEET_W, SHEET_H } from "@/lib/grid-layout";

// Registration mark: 20×20 black square, 9.6px from each edge
const MARK_SIZE = 20;
const MARK_OFFSET_X = 9.6;
const MARK_OFFSET_Y = 18;
const MID_SIZE = 10; // Midpoint marks: smaller than corners so detector ignores them

export default function SheetScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ questions?: string; choiceCount?: string }>();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  let questions: QuizQuestion[] = DEFAULT_QUIZ.questions;
  if (params.questions) {
    try {
      questions = JSON.parse(params.questions);
    } catch {}
  }

  const choiceCount = (params.choiceCount === "5" ? 5 : 4) as 4 | 5;
  const layout = computeGridLayout(questions.length, choiceCount);

  const bubbleD = layout.bubbleDiameterSheet;
  const bubbleR = bubbleD / 2;

  return (
    <View style={[styles.screen, { paddingTop: topPad }]}>
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
        {/* Printable sheet */}
        <View style={styles.sheetContainer}>
          {/* Registration marks — 4 corners */}
          <View style={[styles.regMark, { left: MARK_OFFSET_X, top: MARK_OFFSET_Y }]} />
          <View style={[styles.regMark, { right: MARK_OFFSET_X, top: MARK_OFFSET_Y }]} />
          <View style={[styles.regMark, { left: MARK_OFFSET_X, bottom: MARK_OFFSET_Y }]} />
          <View style={[styles.regMark, { right: MARK_OFFSET_X, bottom: MARK_OFFSET_Y }]} />

          {/* Midpoint marks — smaller squares at left & right edges */}
          <View style={[styles.midMark, { left: MARK_OFFSET_X + (MARK_SIZE - MID_SIZE) / 2, top: (SHEET_H - MID_SIZE) / 2 }]} />
          <View style={[styles.midMark, { right: MARK_OFFSET_X + (MARK_SIZE - MID_SIZE) / 2, top: (SHEET_H - MID_SIZE) / 2 }]} />

          {/* Header bar — bordered */}
          <View style={styles.headerBar}>
            <Text style={styles.brandText}>GRADESNAP</Text>
            <Text style={styles.sheetTitle}>ANSWER SHEET</Text>
            <Text style={styles.sheetSubtitle}>
              {questions.length} Question{questions.length !== 1 ? "s" : ""} · {choiceCount} Choices
            </Text>
          </View>

          {/* Student name line */}
          <Text style={styles.studentName}>
            Name: ___________________________
          </Text>

          {/* Divider */}
          <View style={styles.divider} />
          <Text style={styles.dividerLabel}>ANSWER SECTION</Text>

          {/* Per-column headers: A B C D [E] */}
          {Array.from({ length: layout.questionColumns }).map((_, qCol) => (
            <React.Fragment key={`hdr-${qCol}`}>
              {layout.letters.map((letter, c) => {
                const q0 = qCol * layout.questionsPerColumn;
                const { nx } = layout.bubbleCenter(q0, c);
                const { ny } = layout.bubbleCenter(q0, 0);
                const fontSize = Math.max(7, Math.min(11, bubbleD * 0.55));
                return (
                  <Text
                    key={`${qCol}-${letter}`}
                    style={[
                      styles.colHeader,
                      {
                        left: nx * SHEET_W - 8,
                        top: ny * SHEET_H - bubbleD - 6,
                        fontSize,
                      },
                    ]}
                  >
                    {letter}
                  </Text>
                );
              })}
            </React.Fragment>
          ))}

          {/* Bubbles + row labels */}
          {Array.from({ length: questions.length }).map((_, q) => (
            <React.Fragment key={q}>
              {/* Row label */}
              <Text
                style={[
                  styles.rowLabel,
                  {
                    left: layout.labelX(q) * SHEET_W - 10,
                    top: layout.bubbleCenter(q, 0).ny * SHEET_H - Math.max(5, bubbleD * 0.35),
                    fontSize: Math.max(6, Math.min(11, bubbleD * 0.55)),
                  },
                ]}
              >
                {q + 1}
              </Text>

              {/* Bubbles */}
              {layout.letters.map((_, c) => {
                const { nx, ny } = layout.bubbleCenter(q, c);
                return (
                  <View
                    key={`${q}-${c}`}
                    style={[
                      styles.bubble,
                      {
                        left: nx * SHEET_W - bubbleR,
                        top: ny * SHEET_H - bubbleR,
                        width: bubbleD,
                        height: bubbleD,
                        borderRadius: bubbleR,
                      },
                    ]}
                  />
                );
              })}
            </React.Fragment>
          ))}

          {/* Student ID barcode region — bottom of sheet */}
          <View style={styles.idDivider} />
          <Text style={styles.idSectionLabel}>STUDENT NO.</Text>
          <View style={styles.barcodePlaceholder}>
            <View style={styles.barcodePlaceholderInner} />
          </View>

          <Text style={styles.sheetFooter}>
            Fill circles completely with dark pencil or pen
          </Text>
        </View>

        {/* Question reference (only show text if ≤10 questions and they have text) */}
        {questions.length <= 10 && questions.some((q) => q.text) && (
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
        )}
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
  sheetContainer: {
    width: SHEET_W,
    height: SHEET_H,
    backgroundColor: "#FFFFFF",
    borderRadius: 4,
    position: "relative",
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
  midMark: {
    position: "absolute",
    width: MID_SIZE,
    height: MID_SIZE,
    backgroundColor: "#000000",
  },
  headerBar: {
    position: "absolute",
    top: 50,
    left: 32,
    right: 32,
    height: 38,
    backgroundColor: "#fff",
    borderWidth: 1.5,
    borderColor: "#000",
    borderRadius: 2,
    paddingLeft: 8,
    paddingTop: 3,
    justifyContent: "center",
  },
  brandText: {
    fontSize: 5.5,
    fontWeight: "700",
    color: "#999",
    letterSpacing: 0.5,
  },
  sheetTitle: {
    fontSize: 13,
    fontWeight: "800",
    color: "#000",
    letterSpacing: -0.2,
    marginTop: 1,
  },
  sheetSubtitle: {
    fontSize: 6,
    color: "#555",
    marginTop: 1,
  },
  studentName: {
    position: "absolute",
    top: 112,
    left: 36,
    fontSize: 7,
    color: "#333",
    fontWeight: "500",
  },
  divider: {
    position: "absolute",
    top: 126,
    left: 32,
    right: 32,
    height: 1,
    backgroundColor: "#ccc",
  },
  dividerLabel: {
    position: "absolute",
    top: 130,
    left: 32,
    fontSize: 7,
    fontWeight: "700",
    color: "#222",
  },
  colHeader: {
    position: "absolute",
    width: 16,
    textAlign: "center",
    fontWeight: "700",
    color: "#000",
  },
  rowLabel: {
    position: "absolute",
    width: 20,
    textAlign: "right",
    fontWeight: "600",
    color: "#333",
  },
  bubble: {
    position: "absolute",
    borderWidth: 1.5,
    borderColor: "#000000",
    backgroundColor: "#FFFFFF",
  },
  idDivider: {
    position: "absolute",
    top: 0.84 * SHEET_H,
    left: 32,
    right: 32,
    height: 1,
    backgroundColor: "#ccc",
  },
  idSectionLabel: {
    position: "absolute",
    top: 0.845 * SHEET_H,
    left: 36,
    fontSize: 6,
    fontWeight: "700",
    color: "#222",
    letterSpacing: 0.5,
  },
  barcodePlaceholder: {
    position: "absolute",
    top: 0.855 * SHEET_H,
    left: 0.25 * SHEET_W,
    width: 0.50 * SHEET_W,
    height: 0.045 * SHEET_H,
    borderWidth: 1,
    borderColor: "#ccc",
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
  },
  barcodePlaceholderInner: {
    width: "60%",
    height: "60%",
    backgroundColor: "#eee",
    borderRadius: 2,
  },
  sheetFooter: {
    position: "absolute",
    bottom: 30,
    left: 0,
    right: 0,
    textAlign: "center",
    fontSize: 7,
    color: "#888",
    fontStyle: "italic",
  },
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
