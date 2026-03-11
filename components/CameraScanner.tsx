import React, { forwardRef, useMemo } from "react";
import { View, StyleSheet, Platform } from "react-native";

// Dynamically load VisionCamera on native (not available on web / Expo Go)
let VC: any = null;
if (Platform.OS !== "web") {
  try { VC = require("react-native-vision-camera"); } catch {}
}

interface CameraScannerProps {
  onBarcodeScanned?: (result: { data: string; type: string }) => void;
  frameProcessor?: any;
  isActive?: boolean;
  zoom?: number;
}

// Native: VisionCamera with frame processor + code scanner support
const NativeCameraScanner = VC
  ? forwardRef<any, CameraScannerProps>(
      ({ onBarcodeScanned, frameProcessor, isActive = true, zoom = 1 }, ref) => {
        const device = VC.useCameraDevice("back");

        const codeScanner = useMemo(() => {
          if (!onBarcodeScanned) return undefined;
          return {
            codeTypes: ["code-128"],
            onCodeScanned: (codes: any[]) => {
              if (codes.length > 0) {
                onBarcodeScanned({
                  data: codes[0].value ?? "",
                  type: codes[0].type ?? "",
                });
              }
            },
          };
        }, [onBarcodeScanned]);

        if (!device) return <View style={[StyleSheet.absoluteFill, styles.webBg]} />;

        // frameProcessor and codeScanner each create an ImageAnalysis use case.
        // iOS handles all 4 use cases fine; Android limits to ~3, so on Android
        // we disable codeScanner when frameProcessor is active.
        const isAndroid = Platform.OS === "android";
        const useFrameProc = !!frameProcessor;
        const enableCodeScanner = useFrameProc && isAndroid ? undefined : codeScanner;

        return (
          <VC.Camera
            ref={ref}
            style={StyleSheet.absoluteFill}
            device={device}
            isActive={isActive}
            frameProcessor={frameProcessor}
            codeScanner={enableCodeScanner}
            photo={false}
            video={true}
            zoom={zoom}
            {...(useFrameProc && { pixelFormat: "yuv", outputOrientation: "device" })}
          />
        );
      }
    )
  : null;

// Web fallback
const WebCameraScanner = forwardRef<any, CameraScannerProps>(() => (
  <View style={[StyleSheet.absoluteFill, styles.webBg]} />
));

export const CameraScanner = (NativeCameraScanner ?? WebCameraScanner) as
  React.ForwardRefExoticComponent<CameraScannerProps & React.RefAttributes<any>>;
CameraScanner.displayName = "CameraScanner";

// Permissions — use VisionCamera on native, fake on web
let useCameraPermissionsImpl: () => [any, () => Promise<any>];

if (VC?.useCameraPermission) {
  useCameraPermissionsImpl = () => {
    const { hasPermission, requestPermission } = VC.useCameraPermission();
    return [
      { granted: hasPermission, status: hasPermission ? "granted" : "undetermined", canAskAgain: true },
      requestPermission,
    ];
  };
} else {
  useCameraPermissionsImpl = () => [
    { granted: true, status: "granted", canAskAgain: true },
    async () => ({ granted: true }),
  ];
}

export const useCameraPermissions = useCameraPermissionsImpl;

const styles = StyleSheet.create({
  webBg: { backgroundColor: "#080F1E" },
});
