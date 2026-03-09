import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Platform,
  Dimensions,
  Alert,
} from "react-native";
import { router } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withSequence,
  Easing,
  interpolate,
  FadeIn,
  FadeInDown,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import * as ImageManipulator from "expo-image-manipulator";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import Colors from "@/constants/colors";
import { CameraScanner, useCameraPermissions } from "@/components/CameraScanner";
import { loadQuiz, QuizQuestion } from "@/lib/quiz-storage";
import { detectAndScan, scanSheet } from "@/lib/scan-offline";

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");
// Big square viewfinder — easy to aim at the paper like ZipGrade
const FRAME_W = SCREEN_WIDTH * 0.92;
const FRAME_H = FRAME_W; // square
// 4 individual square targets for each corner registration mark
// The answer sheet is 320×450 (portrait). Inside the square viewfinder,
// the sheet fills the height, so paper width = FRAME_W × (320/450).
const PAPER_IN_FRAME_W = FRAME_W * (320 / 450);
const PAPER_OFFSET_X = (FRAME_W - PAPER_IN_FRAME_W) / 2;
// Mark centers in the viewfinder (accounting for centered portrait sheet)
const MARK_X = [
  PAPER_OFFSET_X + (19.6 / 320) * PAPER_IN_FRAME_W,   // left marks
  PAPER_OFFSET_X + (300.4 / 320) * PAPER_IN_FRAME_W,   // right marks
];
const MARK_Y = [
  (28.0 / 450) * FRAME_H,   // top marks
  (422.0 / 450) * FRAME_H,  // bottom marks
];
const TARGET_SIZE = 64;

// Orient → crop to frame area → resize. Returns base64 JPEG or null.
// Optimized: single ImageManipulator call using photo dimensions from camera.
async function cropToFrame(
  photoUri: string,
  photoW: number,
  photoH: number,
  framePos: { x: number; y: number; width: number; height: number },
  targetWidth: number,
  compress: number,
): Promise<string | null> {
  const allActions: ImageManipulator.Action[] = [];
  let w = photoW;
  let h = photoH;
  if (w > h) {
    allActions.push({ rotate: 90 });
    [w, h] = [h, w];
  }
  const imgPxPerPt = Math.min(w / SCREEN_WIDTH, h / SCREEN_HEIGHT);
  const coverOffX = Math.max(0, (w - SCREEN_WIDTH * imgPxPerPt) / 2);
  const coverOffY = Math.max(0, (h - SCREEN_HEIGHT * imgPxPerPt) / 2);
  const MARGIN = 0.08;
  const ix0 = Math.round(Math.max(0, coverOffX + (framePos.x - framePos.width * MARGIN) * imgPxPerPt));
  const iy0 = Math.round(Math.max(0, coverOffY + (framePos.y - framePos.height * MARGIN) * imgPxPerPt));
  const ix1 = Math.round(Math.min(w, coverOffX + (framePos.x + framePos.width * (1 + MARGIN)) * imgPxPerPt));
  const iy1 = Math.round(Math.min(h, coverOffY + (framePos.y + framePos.height * (1 + MARGIN)) * imgPxPerPt));
  if (ix1 - ix0 <= 0 || iy1 - iy0 <= 0) return null;
  allActions.push(
    { crop: { originX: ix0, originY: iy0, width: ix1 - ix0, height: iy1 - iy0 } },
    { resize: { width: targetWidth } },
  );
  const result = await ImageManipulator.manipulateAsync(
    photoUri,
    allActions,
    { compress, format: ImageManipulator.SaveFormat.JPEG, base64: true },
  );
  return result.base64 ?? null;
}

// No CornerBracket — using a single rounded-border box like ZipGrade


