import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Platform,
  Dimensions,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
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
import { useColors } from "@/lib/theme-context";
import { CameraScanner, useCameraPermissions } from "@/components/CameraScanner";
import { loadQuiz, loadRoster, QuizQuestion } from "@/lib/quiz-storage";
import { detectAndScan, warmupOpenCV } from "@/lib/scan-offline";
import { useAuth } from "@/lib/auth-context";
import { useScanLimit } from "@/lib/scan-limit-context";
import {
  getStudentsByClass,
  getAnswerSheetByQuizAndStudent,
  saveAnswerSheet,
} from "@/lib/queries";
import { useFrameProcessor } from "react-native-vision-camera";
import { useResizePlugin } from "vision-camera-resize-plugin";
import { useRunOnJS } from "react-native-worklets-core";
import { detectCornersFromFrame } from "@/lib/detect-frame";

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");
// Edge-to-edge viewfinder — teachers fill the camera with the paper (like ZipGrade)
const FRAME_W = SCREEN_WIDTH;
const FRAME_H = Math.min(FRAME_W * 1.4, SCREEN_HEIGHT * 0.65);


// Orient to portrait + resize. Returns base64 JPEG or null.
async function preparePhoto(
  photoUri: string,
  photoW: number,
  photoH: number,
  targetWidth: number,
  compress: number,
): Promise<string | null> {
  const actions: ImageManipulator.Action[] = [];
  actions.push({ resize: { width: targetWidth } });
  const result = await ImageManipulator.manipulateAsync(
    photoUri, actions,
    { compress, format: ImageManipulator.SaveFormat.JPEG, base64: true },
  );
  console.log(`[preparePhoto] output: ${result.width}x${result.height}`);
  return result.base64 ?? null;
}

// Match barcode value against enrolled students
function matchStudent(barcode: string, students: any[]): any | null {
  const byAccessCode = students.find((s) => s.access_code === barcode);
  if (byAccessCode) return byAccessCode;
  const byLrn = students.find((s) => s.lrn === barcode);
  if (byLrn) return byLrn;
  const idx = Number(barcode);
  if (!isNaN(idx) && idx >= 1 && idx <= students.length) {
    return students[idx - 1];
  }
  return null;
}

// Corner viewfinder boxes (like ZipGrade) — large squares with thick borders
const GUIDE_SIZE = 100;
const GUIDE_INSET = 8;
const GUIDE_BORDER = 3.5;
const GUIDE_RADIUS = 8;


