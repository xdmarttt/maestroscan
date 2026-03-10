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
  ZoomIn,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import * as ImageManipulator from "expo-image-manipulator";
import Constants from "expo-constants";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import Colors from "@/constants/colors";
import { CameraScanner, useCameraPermissions } from "@/components/CameraScanner";
import { loadQuiz, loadRoster, QuizQuestion } from "@/lib/quiz-storage";
import { detectAndScan, scanSheet, generateDebugImage, warmupOpenCV } from "@/lib/scan-offline";
import { useFrameProcessor } from "react-native-vision-camera";
import { useResizePlugin } from "vision-camera-resize-plugin";
import { useRunOnJS } from "react-native-worklets-core";
import { detectCornersFromFrame } from "@/lib/detect-frame";

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");
// Edge-to-edge viewfinder — teachers fill the camera with the paper (like ZipGrade)
const FRAME_W = SCREEN_WIDTH;
const FRAME_H = Math.min(FRAME_W * 1.4, SCREEN_HEIGHT * 0.65);


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

// Corner viewfinder boxes (like ZipGrade) — large squares with thick borders
const GUIDE_SIZE = 100;
const GUIDE_INSET = 8;
const GUIDE_BORDER = 3.5;
const GUIDE_RADIUS = 8;

// Pre-computed guide box regions in frame-normalized coords (0-1)
const GUIDE_BOXES = [
  { x0: GUIDE_INSET / FRAME_W, y0: GUIDE_INSET / FRAME_H, x1: (GUIDE_INSET + GUIDE_SIZE) / FRAME_W, y1: (GUIDE_INSET + GUIDE_SIZE) / FRAME_H },
  { x0: (FRAME_W - GUIDE_INSET - GUIDE_SIZE) / FRAME_W, y0: GUIDE_INSET / FRAME_H, x1: (FRAME_W - GUIDE_INSET) / FRAME_W, y1: (GUIDE_INSET + GUIDE_SIZE) / FRAME_H },
  { x0: GUIDE_INSET / FRAME_W, y0: (FRAME_H - GUIDE_INSET - GUIDE_SIZE) / FRAME_H, x1: (GUIDE_INSET + GUIDE_SIZE) / FRAME_W, y1: (FRAME_H - GUIDE_INSET) / FRAME_H },
  { x0: (FRAME_W - GUIDE_INSET - GUIDE_SIZE) / FRAME_W, y0: (FRAME_H - GUIDE_INSET - GUIDE_SIZE) / FRAME_H, x1: (FRAME_W - GUIDE_INSET) / FRAME_W, y1: (FRAME_H - GUIDE_INSET) / FRAME_H },
];


