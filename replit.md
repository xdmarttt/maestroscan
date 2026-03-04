# GradeSnap — ZipGrade-style Scanner App

## Overview
GradeSnap is a mobile app inspired by ZipGrade that lets teachers scan student answer sheets using an AR-like camera interface and instantly displays scores.

## Features
- **Camera Scanner**: AR-style overlay with animated scanning frame, corner brackets, and scanning line
- **Answer Key Display**: Shows the 3 pre-loaded questions and correct answers (A, B, D)
- **Scan Simulation**: Tap "Scan Sheet" to simulate reading a paper answer sheet
- **Results Screen**: Animated score breakdown with per-question correct/incorrect detail

## Tech Stack
- **Frontend**: Expo Router (file-based routing), React Native, Reanimated 3
- **Camera**: expo-camera v17 (Expo Go compatible)
- **Styling**: React Native StyleSheet with custom dark navy theme
- **State**: useState (local), no backend/database needed

## Structure
```
app/
  _layout.tsx          # Root layout (Stack, no tabs)
  index.tsx            # Scanner screen (main screen)
  results.tsx          # Results screen
components/
  CameraScanner.tsx    # Platform-safe camera wrapper (web fallback)
  ErrorBoundary.tsx    # Error boundary
  ErrorFallback.tsx    # Error fallback UI
constants/
  colors.ts            # Dark navy + cyan theme
```

## Color Theme
- Background: #0A1628 (deep navy)
- Surface: #111E35
- Accent: #00C6FF (cyan)
- Success: #22C55E, Error: #EF4444, Warning: #F59E0B

## Questions / Answer Key
1. "What is the capital of France?" → A (Paris)
2. "What is 7 × 8?" → B (56)
3. "Which planet is closest to the Sun?" → D (Mercury)

## Simulated Scan Result
When "Scan Sheet" is pressed, the app simulates detecting answers [A, B, A] from the paper (Q1 correct, Q2 correct, Q3 incorrect = 2/3 score).

## Workflows
- **Start Backend**: `npm run server:dev` (Express on port 5000)
- **Start Frontend**: `npm run expo:dev` (Expo Metro on port 8081)
