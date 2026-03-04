import React, { forwardRef } from "react";
import { View, StyleSheet, Platform } from "react-native";

let CameraViewComponent: React.ComponentType<{ style?: any; facing?: string; ref?: any }> | null = null;

if (Platform.OS !== "web") {
  try {
    const cam = require("expo-camera");
    CameraViewComponent = cam.CameraView;
  } catch {
    CameraViewComponent = null;
  }
}

export const CameraScanner = forwardRef<any, {}>((_, ref) => {
  if (Platform.OS === "web" || !CameraViewComponent) {
    return <View style={[StyleSheet.absoluteFill, styles.webBg]} />;
  }

  return <CameraViewComponent ref={ref} style={StyleSheet.absoluteFill} facing="back" />;
});

CameraScanner.displayName = "CameraScanner";

let useCameraPermissionsImpl: () => [any, () => Promise<any>];

if (Platform.OS !== "web") {
  try {
    const cam = require("expo-camera");
    useCameraPermissionsImpl = cam.useCameraPermissions;
  } catch {
    useCameraPermissionsImpl = () => [
      { granted: true, status: "granted", canAskAgain: true },
      async () => ({ granted: true }),
    ];
  }
} else {
  useCameraPermissionsImpl = () => [
    { granted: true, status: "granted", canAskAgain: true },
    async () => ({ granted: true }),
  ];
}

export const useCameraPermissions = useCameraPermissionsImpl;

const styles = StyleSheet.create({
  webBg: {
    backgroundColor: "#080F1E",
  },
});