export default function ScannerScreen() {
  // Optional params from quiz detail screen
  const params = useLocalSearchParams<{
    quizId?: string;
    classId?: string;
    answerKey?: string;
    totalPoints?: string;
    choiceCount?: string;
    quizTitle?: string;
  }>();

  const { profile } = useAuth();
  const colors = useColors();
  const { canScan, used, limit, isLoading: limitLoading, refresh: refreshLimit, increment: incrementScanCount } = useScanLimit();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const classStudentsRef = useRef<any[]>([]);
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
    saved?: boolean;
    saveStatus?: "saving" | "saved" | "not_found" | "overwrite_prompt";
    overwriteInfo?: { name: string; oldScore: string };
  } | null>(null);
  const scanResultRef = useRef<boolean>(false);
  const cameraRef = useRef<any>(null);
  const frameRef = useRef<View>(null);
  const isScanningRef = useRef(false);
  const framePosRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
  const lastBarcodeRef = useRef<string | null>(null);
  const stableCountRef = useRef(0);
  const [waitingForClear, setWaitingForClear] = useState(false);
  const waitForClearRef = useRef(false);
  const lastScanTimeRef = useRef(0);
  const STABLE_THRESHOLD = 2;
  const SCAN_COOLDOWN_MS = 800; // minimum time between scans for native memory cleanup

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

  // --- Frame processor detection ---
  const questionsRef = useRef(questions);
  questionsRef.current = questions;
  const choiceCountRef = useRef(choiceCount);
  choiceCountRef.current = choiceCount;

  const { resize } = useResizePlugin();
  const lastDetectTime = useSharedValue(0);
  const isScanningShared = useSharedValue(false);

  useEffect(() => {
    const timer = setTimeout(() => { getFramePos(); }, 300);
    return () => clearTimeout(timer);
  }, [getFramePos]);

  const debugCountRef = useRef(0);

  const onDetectionResult = useCallback((partial: ([number, number] | null)[], found: boolean, W: number, H: number) => {
    if (scanResultRef.current || isScanningRef.current) return;
    if (questionsRef.current.length === 0) return;

    const shouldLog = (++debugCountRef.current) % 30 === 0;
    if (shouldLog) {
      const detected = partial.filter(p => p !== null).length;
      console.log(`[detect] ${detected}/4 corners found=${found} frame=${W}x${H}`);
    }

    const locked: [boolean, boolean, boolean, boolean] = [false, false, false, false];
    for (let i = 0; i < 4; i++) {
      locked[i] = partial[i] !== null;
    }

    const prev = cornersLockedRef.current;
    if (prev[0] !== locked[0] || prev[1] !== locked[1] || prev[2] !== locked[2] || prev[3] !== locked[3]) {
      cornersLockedRef.current = locked;
      setCornersLocked(locked);
    }

    const allLocked = locked.every(Boolean) && found;

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

  const onDetectionResultJS = useRunOnJS(onDetectionResult, [onDetectionResult]);

  const frameProcessor = useFrameProcessor((frame) => {
    "worklet";
    if (isScanningShared.value) return;
    const now = Date.now();
    if (now - lastDetectTime.value < 66) return;
    lastDetectTime.value = now;

    const targetW = 320;
    const targetH = Math.round(frame.height * (targetW / frame.width));
    const resized = resize(frame, {
      scale: { width: targetW, height: targetH },
      pixelFormat: "bgr",
      dataType: "uint8",
    });

    try {
      const result = detectCornersFromFrame(resized, targetW, targetH, 3);
      onDetectionResultJS(result.partial, result.found, result.W, result.H);
    } catch {}
  }, [resize, lastDetectTime, isScanningShared, onDetectionResultJS]);

  const triggerScan = useCallback(async () => {
    if (isScanningRef.current || !cameraRef.current) return;
    // Cooldown: prevent rapid-fire scans that overwhelm native memory
    const now = Date.now();
    if (now - lastScanTimeRef.current < SCAN_COOLDOWN_MS) return;
    lastScanTimeRef.current = now;
    isScanningRef.current = true;
    isScanningShared.value = true;
    stableCountRef.current = 0;

    try {
      const t0 = Date.now();
      const scanPhoto = await cameraRef.current.takeSnapshot({ quality: 85 });
      const t1 = Date.now();
      const photoUri = `file://${scanPhoto.path}`;
      const b64 = await preparePhoto(photoUri, scanPhoto.width, scanPhoto.height, 560, 0.7);
      const t2 = Date.now();
      if (!b64) { isScanningRef.current = false; isScanningShared.value = false; stableCountRef.current = 0; return; }

      const result = await detectAndScan(b64, questionsRef.current, choiceCountRef.current);
      const t3 = Date.now();
      console.log(`[scan] takePhoto=${t1-t0}ms prepare=${t2-t1}ms detect=${t3-t2}ms total=${t3-t0}ms`);

      if (!result.found) {
        isScanningRef.current = false;
        isScanningShared.value = false;
        stableCountRef.current = 0;
        if ((result as any).blurry) {
          setScanError("Image too blurry — hold steady");
          setTimeout(() => setScanError(null), 2000);
        } else if ((result as any).folded) {
          setScanError("Paper appears folded or curved — flatten the sheet");
          setTimeout(() => setScanError(null), 3000);
        }
        return;
      }

      const blankCount = result.answers.filter(a => a === "?").length;
      if (blankCount > 0) {
        setScanError(`${blankCount} blank/unreadable answer${blankCount > 1 ? "s" : ""} detected`);
        setTimeout(() => setScanError(null), 4000);
      }

      // iOS: real-time codeScanner provides barcode. Android: falls back to post-capture reader.
      const barcode = lastBarcodeRef.current ?? result.studentId ?? null;
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

      // Cloud-connected flow: match student against class roster + auto-save
      if (params.classId && barcode && params.quizId && profile?.organization_id) {
        try {
          const matched = matchStudent(barcode, classStudentsRef.current);

          if (!matched) {
            setScanResult(prev => prev ? { ...prev, studentName: `Unknown (${barcode})`, saveStatus: "not_found" } : prev);
          } else {
            setScanResult(prev => prev ? { ...prev, studentName: matched.full_name, studentId: matched.id, saveStatus: "saving" } : prev);

            const existing = await getAnswerSheetByQuizAndStudent(params.quizId, matched.id);

            if (existing) {
              // Show overwrite prompt inside popup
              setScanResult(prev => prev ? {
                ...prev,
                saveStatus: "overwrite_prompt",
                overwriteInfo: { name: matched.full_name, oldScore: `${existing.raw_score}/${existing.total_points}` },
              } : prev);
            } else {
              // Auto-save
              const answersMap: Record<string, string> = {};
              result.answers.forEach((a: string, i: number) => { answersMap[String(i + 1)] = a; });
              const { error: saveErr } = await saveAnswerSheet({
                quizId: params.quizId!,
                studentId: matched.id,
                organizationId: profile!.organization_id!,
                answers: answersMap,
                rawScore: score,
                totalPoints: total,
                percentage: total > 0 ? Math.round((score / total) * 100) : 0,
              });
              if (!saveErr) {
                setScanResult(prev => prev ? { ...prev, saved: true, saveStatus: "saved" } : prev);
                incrementScanCount();
              }
            }
          }
        } catch (e) { console.warn("[scan] student match/save error:", e); }
      } else {
        // Offline fallback: look up student name from local roster
        try {
          let studentName: string | null = null;
          if (barcode) {
            try {
              const roster = await loadRoster();
              const idx = Number(barcode);
              if (roster.students[idx]) studentName = roster.students[idx];
            } catch { /* no roster */ }
          }
          if (studentName) {
            setScanResult(prev => prev ? { ...prev, studentName } : prev);
          }
        } catch (e) { console.warn("[enrich] auto:", e); }
      }
    } catch (e) {
      console.error("[scan] triggerScan error:", e);
      isScanningRef.current = false;
      isScanningShared.value = false;
    }
  }, [getFramePos, isScanningShared]);

  // Reset scan state every time this screen is focused
  useFocusEffect(
    useCallback(() => {
      isScanningRef.current = false;
      isScanningShared.value = false;
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
      framePosRef.current = null;
      setTimeout(() => { getFramePos(); }, 300);
      return () => {
        cornersLockedRef.current = [false, false, false, false]; setCornersLocked([false, false, false, false]);
      };
    }, [])
  );

  // Refresh scan limit once when screen is focused
  useFocusEffect(useCallback(() => { refreshLimit(); }, [refreshLimit]));

  const scanLineY = useSharedValue(0);

  // Load quiz config — from params (Supabase quiz) or AsyncStorage (offline)
  useFocusEffect(
    useCallback(() => {
      if (params.answerKey && params.answerKey.length > 2) {
        // Quiz mode: build QuizQuestion[] from Supabase answer key
        try {
          const keyObj = JSON.parse(params.answerKey) as Record<string, string>;
          const cc = (Number(params.choiceCount) === 5 ? 5 : 4) as 4 | 5;
          const choices = cc === 5 ? ["A", "B", "C", "D", "E"] : ["A", "B", "C", "D"];
          const qs: QuizQuestion[] = Object.entries(keyObj)
            .sort(([a], [b]) => Number(a) - Number(b))
            .map(([num, correct], i) => ({
              id: i + 1,
              text: `Question ${num}`,
              choices: choices.map((l) => `${l}. Answer ${l}`),
              correct: correct as any,
            }));
          setQuestions(qs);
          setChoiceCount(cc);
        } catch (e) {
          console.warn("[scan] Failed to parse quiz answer key, falling back to local:", e);
          loadQuiz().then((config) => {
            setQuestions(config.questions);
            setChoiceCount(config.choiceCount);
          });
        }
      } else {
        // Offline mode: load from AsyncStorage
        loadQuiz().then((config) => {
          setQuestions(config.questions);
          setChoiceCount(config.choiceCount);
        });
      }
    }, [params.answerKey, params.choiceCount])
  );

  // Pre-load class students for barcode matching (cloud-connected flow)
  useFocusEffect(
    useCallback(() => {
      if (params.classId) {
        getStudentsByClass(params.classId).then((students) => {
          classStudentsRef.current = students;
        });
      }
    }, [params.classId])
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

  const scanLineStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: interpolate(scanLineY.value, [0, 1], [0, FRAME_H]) },
    ],
    opacity: isScanning ? 1 : 0.5,
  }));

  const handleScanNext = useCallback(() => {
    scanResultRef.current = false;
    waitForClearRef.current = false;
    setWaitingForClear(false);
    setScanResult(null);
    setScanError(null);
    isScanningRef.current = false;
    isScanningShared.value = false; // resume frame processor
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
        studentId: scanResult.studentId ?? lastBarcodeRef.current ?? "",
        scannedImage: scanResult.scannedImage,
        quizId: params.quizId ?? "",
        saved: scanResult.saved ? "true" : "false",
        studentName: scanResult.studentName ?? "",
      },
    });
    scanResultRef.current = false;
    setScanResult(null);
    isScanningRef.current = false;
  }, [scanResult, questions, params.quizId]);

  // Handle overwrite confirmation from popup
  const handleOverwrite = useCallback(async () => {
    if (!scanResult || !params.quizId || !profile?.organization_id) return;
    setScanResult(prev => prev ? { ...prev, saveStatus: "saving" } : prev);
    const answersMap: Record<string, string> = {};
    scanResult.answers.forEach((a, i) => { answersMap[String(i + 1)] = a; });
    const { error } = await saveAnswerSheet({
      quizId: params.quizId,
      studentId: scanResult.studentId!,
      organizationId: profile.organization_id!,
      answers: answersMap,
      rawScore: scanResult.score,
      totalPoints: scanResult.total,
      percentage: scanResult.percentage,
    });
    if (!error) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setScanResult(prev => prev ? { ...prev, saved: true, saveStatus: "saved" } : prev);
      incrementScanCount();
    }
  }, [scanResult, params.quizId, profile, incrementScanCount]);

  const getScoreColor = (pct: number) => {
    if (pct >= 80) return colors.success;
    if (pct >= 50) return colors.warning;
    return colors.error;
  };

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const headerTitle = params.quizTitle ?? "MaestroScan";

  if (!canScan && !limitLoading) {
    return (
      <View style={[styles.container, { paddingTop: topPad, backgroundColor: colors.background }]}>
        <Animated.View entering={FadeIn.duration(500)} style={styles.permissionContainer}>
          <View style={[styles.permissionIconWrap, { backgroundColor: colors.warningDim ?? "#FFF3E0", borderColor: colors.warning ?? "#FF9800" }]}>
            <Ionicons name="lock-closed-outline" size={52} color={colors.warning ?? "#FF9800"} />
          </View>
          <Text style={[styles.permissionTitle, { color: colors.textPrimary }]}>Monthly Scan Limit Reached</Text>
          <Text style={[styles.permissionBody, { color: colors.textSecondary }]}>
            You've used {used} of {limit} free scans this month. Upgrade your plan for unlimited scanning.
          </Text>
          <Pressable
            onPress={() => router.push("/upgrade" as any)}
            style={({ pressed }) => [styles.permissionBtn, { backgroundColor: colors.accent }, pressed && { opacity: 0.8 }]}
          >
            <Text style={[styles.permissionBtnText, { color: "#FFFFFF" }]}>Upgrade to Solo</Text>
          </Pressable>
          <Pressable
            onPress={() => router.back()}
            style={({ pressed }) => [{ paddingVertical: 12, paddingHorizontal: 24, marginTop: 4 }, pressed && { opacity: 0.6 }]}
          >
            <Text style={[styles.permissionBtnText, { color: colors.textMuted }]}>Go Back</Text>
          </Pressable>
        </Animated.View>
      </View>
    );
  }

  if (!permission) {
    return (
      <View style={[styles.container, styles.center, { backgroundColor: colors.background }]}>
        <Text style={[styles.permissionText, { color: colors.textSecondary }]}>Initializing camera...</Text>
      </View>
    );
  }

  if (!permission.granted && Platform.OS !== "web") {
    return (
      <View style={[styles.container, { paddingTop: topPad, backgroundColor: colors.background }]}>
        <Animated.View entering={FadeIn.duration(500)} style={styles.permissionContainer}>
          <View style={[styles.permissionIconWrap, { backgroundColor: colors.accentDim, borderColor: colors.accent }]}>
            <Ionicons name="camera-outline" size={52} color={colors.accent} />
          </View>
          <Text style={[styles.permissionTitle, { color: colors.textPrimary }]}>Camera Access Needed</Text>
          <Text style={[styles.permissionBody, { color: colors.textSecondary }]}>
            MaestroScan uses your camera to scan answer sheets and calculate scores instantly.
          </Text>
          <Pressable
            onPress={requestPermission}
            style={({ pressed }) => [styles.permissionBtn, { backgroundColor: colors.accent }, pressed && { opacity: 0.8 }]}
          >
            <Text style={[styles.permissionBtnText, { color: "#FFFFFF" }]}>Continue</Text>
          </Pressable>
        </Animated.View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <CameraScanner ref={cameraRef} onBarcodeScanned={handleBarcodeScanned} frameProcessor={frameProcessor} zoom={1.5} />

      <View style={[StyleSheet.absoluteFill, styles.overlay]} />

      <Animated.View
        entering={FadeInDown.duration(500).delay(100)}
        style={[styles.header, { paddingTop: topPad + 8 }]}
      >
        <View style={styles.headerRow}>
          <View style={styles.logoRow}>
            {params.quizId ? (
              <Pressable onPress={() => router.back()} style={{ padding: 4 }}>
                <Ionicons name="arrow-back" size={22} color={Colors.textPrimary} />
              </Pressable>
            ) : (
              <MaterialCommunityIcons name="scan-helper" size={22} color={Colors.accent} />
            )}
            <Text style={styles.appName} numberOfLines={1}>{headerTitle}</Text>
          </View>
          <View style={styles.headerActions}>
            {limit !== null && (
              <View style={styles.scanLimitBadge}>
                <Ionicons name="scan-outline" size={13} color={Colors.textSecondary} />
                <Text style={styles.scanLimitText}>{Math.max(0, limit - used)}/{limit}</Text>
              </View>
            )}
            {!params.quizId && (
              <>
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
              </>
            )}
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

      {scanError && (
        <Animated.View
          entering={FadeInDown.duration(300)}
          style={[styles.messageBar, { bottom: bottomPad + 24 }]}
        >
          <Ionicons name="warning-outline" size={16} color={Colors.error} />
          <Text style={styles.messageBarText}>{scanError}</Text>
        </Animated.View>
      )}

      {/* Scan result popup overlay */}
      {scanResult && (
        <Animated.View entering={FadeIn.duration(200)} style={[styles.popupBackdrop, { backgroundColor: colors.overlay }]}>
          <Animated.View entering={ZoomIn.duration(300).delay(100)} style={[styles.popupCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>

            {scanResult.saveStatus === "not_found" ? (
              <>
                {/* Error-only view for unrecognized student */}
                <View style={[styles.popupScoreBadge, { backgroundColor: colors.errorDim }]}>
                  <Ionicons name="person-remove-outline" size={28} color={colors.error} />
                </View>
                <Text style={[styles.popupErrorTitle, { color: colors.error }]}>Student Not Found</Text>
                <Text style={[styles.popupErrorMsg, { color: colors.textSecondary }]}>
                  The scanned barcode doesn't match any student enrolled in this class. Please check the answer sheet and try again.
                </Text>
                <View style={styles.popupButtons}>
                  <Pressable
                    onPress={handleScanNext}
                    style={({ pressed }) => [styles.popupBtnPrimary, { backgroundColor: colors.accent }, pressed && { opacity: 0.8 }]}
                  >
                    <MaterialCommunityIcons name="line-scan" size={18} color="#FFFFFF" />
                    <Text style={styles.popupBtnPrimaryText}>Try Again</Text>
                  </Pressable>
                </View>
              </>
            ) : (
              <>
                {/* Normal score view */}
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
                    <Ionicons name="person-outline" size={14} color={colors.textSecondary} />
                    <Text style={[styles.popupStudentName, { color: colors.textSecondary }]}>
                      {scanResult.studentName
                        ? scanResult.studentName
                        : `Student ID: ${scanResult.studentId}`}
                    </Text>
                  </View>
                )}

                {scanResult.saveStatus === "saving" && (
                  <View style={styles.popupStatusRow}>
                    <Text style={[styles.popupStatusText, { color: colors.textSecondary }]}>
                      Saving...
                    </Text>
                  </View>
                )}

                {scanResult.saveStatus === "saved" && (
                  <View style={styles.popupStatusRow}>
                    <Ionicons name="checkmark-circle" size={16} color={colors.success} />
                    <Text style={[styles.popupStatusText, { color: colors.success }]}>
                      Saved to cloud
                    </Text>
                  </View>
                )}

                {scanResult.saveStatus === "overwrite_prompt" && scanResult.overwriteInfo && (
                  <View style={[styles.popupOverwriteCard, { backgroundColor: colors.surfaceElevated, borderColor: colors.border }]}>
                    <View style={styles.popupStatusRow}>
                      <Ionicons name="information-circle" size={16} color={colors.warning} />
                      <Text style={[styles.popupStatusText, { color: colors.warning }]}>
                        Existing result: {scanResult.overwriteInfo.oldScore}
                      </Text>
                    </View>
                    <View style={styles.popupOverwriteActions}>
                      <Pressable
                        onPress={() => setScanResult(prev => prev ? { ...prev, saveStatus: undefined } : prev)}
                        style={({ pressed }) => [styles.popupOverwriteBtn, { backgroundColor: colors.surface, borderColor: colors.border }, pressed && { opacity: 0.7 }]}
                      >
                        <Text style={[styles.popupOverwriteBtnText, { color: colors.textSecondary }]}>Keep Old</Text>
                      </Pressable>
                      <Pressable
                        onPress={handleOverwrite}
                        style={({ pressed }) => [styles.popupOverwriteBtn, { borderColor: colors.error, backgroundColor: colors.errorDim }, pressed && { opacity: 0.7 }]}
                      >
                        <Text style={[styles.popupOverwriteBtnText, { color: colors.error }]}>Overwrite</Text>
                      </Pressable>
                    </View>
                  </View>
                )}

                <View style={styles.popupButtons}>
                  <Pressable
                    onPress={handleScanNext}
                    style={({ pressed }) => [styles.popupBtnPrimary, { backgroundColor: colors.accent }, pressed && { opacity: 0.8 }]}
                  >
                    <MaterialCommunityIcons name="line-scan" size={18} color="#FFFFFF" />
                    <Text style={styles.popupBtnPrimaryText}>Scan Next</Text>
                  </Pressable>
                  <Pressable
                    onPress={handleViewDetails}
                    style={({ pressed }) => [styles.popupBtnSecondary, { backgroundColor: colors.surfaceElevated, borderColor: colors.border }, pressed && { opacity: 0.8 }]}
                  >
                    <Text style={[styles.popupBtnSecondaryText, { color: colors.accent }]}>View Details</Text>
                    <Ionicons name="arrow-forward" size={16} color={colors.accent} />
                  </Pressable>
                </View>
              </>
            )}

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
    flex: 1,
  },
  appName: {
    fontSize: 20,
    fontFamily: "Inter_700Bold",
    color: Colors.textPrimary,
    letterSpacing: -0.3,
    flex: 1,
  },
  headerActions: {
    flexDirection: "row",
    gap: 4,
  },
  iconBtn: {
    padding: 8,
    borderRadius: 20,
  },
  scanLimitBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(0,0,0,0.35)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
  },
  scanLimitText: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    color: Colors.textSecondary,
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
  messageBar: {
    position: "absolute",
    left: 20,
    right: 20,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(30,0,0,0.85)",
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: Colors.error,
    zIndex: 20,
  },
  messageBarText: {
    flex: 1,
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    color: Colors.error,
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
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  permissionTitle: {
    fontSize: 22,
    fontFamily: "Inter_700Bold",
    textAlign: "center",
  },
  permissionBody: {
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 22,
  },
  permissionBtn: {
    marginTop: 8,
    borderRadius: 14,
    paddingHorizontal: 36,
    paddingVertical: 14,
  },
  permissionBtnText: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
  },
  permissionText: {
    fontFamily: "Inter_400Regular",
  },
  popupBackdrop: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 100,
  },
  popupCard: {
    borderRadius: 24,
    paddingVertical: 32,
    paddingHorizontal: 28,
    alignItems: "center",
    width: SCREEN_WIDTH - 64,
    borderWidth: 1,
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
  },
  popupButtons: {
    width: "100%",
    gap: 10,
    marginTop: 20,
  },
  popupBtnPrimary: {
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
    color: "#FFFFFF",
  },
  popupBtnSecondary: {
    borderRadius: 14,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderWidth: 1,
  },
  popupBtnSecondaryText: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
  },
  popupStatusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 2,
  },
  popupStatusText: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
  },
  popupOverwriteCard: {
    width: "100%",
    borderRadius: 12,
    padding: 12,
    gap: 10,
    marginTop: 4,
    borderWidth: 1,
  },
  popupOverwriteActions: {
    flexDirection: "row",
    gap: 8,
  },
  popupOverwriteBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  popupOverwriteBtnText: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },
  popupErrorTitle: {
    fontSize: 20,
    fontFamily: "Inter_700Bold",
    marginTop: 4,
  },
  popupErrorMsg: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 19,
    marginBottom: 4,
  },
});
