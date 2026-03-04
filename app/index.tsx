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

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const FRAME_SIZE = SCREEN_WIDTH * 0.78;
const CORNER_SIZE = 28;
const CORNER_THICKNESS = 3;

function CornerBracket({
  position,
  detected = false,
}: {
  position: "topLeft" | "topRight" | "bottomLeft" | "bottomRight";
  detected?: boolean;
}) {
  const isTop = position.startsWith("top");
  const isLeft = position.endsWith("Left");
  const color = detected ? "#00FF88" : Colors.scanFrame;

  return (
    <View
      style={[
        styles.corner,
        isTop ? { top: 0 } : { bottom: 0 },
        isLeft ? { left: 0 } : { right: 0 },
      ]}
    >
      <View
        style={[
          styles.cornerH,
          isTop
            ? { top: 0, borderTopWidth: CORNER_THICKNESS }
            : { bottom: 0, borderBottomWidth: CORNER_THICKNESS },
          isLeft
            ? { left: 0, borderLeftWidth: CORNER_THICKNESS }
            : { right: 0, borderRightWidth: CORNER_THICKNESS },
          { borderColor: color },
        ]}
      />
      <View
        style={[
          styles.cornerV,
          isTop
            ? { top: 0, borderTopWidth: CORNER_THICKNESS }
            : { bottom: 0, borderBottomWidth: CORNER_THICKNESS },
          isLeft
            ? { left: 0, borderLeftWidth: CORNER_THICKNESS }
            : { right: 0, borderRightWidth: CORNER_THICKNESS },
          { borderColor: color },
        ]}
      />
    </View>
  );
}

function getApiBase(): string {
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  if (domain) {
    const isLocal =
      domain.startsWith("localhost") ||
      domain.startsWith("127.") ||
      domain.startsWith("192.168.") ||
      domain.startsWith("10.") ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(domain);
    const protocol = isLocal ? "http" : "https";
    return `${protocol}://${domain}`;
  }
  return "http://localhost:5001";
}