export default function ScannerScreen() {
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [isScanning, setIsScanning] = useState(false);
  const [scanDone, setScanDone] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [choiceCount, setChoiceCount] = useState<4 | 5>(4);
  const [cornersLocked, setCornersLocked] = useState<[boolean, boolean, boolean, boolean]>([false, false, false, false]);
  const cornersLockedRef = useRef<[boolean, boolean, boolean, boolean]>([false, false, false, false]);
  const [scanResult, setScanResult] = useState<{
    answers: string[];
    score: number;
    total: number;
    percentage: number;
    studentName: string | null;
    studentId: string | null;
    scannedImage: string;
  } | null>(null);
  const scanResultRef = useRef<boolean>(false);
  const cameraRef = useRef<any>(null);
  const frameRef = useRef<View>(null);
  const isScanningRef = useRef(false);
  const framePosRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
  const lastBarcodeRef = useRef<string | null>(null);
  const stableCountRef = useRef(0);
  const [waitingForClear, setWaitingForClear] = useState(false); // UI state for "remove sheet" message
  const waitForClearRef = useRef(false); // ref mirror for detection loop
  const STABLE_THRESHOLD = 1; // scan on first frame with all corners locked

  // Pre-load native OpenCV on mount to avoid lag on first detection frame
  useEffect(() => { warmupOpenCV(); }, []);

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

  // --- Frame processor detection (replaces setTimeout-based detection loop) ---
  const questionsRef = useRef(questions);
  questionsRef.current = questions;
  const choiceCountRef = useRef(choiceCount);
  choiceCountRef.current = choiceCount;

  const { resize } = useResizePlugin();
  const lastDetectTime = useSharedValue(0);

  // Called from frame processor via runOnJS — handles guide box check + state updates
  const onDetectionResult = useCallback((partial: ([number, number] | null)[], found: boolean, W: number, H: number) => {
    if (scanResultRef.current || isScanningRef.current) return;
    if (questionsRef.current.length === 0) return;

    // Detection ran on full camera frame (resized) — corners are in normalized coords
    // Map to frame-relative positions for guide box check
    const locked: [boolean, boolean, boolean, boolean] = [false, false, false, false];
    for (let i = 0; i < 4; i++) {
      const pt = partial[i];
      if (!pt) continue;
      // Normalized position in the camera frame
      const nx = pt[0] / W;
      const ny = pt[1] / H;
      const box = GUIDE_BOXES[i];
      if (nx >= box.x0 && nx <= box.x1 && ny >= box.y0 && ny <= box.y1) {
        locked[i] = true;
      }
    }

    // Update corners UI (only if changed)
    const prev = cornersLockedRef.current;
    if (prev[0] !== locked[0] || prev[1] !== locked[1] || prev[2] !== locked[2] || prev[3] !== locked[3]) {
      cornersLockedRef.current = locked;
      setCornersLocked(locked);
    }

    const allLocked = locked.every(Boolean) && found;

    // After a scan, wait for the sheet to be removed before re-scanning
    if (waitForClearRef.current) {
      if (!allLocked) {
        waitForClearRef.current = false;
        setWaitingForClear(false);
      }
      stableCountRef.current = 0;
      return;
    }

    if (!allLocked) {
      stableCountRef.current = 0;
      return;
    }

    stableCountRef.current++;
    if (stableCountRef.current >= STABLE_THRESHOLD) {
      triggerScan();
    }
  }, []);

  // Run on JS callback wrapper for frame processor
  const onDetectionResultJS = useRunOnJS(onDetectionResult, [onDetectionResult]);

  // Frame processor — runs on every camera frame, does corner detection in ~5-15ms
  const frameProcessor = useFrameProcessor((frame) => {
    "worklet";
    // Throttle to ~15fps
    const now = Date.now();
    if (now - lastDetectTime.value < 66) return;
    lastDetectTime.value = now;

    const targetW = 200;
    const targetH = Math.round(frame.height * (targetW / frame.width));
    const resized = resize(frame, {
      scale: { width: targetW, height: targetH },
      pixelFormat: "bgr",
      dataType: "uint8",
    });

    const result = detectCornersFromFrame(resized, targetW, targetH, 3);
    onDetectionResultJS(result.partial, result.found, result.W, result.H);
  }, [resize, lastDetectTime, onDetectionResultJS]);

  // Scan capture — triggered when all 4 corners are stable (called from onDetectionResult)
  const triggerScan = useCallback(async () => {
    if (isScanningRef.current || !cameraRef.current) return;
    isScanningRef.current = true;
    stableCountRef.current = 0;

    try {
      const framePos = await getFramePos();
      if (!framePos) { isScanningRef.current = false; return; }

      // VisionCamera takePhoto for high-quality capture
      const scanPhoto = await cameraRef.current.takePhoto({ qualityPrioritization: "speed" });
      const photoUri = `file://${scanPhoto.path}`;
      const b64 = await cropToFrame(photoUri, scanPhoto.width, scanPhoto.height, framePos, 480, 0.3);
      if (!b64) { isScanningRef.current = false; stableCountRef.current = 0; return; }

      const result = await detectAndScan(b64, questionsRef.current, choiceCountRef.current);

      if (!result.found) {
        isScanningRef.current = false;
        stableCountRef.current = 0;
        return;
      }

      // Reject scan if too many unreadable answers — likely not flat
      const missedCount = result.answers.filter(a => a === "?").length;
      if (missedCount > Math.max(2, questionsRef.current.length * 0.15)) {
        isScanningRef.current = false;
        stableCountRef.current = 0;
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        setScanError("Place the sheet on a flat surface for accurate scanning");
        setTimeout(() => setScanError(null), 3000);
        return;
      }

      // Success — show result popup
      const barcode = lastBarcodeRef.current;
      waitForClearRef.current = true;
      setWaitingForClear(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      const qs = questionsRef.current;
      const score = result.answers.reduce(
        (n, a, i) => n + (a === qs[i]?.correct ? 1 : 0), 0
      );
      const total = qs.length;

      scanResultRef.current = true;
      setScanResult({
        answers: result.answers,
        score,
        total,
        percentage: total > 0 ? Math.round((score / total) * 100) : 0,
        studentName: null,
        studentId: barcode ?? null,
        scannedImage: b64,
      });
      setIsScanning(false);

      // Async: lookup student name + generate debug image
      try {
        let studentName: string | null = null;
        if (barcode) {
          try {
            const roster = await loadRoster();
            const idx = Number(barcode);
            if (roster.students[idx]) studentName = roster.students[idx];
          } catch { /* no roster */ }
        }

        let scannedImage = b64;
        if (result.corners) {
          try {
            const debugPath = scanPhoto.path.replace(/[^/]+$/, "debug_scan.jpg");
            generateDebugImage(b64, result.corners as [[number,number],[number,number],[number,number],[number,number]], result.answers, qs, choiceCountRef.current, debugPath);
            const debugResult = await ImageManipulator.manipulateAsync(
              `file://${debugPath}`, [], { base64: true, format: ImageManipulator.SaveFormat.JPEG, compress: 0.8 },
            );
            if (debugResult.base64) scannedImage = debugResult.base64;
          } catch (e) { console.warn("[debug-img] auto:", e); }
        }

        setScanResult(prev => prev ? { ...prev, studentName, scannedImage } : prev);
      } catch (e) { console.warn("[enrich] auto:", e); }
    } catch (e) {
      console.error("[scan] triggerScan error:", e);
      isScanningRef.current = false;
    }
  }, [getFramePos]);

  // Reset scan state and start live detection every time this screen is focused
  useFocusEffect(
    useCallback(() => {
      isScanningRef.current = false;
      scanResultRef.current = false;
      waitForClearRef.current = false;
      setIsScanning(false);
      setScanDone(false);
      setScanError(null);
      setScanResult(null);
      setWaitingForClear(false);
      cornersLockedRef.current = [false, false, false, false]; setCornersLocked([false, false, false, false]);
      lastBarcodeRef.current = null;
      stableCountRef.current = 0;
      framePosRef.current = null; // re-measure on focus (in case layout shifted)
      // Frame processor handles detection automatically — no loop needed
      return () => {
        cornersLockedRef.current = [false, false, false, false]; setCornersLocked([false, false, false, false]);
      };
    }, [])
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
      const photo = await cameraRef.current.takePhoto({ qualityPrioritization: "balanced" });
      const photoUri = `file://${photo.path}`;
      const base64 = await cropToFrame(photoUri, photo.width, photo.height, framePos, 640, 0.4);
      if (!base64) throw new Error("Image capture failed");

      const data = await scanSheet(base64, questions, choiceCount);
      if (!data.answers) {
        throw new Error("Fit the sheet inside the frame and try again");
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      waitForClearRef.current = true;
      setWaitingForClear(true);

      const score = data.answers.reduce(
        (n, a, i) => n + (a === questions[i]?.correct ? 1 : 0), 0
      );
      const total = questions.length;

      const barcode = lastBarcodeRef.current;

      // Show popup immediately — don't wait for debug image or roster
      scanResultRef.current = true;
      setScanResult({
        answers: data.answers,
        score,
        total,
        percentage: total > 0 ? Math.round((score / total) * 100) : 0,
        studentName: null,
        studentId: barcode ?? null,
        scannedImage: base64,
      });

      // Async: lookup student name + generate debug image, then update popup
      try {
        let studentName: string | null = null;
        if (barcode) {
          try {
            const roster = await loadRoster();
            const idx = Number(barcode);
            if (roster.students[idx]) studentName = roster.students[idx];
          } catch { /* no roster */ }
        }

        let scannedImage = base64;
        if (data.corners) {
          try {
            const debugPath = photo.path.replace(/[^/]+$/, 'debug_scan.jpg');
            generateDebugImage(base64, data.corners, data.answers, questions, choiceCount, debugPath);
            const debugResult = await ImageManipulator.manipulateAsync(
              `file://${debugPath}`, [], { base64: true, format: ImageManipulator.SaveFormat.JPEG, compress: 0.8 },
            );
            if (debugResult.base64) scannedImage = debugResult.base64;
          } catch (e) { console.warn('[debug-img] manual:', e); }
        }

        setScanResult(prev => prev ? { ...prev, studentName, scannedImage } : prev);
      } catch (e) { console.warn('[enrich] manual:', e); }
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

  // Dismiss popup → resume scanning (frame processor auto-resumes)
  const handleScanNext = useCallback(() => {
    scanResultRef.current = false;
    waitForClearRef.current = false;
    setWaitingForClear(false);
    setScanResult(null);
    setScanError(null);
    isScanningRef.current = false;
    stableCountRef.current = 0;
    cornersLockedRef.current = [false, false, false, false]; setCornersLocked([false, false, false, false]);
    lastBarcodeRef.current = null;
  }, []);

  // Navigate to full results page
  const handleViewDetails = useCallback(() => {
    if (!scanResult) return;
    router.push({
      pathname: "/results",
      params: {
        answers: JSON.stringify(scanResult.answers),
        questions: JSON.stringify(questions),
        studentId: lastBarcodeRef.current ?? "",
        scannedImage: scanResult.scannedImage,
      },
    });
    scanResultRef.current = false;
    setScanResult(null);
    isScanningRef.current = false;
  }, [scanResult, questions]);

  const getScoreColor = (pct: number) => {
    if (pct >= 80) return Colors.success;
    if (pct >= 50) return Colors.warning;
    return Colors.error;
  };

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
      <CameraScanner ref={cameraRef} onBarcodeScanned={handleBarcodeScanned} frameProcessor={frameProcessor} />

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
        <Text style={[styles.headerSub,
          scanError ? { color: Colors.error } :
          cornersLocked.every(Boolean) && !waitingForClear ? { color: Colors.success } : undefined
        ]}>
          {scanError
            ? scanError
            : waitingForClear
              ? "Remove sheet to scan next"
              : cornersLocked.every(Boolean)
                ? "All corners locked — scanning..."
                : cornersLocked.some(Boolean)
                  ? `${cornersLocked.filter(Boolean).length}/4 corners aligned`
                  : "Point camera at the answer sheet"}
        </Text>
      </Animated.View>

      <View style={styles.frameContainer}>
        <View ref={frameRef} style={styles.frameWrapper}>
          <View style={styles.frame}>
            {/* Corner viewfinder boxes — turn green when that corner is detected */}
            {([0,1,2,3] as const).map((i) => {
              const isTop = i < 2;
              const isLeft = i % 2 === 0;
              return (
                <View
                  key={i}
                  style={{
                    position: "absolute",
                    width: GUIDE_SIZE,
                    height: GUIDE_SIZE,
                    top: isTop ? GUIDE_INSET : undefined,
                    bottom: !isTop ? GUIDE_INSET : undefined,
                    left: isLeft ? GUIDE_INSET : undefined,
                    right: !isLeft ? GUIDE_INSET : undefined,
                    borderWidth: GUIDE_BORDER,
                    borderColor: cornersLocked[i] ? Colors.success : "rgba(255,255,255,0.45)",
                    borderRadius: GUIDE_RADIUS,
                  }}
                />
              );
            })}

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
          <Text style={styles.frameLabel}>Point at the answer sheet — scans automatically</Text>
        </Animated.View>
      </View>

      <Animated.View
        entering={FadeInDown.duration(500).delay(300)}
        style={[styles.bottomPanel, { paddingBottom: bottomPad + 16 }]}
      >
        {/* <View style={styles.answerKeyHeader}>
          <Text style={styles.answerKeyTitle}>Answer Key</Text>
          <View style={styles.answerKeyDot} />
          <Text style={styles.answerKeyCount}>{questions.length} Questions</Text>
        </View> */}

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

      {/* Scan result popup overlay */}
      {scanResult && (
        <Animated.View entering={FadeIn.duration(200)} style={styles.popupBackdrop}>
          <Animated.View entering={ZoomIn.duration(300).delay(100)} style={styles.popupCard}>
            <View style={[styles.popupScoreBadge, { backgroundColor: `${getScoreColor(scanResult.percentage)}15` }]}>
              <Ionicons
                name={scanResult.percentage >= 80 ? "checkmark-circle" : scanResult.percentage >= 50 ? "remove-circle" : "close-circle"}
                size={28}
                color={getScoreColor(scanResult.percentage)}
              />
            </View>

            <Text style={[styles.popupScore, { color: getScoreColor(scanResult.percentage) }]}>
              {scanResult.score} / {scanResult.total}
            </Text>
            <Text style={[styles.popupPercent, { color: getScoreColor(scanResult.percentage) }]}>
              {scanResult.percentage}%
            </Text>

            {(scanResult.studentName || scanResult.studentId) && (
              <View style={styles.popupStudentRow}>
                <Ionicons name="person-outline" size={14} color={Colors.textSecondary} />
                <Text style={styles.popupStudentName}>
                  {scanResult.studentName
                    ? `${scanResult.studentName} (ID: ${scanResult.studentId})`
                    : `Student ID: ${scanResult.studentId}`}
                </Text>
              </View>
            )}

            <View style={styles.popupButtons}>
              <Pressable
                onPress={handleScanNext}
                style={({ pressed }) => [styles.popupBtnPrimary, pressed && { opacity: 0.8 }]}
              >
                <MaterialCommunityIcons name="line-scan" size={18} color={Colors.background} />
                <Text style={styles.popupBtnPrimaryText}>Scan Next</Text>
              </Pressable>
              <Pressable
                onPress={handleViewDetails}
                style={({ pressed }) => [styles.popupBtnSecondary, pressed && { opacity: 0.8 }]}
              >
                <Text style={styles.popupBtnSecondaryText}>View Details</Text>
                <Ionicons name="arrow-forward" size={16} color={Colors.accent} />
              </Pressable>
            </View>
          </Animated.View>
        </Animated.View>
      )}
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
  popupBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: Colors.overlay,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 100,
  },
  popupCard: {
    backgroundColor: Colors.surface,
    borderRadius: 24,
    paddingVertical: 32,
    paddingHorizontal: 28,
    alignItems: "center",
    width: SCREEN_WIDTH - 64,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 4,
  },
  popupScoreBadge: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  popupScore: {
    fontSize: 36,
    fontFamily: "Inter_700Bold",
    letterSpacing: -1,
  },
  popupPercent: {
    fontSize: 18,
    fontFamily: "Inter_600SemiBold",
    marginBottom: 4,
  },
  popupStudentRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 4,
    marginBottom: 4,
  },
  popupStudentName: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
    color: Colors.textSecondary,
  },
  popupButtons: {
    width: "100%",
    gap: 10,
    marginTop: 20,
  },
  popupBtnPrimary: {
    backgroundColor: Colors.accent,
    borderRadius: 14,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  popupBtnPrimaryText: {
    fontSize: 15,
    fontFamily: "Inter_700Bold",
    color: Colors.background,
  },
  popupBtnSecondary: {
    backgroundColor: Colors.surfaceElevated,
    borderRadius: 14,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  popupBtnSecondaryText: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    color: Colors.accent,
  },
});
