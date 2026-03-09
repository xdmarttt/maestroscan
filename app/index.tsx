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
import Constants from "expo-constants";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import Colors from "@/constants/colors";
import { CameraScanner, useCameraPermissions } from "@/components/CameraScanner";
import { loadQuiz, QuizQuestion } from "@/lib/quiz-storage";
import { detectAndScan, detectSheet, scanSheet } from "@/lib/scan-offline";

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");
// Edge-to-edge viewfinder — teachers fill the camera with the paper (like ZipGrade)
const FRAME_W = SCREEN_WIDTH;
const FRAME_H = Math.min(FRAME_W * 1.4, SCREEN_HEIGHT * 0.55);
const TARGET_SIZE = 80;
const CROP_MARGIN = 0.08; // must match cropToFrame default margin

// Target box rects in frame-relative coordinates [TL, TR, BL, BR]
const TARGET_RECTS = [
  { x: 0, y: 0 },
  { x: FRAME_W - TARGET_SIZE, y: 0 },
  { x: 0, y: FRAME_H - TARGET_SIZE },
  { x: FRAME_W - TARGET_SIZE, y: FRAME_H - TARGET_SIZE },
];

/**
 * Map a corner from cropped-image coordinates to frame-relative coordinates.
 * The cropped image includes CROP_MARGIN around the frame, so we subtract that offset.
 */
function cornerToFrame(
  cx: number, cy: number,
  imgW: number, imgH: number,
): { x: number; y: number } {
  const marginFrac = CROP_MARGIN / (1 + 2 * CROP_MARGIN);
  const frameStartX = marginFrac * imgW;
  const frameStartY = marginFrac * imgH;
  const frameW = imgW / (1 + 2 * CROP_MARGIN);
  const frameH = imgH / (1 + 2 * CROP_MARGIN);
  return {
    x: ((cx - frameStartX) / frameW) * FRAME_W,
    y: ((cy - frameStartY) / frameH) * FRAME_H,
  };
}

/** Check if a point is inside its corresponding target box (with tolerance) */
function isInsideTarget(
  pt: { x: number; y: number },
  target: { x: number; y: number },
  tolerance = 20,
): boolean {
  return (
    pt.x >= target.x - tolerance &&
    pt.x <= target.x + TARGET_SIZE + tolerance &&
    pt.y >= target.y - tolerance &&
    pt.y <= target.y + TARGET_SIZE + tolerance
  );
}

