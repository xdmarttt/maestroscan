export const DarkColors = {
  background: "#0A1628",
  surface: "#111E35",
  surfaceElevated: "#1A2D4A",
  border: "#1E3A5F",
  accent: "#7650FF",
  accentDim: "rgba(118, 80, 255, 0.15)",
  accentGlow: "rgba(118, 80, 255, 0.4)",
  accentLight: "#9B7FFF",
  success: "#22C55E",
  successDim: "rgba(34, 197, 94, 0.15)",
  error: "#EF4444",
  errorDim: "rgba(239, 68, 68, 0.15)",
  warning: "#F59E0B",
  warningDim: "rgba(245, 158, 11, 0.15)",
  textPrimary: "#FFFFFF",
  textSecondary: "#8BA3C7",
  textMuted: "#4A6885",
  overlay: "rgba(10, 22, 40, 0.85)",
  scanFrame: "#7650FF",
  scanLine: "rgba(118, 80, 255, 0.8)",
  tabBar: "#111E35",
  tabBarBorder: "#1E3A5F",
  inputBackground: "#111E35",
  cardShadow: "rgba(0, 0, 0, 0.3)",
};

export const LightColors = {
  background: "#F5F5F7",
  surface: "#FFFFFF",
  surfaceElevated: "#F0EDF9",
  border: "#E5E5EA",
  accent: "#7650FF",
  accentDim: "rgba(118, 80, 255, 0.10)",
  accentGlow: "rgba(118, 80, 255, 0.25)",
  accentLight: "#5A33E0",
  success: "#16A34A",
  successDim: "rgba(22, 163, 74, 0.10)",
  error: "#DC2626",
  errorDim: "rgba(220, 38, 38, 0.10)",
  warning: "#D97706",
  warningDim: "rgba(217, 119, 6, 0.10)",
  textPrimary: "#1C1C1E",
  textSecondary: "#6B7280",
  textMuted: "#9CA3AF",
  overlay: "rgba(0, 0, 0, 0.4)",
  scanFrame: "#7650FF",
  scanLine: "rgba(118, 80, 255, 0.8)",
  tabBar: "#FFFFFF",
  tabBarBorder: "#E5E5EA",
  inputBackground: "#F5F5F7",
  cardShadow: "rgba(0, 0, 0, 0.06)",
};

export type ThemeColors = typeof DarkColors;

// Default export for backwards compatibility (used by scan algorithm - DO NOT CHANGE scan logic)
const Colors = DarkColors;
export default Colors;
