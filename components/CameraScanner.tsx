import React from "react";
import { View, StyleSheet, Platform } from "react-native";
import Colors from "@/constants/colors";

let CameraView: React.ComponentType<{ style?: any; facing?: string }> | null = null;

if (Platform.OS !== "web") {
  try {
    const cam = require("expo-camera");
    CameraView = cam.CameraView;
  } catch {
    CameraView = null;
  }
}

export function CameraScanner() {
  if (Platform.OS === "web" || !CameraView) {
    return <View style={[StyleSheet.absoluteFill, styles.webBg]} />;
  }

  return <CameraView style={StyleSheet.absoluteFill} facing="back" />;
}

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