// Orient → crop to frame area → resize. Returns base64 JPEG or null.
// Optimized: single ImageManipulator call using photo dimensions from camera.
async function cropToFrame(
  photoUri: string,
  photoW: number,
  photoH: number,
  framePos: { x: number; y: number; width: number; height: number },
  targetWidth: number,
  compress: number,
  margin = 0.08,
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
  const MARGIN = margin;
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
  const [cornersLocked, setCornersLocked] = useState<[boolean, boolean, boolean, boolean]>([false, false, false, false]);
  const cameraRef = useRef<any>(null);
  const frameRef = useRef<View>(null);
  const isScanningRef = useRef(false);
  const isDetectingRef = useRef(false);
  const framePosRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
  const detectLoopRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastBarcodeRef = useRef<string | null>(null);
  const stableCountRef = useRef(0);
  const STABLE_THRESHOLD = 1; // fire immediately when all 4 corners lock

  // Native barcode scanner callback — ref-only, no state updates, no re-renders
  const handleBarcodeScanned = useCallback((result: { data: string; type: string }) => {
    lastBarcodeRef.current = result.data;
  }, []);

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

  // Two-stage detection loop (like ZipGrade):
  // Stage 1: lightweight detectSheet() to check if 4 corner marks are visible → corners go green
  // Stage 2: after STABLE_THRESHOLD consecutive detections, run full detectAndScan() → navigate
  const runDetect = useCallback(async () => {
    if (isScanningRef.current || isDetectingRef.current || !cameraRef.current || !frameRef.current) {
      detectLoopRef.current = setTimeout(runDetect, 200);
      return;
    }
    if (questions.length === 0) {
      detectLoopRef.current = setTimeout(runDetect, 500);
      return;
    }
    isDetectingRef.current = true;
    let navigating = false;
    const resetCorners = () => { setCornersLocked([false, false, false, false]); stableCountRef.current = 0; };
    try {
      const t0 = Date.now();
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.7,
        base64: false,
        skipProcessing: true,
      });
      const framePos = await getFramePos();
      if (!framePos) { resetCorners(); return; }
      // Crop at 640px for fast detection (mark finding doesn't need high res)
      const b64 = await cropToFrame(photo.uri, photo.width, photo.height, framePos, 640, 0.6);
      if (!b64) { resetCorners(); return; }

      // Stage 1: Lightweight detection — check which corner marks are visible
      const detect = await detectSheet(b64);
      const t1 = Date.now();

      // Map each detected partial corner to frame space and check if inside target box
      const imgW = detect.imageSize?.[0] ?? 640;
      const imgH = detect.imageSize?.[1] ?? (640 * FRAME_H / FRAME_W);
      const locked: [boolean, boolean, boolean, boolean] = [false, false, false, false];

      for (let i = 0; i < 4; i++) {
        const pt = detect.partial[i];
        if (!pt) continue;
        const mapped = cornerToFrame(pt[0], pt[1], imgW, imgH);
        locked[i] = isInsideTarget(mapped, TARGET_RECTS[i]);
      }

      setCornersLocked(locked);
      const allLocked = locked.every(Boolean);

      if (!allLocked) {
        stableCountRef.current = 0;
        return;
      }

      // All 4 marks inside their target boxes — run full scan immediately
      stableCountRef.current++;
      if (stableCountRef.current < STABLE_THRESHOLD) return;

      // Full scan on same image (detectAndScan re-detects marks internally, ~50ms overhead)
      const result = await detectAndScan(b64, questions, choiceCount);
      const t2 = Date.now();
      console.log(`[scan] detect=${t1-t0}ms scan=${t2-t1}ms total=${t2-t0}ms`);

      if (!result.found) {
        stableCountRef.current = 0;
        return;
      }

      // Success — navigate to results
      const barcode = lastBarcodeRef.current;
      console.log(`[scan] done! studentId=${barcode ?? 'none'} total=${t2-t0}ms`);
      navigating = true;
      stableCountRef.current = 0;
      isScanningRef.current = true;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setIsScanning(true);
      setScanDone(true);

      // Quick green flash before navigation
      await new Promise((r) => setTimeout(r, 80));
      router.push({
        pathname: "/results",
        params: {
          answers: JSON.stringify(result.answers),
          questions: JSON.stringify(questions),
          choiceCount: String(choiceCount),
          ...(barcode ? { studentId: barcode } : {}),
        },
      });
    } catch {
      // silent — detection errors don't block scanning
    } finally {
      isDetectingRef.current = false;
      // Chain: schedule next detection unless we're navigating to results
      if (!navigating) {
        detectLoopRef.current = setTimeout(runDetect, 100);
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
      setCornersLocked([false, false, false, false]);
      lastBarcodeRef.current = null;
      stableCountRef.current = 0;
      framePosRef.current = null; // re-measure on focus (in case layout shifted)
      // Start chain-based detection loop
      detectLoopRef.current = setTimeout(runDetect, 100);
      return () => {
        if (detectLoopRef.current) clearTimeout(detectLoopRef.current);
        detectLoopRef.current = null;
        setCornersLocked([false, false, false, false]);
      };
    }, [runDetect])
  );

  const scanLineY = useSharedValue(0);

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
  }, []);

  // No auto-detect — user manually aligns the sheet to the corner brackets and taps Scan

  const scanLineStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: interpolate(scanLineY.value, [0, 1], [0, FRAME_H]) },
    ],
    opacity: isScanning ? 1 : 0.5,
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

      router.push({
        pathname: "/results",
        params: {
          answers: JSON.stringify(data.answers),
          questions: JSON.stringify(questions),
          choiceCount: String(choiceCount),
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
      <CameraScanner ref={cameraRef} onBarcodeScanned={handleBarcodeScanned} />

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
        <Text style={[styles.headerSub, cornersLocked.every(Boolean) && { color: Colors.success }]}>
          {cornersLocked.every(Boolean)
            ? "All corners locked — scanning..."
            : cornersLocked.some(Boolean)
              ? `${cornersLocked.filter(Boolean).length}/4 corners aligned`
              : "Point camera at the answer sheet"}
        </Text>
      </Animated.View>

      <View style={styles.frameContainer}>
        <View ref={frameRef} style={styles.frameWrapper}>
          <View style={styles.frame}>
            {/* 4 corner target squares — at the edges like ZipGrade */}
            {([
              { top: 0, left: 0 },
              { top: 0, left: FRAME_W - TARGET_SIZE },
              { top: FRAME_H - TARGET_SIZE, left: 0 },
              { top: FRAME_H - TARGET_SIZE, left: FRAME_W - TARGET_SIZE },
            ] as const).map((pos, i) => (
              <View
                key={i}
                style={[
                  styles.targetBox,
                  { top: pos.top, left: pos.left },
                  cornersLocked[i] && styles.targetBoxDetected,
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
        </View>

        <Animated.View entering={FadeInDown.duration(500).delay(200)}>
          <Text style={styles.frameLabel}>Align paper corners with the 4 targets — scans automatically</Text>
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
    left: 0,
    right: 0,
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