export default function ScannerScreen() {
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [isScanning, setIsScanning] = useState(false);
  const [scanDone, setScanDone] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [choiceCount, setChoiceCount] = useState<4 | 5>(4);
  const [sheetDetected, setSheetDetected] = useState(false);
  const cameraRef = useRef<any>(null);
  const frameRef = useRef<View>(null);
  const isScanningRef = useRef(false);
  const isDetectingRef = useRef(false);
  const framePosRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
  const detectLoopRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Measure frame once and cache — position is static
  const getFramePos = useCallback(async () => {
    if (framePosRef.current) return framePosRef.current;
    if (!frameRef.current) return null;
    const pos = await new Promise<{ x: number; y: number; width: number; height: number }>(
      (resolve) => {
        (frameRef.current as any).measureInWindow(
          (x: number, y: number, w: number, h: number) => resolve({ x, y, width: w, height: h })
        );
      }
    );
    framePosRef.current = pos;
    return pos;
  }, []);

  // Single-pass detect+scan poll: captures a frame, runs detection and (if found)
  // full bubble scanning in one OpenCV session. Navigates to results instantly.
  // Chain-based: schedules next poll immediately after current completes (no wasted interval).
  const runDetect = useCallback(async () => {
    if (isScanningRef.current || isDetectingRef.current || !cameraRef.current || !frameRef.current) {
      // Retry shortly if not ready yet
      detectLoopRef.current = setTimeout(runDetect, 200);
      return;
    }
    if (questions.length === 0) {
      detectLoopRef.current = setTimeout(runDetect, 500);
      return;
    }
    isDetectingRef.current = true;
    let navigating = false;
    try {
      const t0 = Date.now();
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.7,
        base64: false,
        skipProcessing: true,
      });
      const t1 = Date.now();
      const framePos = await getFramePos();
      if (!framePos) { setSheetDetected(false); return; }
      const b64 = await cropToFrame(photo.uri, photo.width, photo.height, framePos, 800, 0.7);
      const t2 = Date.now();
      if (!b64) { setSheetDetected(false); return; }

      const result = await detectAndScan(b64, questions, choiceCount);
      const t3 = Date.now();
      console.log(`[perf] capture=${t1-t0}ms crop=${t2-t1}ms scan=${t3-t2}ms total=${t3-t0}ms`);
      if (!result.found) { setSheetDetected(false); return; }

      // Sheet found and scanned in one pass — navigate immediately
      console.log(`[scan] found! student=${result.studentName ?? 'none'} quizId=${result.quizId ?? 'none'}`);
      navigating = true;
      setSheetDetected(true);
      isScanningRef.current = true;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setIsScanning(true);
      setScanDone(true);
      // Brief pause so user sees green feedback before navigation
      await new Promise((r) => setTimeout(r, 200));
      router.push({
        pathname: "/results",
        params: {
          answers: JSON.stringify(result.answers),
          questions: JSON.stringify(questions),
          choiceCount: String(choiceCount),
          corners: JSON.stringify(result.corners),
          imageSize: JSON.stringify(result.imageSize),
          // debugImage: b64,
          ...(result.studentName ? { studentName: result.studentName } : {}),
        },
      });
    } catch {
      // silent — detection errors don't block scanning
    } finally {
      isDetectingRef.current = false;
      // Chain: schedule next detection unless we're navigating to results
      // 300ms gap gives camera time to adjust exposure/focus between captures
      if (!navigating) {
        detectLoopRef.current = setTimeout(runDetect, 300);
      }
    }
  }, [questions, choiceCount, getFramePos]);

  // Reset scan state and start live detection every time this screen is focused
  useFocusEffect(
    useCallback(() => {
      isScanningRef.current = false;
      isDetectingRef.current = false;
      setIsScanning(false);
      setScanDone(false);
      setScanError(null);
      setSheetDetected(false);
      framePosRef.current = null; // re-measure on focus (in case layout shifted)
      // Start chain-based detection loop
      detectLoopRef.current = setTimeout(runDetect, 100);
      return () => {
        if (detectLoopRef.current) clearTimeout(detectLoopRef.current);
        detectLoopRef.current = null;
        setSheetDetected(false);
      };
    }, [runDetect])
  );

  const scanLineY = useSharedValue(0);
  const frameGlow = useSharedValue(0);
  const pulseScale = useSharedValue(1);

  useFocusEffect(
    useCallback(() => {
      loadQuiz().then((config) => {
        setQuestions(config.questions);
        setChoiceCount(config.choiceCount);
      });
    }, [])
  );

  useEffect(() => {
    scanLineY.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 2000, easing: Easing.linear }),
        withTiming(0, { duration: 2000, easing: Easing.linear })
      ),
      -1,
      false
    );
    frameGlow.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 1500 }),
        withTiming(0.3, { duration: 1500 })
      ),
      -1,
      true
    );
    pulseScale.value = withRepeat(
      withSequence(
        withTiming(1.04, { duration: 1200, easing: Easing.inOut(Easing.ease) }),
        withTiming(1, { duration: 1200, easing: Easing.inOut(Easing.ease) })
      ),
      -1,
      true
    );
  }, []);

  // No auto-detect — user manually aligns the sheet to the corner brackets and taps Scan

  const scanLineStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: interpolate(scanLineY.value, [0, 1], [0, FRAME_H]) },
    ],
    opacity: isScanning ? 1 : 0.5,
  }));

  const frameGlowStyle = useAnimatedStyle(() => ({
    opacity: frameGlow.value,
    shadowOpacity: frameGlow.value * 0.8,
  }));

  const pulseStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulseScale.value }],
  }));

  // Manual scan button fallback — takes a fresh high-quality photo
  const handleScan = useCallback(async () => {
    if (isScanningRef.current) return;
    isScanningRef.current = true;
    setScanError(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setIsScanning(true);

    try {
      if (!cameraRef.current) throw new Error("Camera not ready");

      const framePos = await new Promise<{ x: number; y: number; width: number; height: number }>(
        (resolve, reject) => {
          if (!frameRef.current) return reject(new Error("frame ref not ready"));
          (frameRef.current as any).measureInWindow(
            (x: number, y: number, w: number, h: number) => resolve({ x, y, width: w, height: h })
          );
        }
      );
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.9,
        base64: false,
        skipProcessing: false,
      });
      const base64 = await cropToFrame(photo.uri, photo.width, photo.height, framePos, 1200, 0.85);
      if (!base64) throw new Error("Image capture failed");

      const data = await scanSheet(base64, questions, choiceCount);
      if (!data.answers) {
        throw new Error("Fit the sheet inside the frame and try again");
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setScanDone(true);
      await new Promise((r) => setTimeout(r, 300));

      router.push({
        pathname: "/results",
        params: {
          answers: JSON.stringify(data.answers),
          questions: JSON.stringify(questions),
          choiceCount: String(choiceCount),
          corners: "[]",
          imageSize: "[]",
        },
      });
    } catch (err: any) {
      console.error("Scan failed:", err);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setScanError(err?.message ?? "Scan failed — try aligning the sheet.");
    } finally {
      isScanningRef.current = false;
      setIsScanning(false);
      setScanDone(false);
    }
  }, [questions, choiceCount]);

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  if (!permission) {
    return (
      <View style={[styles.container, styles.center]}>
        <Text style={styles.permissionText}>Initializing camera...</Text>
      </View>
    );
  }

  if (!permission.granted && Platform.OS !== "web") {
    return (
      <View style={[styles.container, { paddingTop: topPad }]}>
        <Animated.View entering={FadeIn.duration(500)} style={styles.permissionContainer}>
          <View style={styles.permissionIconWrap}>
            <Ionicons name="camera-outline" size={52} color={Colors.accent} />
          </View>
          <Text style={styles.permissionTitle}>Camera Access Needed</Text>
          <Text style={styles.permissionBody}>
            GradeSnap uses your camera to scan answer sheets and calculate scores instantly.
          </Text>
          <Pressable
            onPress={requestPermission}
            style={({ pressed }) => [styles.permissionBtn, pressed && { opacity: 0.8 }]}
          >
            <Text style={styles.permissionBtnText}>Allow Camera</Text>
          </Pressable>
        </Animated.View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <CameraScanner ref={cameraRef} />

      <View style={[StyleSheet.absoluteFill, styles.overlay]} />

      <Animated.View
        entering={FadeInDown.duration(500).delay(100)}
        style={[styles.header, { paddingTop: topPad + 8 }]}
      >
        <View style={styles.headerRow}>
          <View style={styles.logoRow}>
            <MaterialCommunityIcons name="scan-helper" size={22} color={Colors.accent} />
            <Text style={styles.appName}>GradeSnap</Text>
          </View>
          <View style={styles.headerActions}>
            <Pressable
              onPress={() => router.push("/setup")}
              style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.6 }]}
            >
              <Ionicons name="settings-outline" size={20} color={Colors.textSecondary} />
            </Pressable>
            <Pressable
              onPress={() =>
                router.push({
                  pathname: "/sheet",
                  params: { questions: JSON.stringify(questions), choiceCount: String(choiceCount) },
                })
              }
              style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.6 }]}
            >
              <Ionicons name="document-outline" size={20} color={Colors.textSecondary} />
            </Pressable>
          </View>
        </View>
        <Text style={[styles.headerSub, sheetDetected && { color: Colors.success }]}>
          {sheetDetected ? "Sheet detected — scanning..." : "Point camera at the answer sheet"}
        </Text>
      </Animated.View>

      <View style={styles.frameContainer}>
        <Animated.View ref={frameRef} style={[styles.frameWrapper, pulseStyle]}>
          <Animated.View style={[styles.frameGlow, frameGlowStyle]} />

          <View style={styles.frame}>
            {/* 4 corner target squares — one per registration mark */}
            {([
              { top: MARK_Y[0] - TARGET_SIZE / 2, left: MARK_X[0] - TARGET_SIZE / 2 },
              { top: MARK_Y[0] - TARGET_SIZE / 2, left: MARK_X[1] - TARGET_SIZE / 2 },
              { top: MARK_Y[1] - TARGET_SIZE / 2, left: MARK_X[0] - TARGET_SIZE / 2 },
              { top: MARK_Y[1] - TARGET_SIZE / 2, left: MARK_X[1] - TARGET_SIZE / 2 },
            ] as const).map((pos, i) => (
              <View
                key={i}
                style={[
                  styles.targetBox,
                  { top: pos.top, left: pos.left },
                  sheetDetected && styles.targetBoxDetected,
                ]}
              />
            ))}

            <Animated.View style={[styles.scanLine, scanLineStyle]} />

            <View style={styles.frameInner}>
              {isScanning ? (
                <Animated.View entering={FadeIn.duration(300)} style={styles.scanningBadge}>
                  <MaterialCommunityIcons name="line-scan" size={16} color={Colors.accent} />
                  <Text style={styles.scanningText}>
                    {scanDone ? "Captured!" : "Scanning..."}
                  </Text>
                </Animated.View>
              ) : (
                <View style={styles.framePlaceholder}>
                  <MaterialCommunityIcons
                    name="text-box-check-outline"
                    size={36}
                    color="rgba(0,198,255,0.25)"
                  />
                </View>
              )}
            </View>
          </View>
        </Animated.View>

        <Animated.View entering={FadeInDown.duration(500).delay(200)}>
          <Text style={styles.frameLabel}>Align 4 corner squares with targets — scans automatically</Text>
        </Animated.View>
      </View>

      <Animated.View
        entering={FadeInDown.duration(500).delay(300)}
        style={[styles.bottomPanel, { paddingBottom: bottomPad + 16 }]}
      >
        <View style={styles.answerKeyHeader}>
          <Text style={styles.answerKeyTitle}>Answer Key</Text>
          <View style={styles.answerKeyDot} />
          <Text style={styles.answerKeyCount}>{questions.length} Questions</Text>
        </View>

        <View style={styles.answerKeyRow}>
          {questions.map((q) => (
            <View key={q.id} style={styles.answerKeyItem}>
              <Text style={styles.answerKeyQNum}>Q{q.id}</Text>
              <View style={styles.answerKeyBubble}>
                <Text style={styles.answerKeyLetter}>{q.correct}</Text>
              </View>
            </View>
          ))}
        </View>

        {scanError && (
          <View style={styles.errorRow}>
            <Ionicons name="warning-outline" size={14} color={Colors.error} />
            <Text style={styles.errorText}>{scanError}</Text>
          </View>
        )}

        <Pressable
          onPress={handleScan}
          disabled={isScanning || questions.length === 0}
          style={({ pressed }) => [
            styles.scanBtn,
            isScanning && styles.scanBtnScanning,
            pressed && !isScanning && {
              opacity: 0.9,
              transform: [{ scale: 0.97 }],
            },
          ]}
        >
          <MaterialCommunityIcons
            name="line-scan"
            size={20}
            color={isScanning ? Colors.textSecondary : Colors.background}
          />
          <Text
            style={[
              styles.scanBtnText,
              isScanning && { color: Colors.textSecondary },
            ]}
          >
            {isScanning
              ? scanDone
                ? "Processing..."
                : "Scanning..."
              : "Scan Sheet"}
          </Text>
        </Pressable>
      </Animated.View>
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
  overlay: {
    backgroundColor: "rgba(0,0,0,0.30)",
  },
  header: {
    paddingHorizontal: 24,
    paddingBottom: 12,
    zIndex: 10,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  logoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  appName: {
    fontSize: 20,
    fontFamily: "Inter_700Bold",
    color: Colors.textPrimary,
    letterSpacing: -0.3,
  },
  headerActions: {
    flexDirection: "row",
    gap: 4,
  },
  iconBtn: {
    padding: 8,
    borderRadius: 20,
  },
  headerSub: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: Colors.textSecondary,
    marginTop: 2,
  },
  frameContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
    zIndex: 10,
  },
  frameWrapper: {
    width: FRAME_W,
    height: FRAME_H,
    alignItems: "center",
    justifyContent: "center",
  },
  frameGlow: {
    position: "absolute",
    width: FRAME_W + 20,
    height: FRAME_H + 20,
    borderRadius: 4,
    shadowColor: Colors.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowRadius: 24,
    shadowOpacity: 0.6,
    backgroundColor: "transparent",
  },
  frame: {
    width: FRAME_W,
    height: FRAME_H,
    position: "relative",
  },
  targetBox: {
    position: "absolute",
    width: TARGET_SIZE,
    height: TARGET_SIZE,
    borderWidth: 2.5,
    borderRadius: 6,
    borderColor: Colors.scanFrame,
    zIndex: 10,
  },
  targetBoxDetected: {
    borderColor: Colors.success,
  },
  scanLine: {
    position: "absolute",
    top: 0,
    left: 8,
    right: 8,
    height: 2,
    backgroundColor: Colors.scanLine,
    shadowColor: Colors.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowRadius: 8,
    shadowOpacity: 1,
    zIndex: 5,
  },
  frameInner: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  framePlaceholder: {
    alignItems: "center",
    justifyContent: "center",
  },
  scanningBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(0,198,255,0.12)",
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: "rgba(0,198,255,0.3)",
  },
  scanningText: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    color: Colors.accent,
  },
  frameLabel: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: Colors.textMuted,
    letterSpacing: 0.3,
  },
  bottomPanel: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: 20,
    paddingHorizontal: 24,
    paddingBottom: 20,
    gap: 16,
    zIndex: 10,
    borderTopWidth: 1,
    borderColor: Colors.border,
  },
  answerKeyHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  answerKeyTitle: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: Colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  answerKeyDot: {
    width: 3,
    height: 3,
    borderRadius: 2,
    backgroundColor: Colors.textMuted,
  },
  answerKeyCount: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: Colors.textMuted,
  },
  answerKeyRow: {
    flexDirection: "row",
    gap: 8,
  },
  answerKeyItem: {
    flex: 1,
    alignItems: "center",
    gap: 6,
    backgroundColor: Colors.surfaceElevated,
    borderRadius: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  answerKeyQNum: {
    fontSize: 10,
    fontFamily: "Inter_500Medium",
    color: Colors.textMuted,
    letterSpacing: 0.5,
  },
  answerKeyBubble: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: Colors.accentDim,
    borderWidth: 1.5,
    borderColor: Colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  answerKeyLetter: {
    fontSize: 14,
    fontFamily: "Inter_700Bold",
    color: Colors.accent,
  },
  errorRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
    backgroundColor: Colors.errorDim,
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: Colors.error,
  },
  errorText: {
    flex: 1,
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: Colors.error,
    lineHeight: 16,
  },
  scanBtn: {
    backgroundColor: Colors.accent,
    borderRadius: 16,
    paddingVertical: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    shadowColor: Colors.accent,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 16,
    shadowOpacity: 0.4,
    elevation: 8,
  },
  scanBtnScanning: {
    backgroundColor: Colors.surfaceElevated,
    shadowOpacity: 0,
    elevation: 0,
  },
  scanBtnText: {
    fontSize: 16,
    fontFamily: "Inter_700Bold",
    color: Colors.background,
    letterSpacing: -0.2,
  },
  permissionContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 36,
    gap: 16,
  },
  permissionIconWrap: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: Colors.accentDim,
    borderWidth: 1,
    borderColor: Colors.accent,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  permissionTitle: {
    fontSize: 22,
    fontFamily: "Inter_700Bold",
    color: Colors.textPrimary,
    textAlign: "center",
  },
  permissionBody: {
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    color: Colors.textSecondary,
    textAlign: "center",
    lineHeight: 22,
  },
  permissionBtn: {
    marginTop: 8,
    backgroundColor: Colors.accent,
    borderRadius: 14,
    paddingHorizontal: 36,
    paddingVertical: 14,
  },
  permissionBtnText: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
    color: Colors.background,
  },
  permissionText: {
    color: Colors.textSecondary,
    fontFamily: "Inter_400Regular",
  },
});