export default function ScannerScreen() {
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [isScanning, setIsScanning] = useState(false);
  const [scanDone, setScanDone] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [sheetDetected, setSheetDetected] = useState(false);
  const cameraRef = useRef<any>(null);
  const isScanningRef = useRef(false);
  const detectCountRef = useRef(0);
  const lastAutoScanRef = useRef(0);
  // Always points to the latest handleScan — fixes stale closure in the detect interval
  const handleScanRef = useRef<() => Promise<void>>(() => Promise.resolve());

  // Reset scan state every time this screen comes back into focus
  // (after returning from results, the component stays mounted so refs aren't cleared)
  useFocusEffect(
    useCallback(() => {
      isScanningRef.current = false;
      detectCountRef.current = 0;
      lastAutoScanRef.current = 0;   // clear cooldown so auto-scan works immediately
      setIsScanning(false);
      setScanDone(false);
      setScanError(null);
      setSheetDetected(false);
    }, [])
  );

  const scanLineY = useSharedValue(0);
  const frameGlow = useSharedValue(0);
  const pulseScale = useSharedValue(1);

  useEffect(() => {
    loadQuiz().then((config) => setQuestions(config.questions));
  }, []);

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

  // Auto-detect: poll every 2s, auto-scan when sheet found 2 frames in a row
  useEffect(() => {
    const interval = setInterval(async () => {
      if (isScanningRef.current || !cameraRef.current) return;
      try {
        const photo = await cameraRef.current.takePictureAsync({
          quality: 0.8,
          base64: false,
        });
        const resized = await ImageManipulator.manipulateAsync(
          photo.uri,
          [{ resize: { width: 500 } }],
          { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG, base64: true }
        );
        if (!resized.base64) return;

        const response = await fetch(`${getApiBase()}/api/detect`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageBase64: resized.base64 }),
        });
        if (!response.ok) return;
        const data = await response.json();

        setSheetDetected(data.found);

        if (data.found) {
          detectCountRef.current += 1;
          // Auto-scan after 2 consecutive detections, with a 5s cooldown
          if (
            detectCountRef.current >= 2 &&
            !isScanningRef.current &&
            Date.now() - lastAutoScanRef.current > 5000
          ) {
            detectCountRef.current = 0;
            lastAutoScanRef.current = Date.now();
            handleScanRef.current();
          }
        } else {
          detectCountRef.current = 0;
        }
      } catch {
        // ignore detection errors silently
      }
    }, 2000);

    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [questions]);

  const scanLineStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: interpolate(scanLineY.value, [0, 1], [0, FRAME_SIZE]) },
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

  const handleScan = async () => {
    if (isScanningRef.current) return;
    isScanningRef.current = true;
    setScanError(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setIsScanning(true);

    try {
      if (!cameraRef.current) throw new Error("Camera not ready");

      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.9,
        base64: false,
        skipProcessing: false,
      });

      const resized = await ImageManipulator.manipulateAsync(
        photo.uri,
        [{ resize: { width: 800 } }],
        { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG, base64: true }
      );
      if (!resized.base64) throw new Error("Image capture failed");

      const resp = await fetch(`${getApiBase()}/api/scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: resized.base64, questions }),
      });
      if (!resp.ok) throw new Error("Server error");
      const data = await resp.json();
      if (data.error || !data.answers) {
        throw new Error(data.error ?? "Sheet not detected — make sure all 4 corner marks are visible");
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setScanDone(true);
      await new Promise((r) => setTimeout(r, 400));

      router.push({
        pathname: "/results",
        params: {
          answers: JSON.stringify(data.answers),
          questions: JSON.stringify(questions),
        },
      });
    } catch (err: any) {
      console.error("Scan failed:", err);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setScanError(err?.message ?? "Scan failed — make sure the server is running and sheet is visible.");
    } finally {
      isScanningRef.current = false;
      setIsScanning(false);
      setScanDone(false);
    }
  };
  // Keep ref current on every render so the detect interval always calls the latest version
  handleScanRef.current = handleScan;

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
                  params: { questions: JSON.stringify(questions) },
                })
              }
              style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.6 }]}
            >
              <Ionicons name="document-outline" size={20} color={Colors.textSecondary} />
            </Pressable>
          </View>
        </View>
        <Text style={styles.headerSub}>Point at the answer sheet to scan</Text>
      </Animated.View>

      <View style={styles.frameContainer}>
        <Animated.View style={[styles.frameWrapper, pulseStyle]}>
          <Animated.View style={[styles.frameGlow, frameGlowStyle]} />

          <View style={styles.frame}>
            {(["topLeft", "topRight", "bottomLeft", "bottomRight"] as const).map(
              (pos) => (
                <CornerBracket key={pos} position={pos} detected={sheetDetected} />
              )
            )}

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
          <Text style={styles.frameLabel}>
            {sheetDetected ? "Sheet detected — tap Scan Sheet to capture" : "Align answer sheet within frame"}
          </Text>
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
    backgroundColor: "rgba(0,0,0,0.45)",
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
    width: FRAME_SIZE,
    height: FRAME_SIZE,
    alignItems: "center",
    justifyContent: "center",
  },
  frameGlow: {
    position: "absolute",
    width: FRAME_SIZE + 20,
    height: FRAME_SIZE + 20,
    borderRadius: 4,
    shadowColor: Colors.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowRadius: 24,
    shadowOpacity: 0.6,
    backgroundColor: "transparent",
  },
  frame: {
    width: FRAME_SIZE,
    height: FRAME_SIZE,
    position: "relative",
    overflow: "hidden",
  },
  corner: {
    position: "absolute",
    width: CORNER_SIZE,
    height: CORNER_SIZE,
  },
  cornerH: {
    position: "absolute",
    width: CORNER_SIZE,
    height: CORNER_THICKNESS,
    borderColor: Colors.scanFrame,
  },
  cornerV: {
    position: "absolute",
    width: CORNER_THICKNESS,
    height: CORNER_SIZE,
    borderColor: Colors.scanFrame,
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
