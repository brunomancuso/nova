# NOVA S Pro Drill Control — Project Summary

## Overview

A modern web application that acts as an unofficial replacement client for the **Nova S Pro table tennis robot**. It removes the server-connectivity and login requirements of the official app, allowing players to control their robot fully offline via Bluetooth. The app handles drill management, physics-based parameter calculation, BLE communication, and local data persistence.

- **Current Version**: 2.3a (root) | 1.3 (legacy subfolder)
- **Tech Stack**: HTML5, CSS3, JavaScript ES6 Modules, Web Bluetooth API, localStorage
- **Browser Support**: Chromium-based browsers only (Chrome, Edge) — not iOS/Safari

---

## Project Structure

```
nova-main/
├── index.html                    # Main application (v2.3a)
├── converter.html                # Standalone RPM converter tool
├── nova_drills_v2_example.csv    # Example custom drill import file
├── README.md
├── summary.md                    # This file
├── css/
│   └── style.css                 # Responsive stylesheet + 4 themes
├── images/
│   ├── main.png
│   ├── editor.png
│   └── countdown.png
├── js/
│   ├── main.js                   # Entry point, event wiring
│   ├── constants.js              # Config, presets, physics limits
│   ├── state.js                  # Data management, localStorage sync
│   ├── bluetooth.js              # BLE connection + packet protocol
│   ├── runner.js                 # Drill execution, countdown, timing
│   ├── editor.js                 # Drill editor modal logic
│   ├── ui.js                     # DOM rendering, tab/theme management
│   ├── cloud.js                  # Remote drill sharing (PocketBase API)
│   └── utils.js                  # Logging, toasts, MD5, helpers
└── 1.3/                          # Older reference version (legacy)
    ├── index.html
    ├── nova_custom_drills_example.csv
    ├── README.md
    ├── css/style.css
    └── js/  (same module names, older logic)
```

---

## File Descriptions

### HTML Files

#### `index.html` — Main Application UI
Single-page application shell. Contains:
- **Header**: App title + hamburger menu toggle
- **Menu**: Theme picker, drill import/export, stats reset, factory reset, About modal
- **Settings Card**: BLE connection status, difficulty level (1–3), mode selector (Reps/Time), count/time input, pause duration
- **Drill Tabs**: 6 tabs — Basic, Combined, Complex, Custom A, Custom B, Custom C
- **Statistics**: Cumulative ball and drill counters
- **Editor Modal**: Full drill editor with multi-ball/variant support and scatter control
- **Run Overlay**: 4-second countdown with SVG progress circle, pause/stop controls
- **Download Modal**: Import drills from cloud using a 6-character share code

#### `converter.html` — RPM Converter Tool (v4.1)
Standalone utility for converting human-readable drill parameters (Speed, Spin, Height, etc.) to motor RPM values. Displays the physics formulas, validates clamping, and can copy/share the resulting values.

---

### JavaScript Modules

#### `js/main.js` — Entry Point
Imports all other modules, wires up DOM event listeners, handles window-level bindings for HTML `onclick` attributes. Manages the download modal flow, CSV file upload, and pause duration validation.

#### `js/constants.js` — Configuration & Presets
Central configuration store:
- **BLE UUIDs**: Service and characteristic identifiers for the Nova S Pro
- **SPIN_LIMITS**: Speed-dependent max-spin table (e.g. Speed 5 → max Spin 9)
- **RPM Limits**: 400–7500 RPM range
- **DEFAULT_DRILLS**: 25+ factory drills across Basic, Combined, and Complex categories, each with parameters for all 3 difficulty levels
- **Physics formula**: `base = 970 + (630.5 × speed)`, `spin_factor = 342 × spin`

#### `js/state.js` — Data & Persistence
All runtime state and localStorage synchronization:
- `currentDrills`, `userCustomDrills`, `drillOrder`, `selectedLevel`, `runMode`, `appStats`
- `initData()` — loads saved state on startup
- `importCustomDrills(csv)` — parses CSV, validates physics, updates state
- `exportCustomDrills()` — serializes drills back to CSV
- `factoryReset()` / `resetStats()` — destructive resets with confirmation
- `startSession()` / `getSessionSummary()` — tracks per-session ball/drill deltas

#### `js/bluetooth.js` — BLE Communication
Manages the full Bluetooth lifecycle:
- `connectDevice()` / `disconnectDevice()` — scan, pair, and disconnect
- `sendPacket(data)` — write-locked queue to prevent overflow
- `packBall(us, ls, bh, dp, freq, reps)` — encodes 24-byte ball parameter buffer
- **3-stage MD5 handshake**:
  1. Request handshake (0x07)
  2. Receive serial + code → compute MD5 hash
  3. Send hash (0x08) → complete auth (0x01, 0x02) → ready (0x80)
- Listens for `MSG_DONE` notification to signal drill completion

#### `js/runner.js` — Drill Execution
Controls the full run lifecycle:
- `startDrillSequence(name)` — begins 4-second countdown
- `skipCountdown()` — tap-to-skip countdown (v2.3a feature)
- `beginDrillExecution()` — starts actual ball delivery
- `runIteration()` — handles one pass in Reps or Time mode
- `togglePause()` / `stopRun()` — pause/resume and emergency stop
- **Scatter logic**: randomizes drop point within `base ± scatter` range using Fisher-Yates shuffle for variant selection
- Increments statistics counters on each ball sent and drill completed

#### `js/editor.js` — Drill Editor
Provides the full drill editing UI:
- `openEditor(drillKey)` / `closeEditor()` / `saveDrillChanges()`
- Add/delete/reorder ball steps; add/remove variants per step
- Input fields: Speed (0–10), Spin (0–10, clamped by SPIN_LIMITS), Height (−50/+100), Drop (−10/+10), BPM (30–90), Reps (1–200)
- Scatter per ball with constraint validation: `scatter + |drop| ≤ 10`
- Top/Back spin toggle (color-coded)
- Test button — sends a single ball live to the robot without saving

#### `js/ui.js` — UI Rendering
Handles all dynamic DOM work:
- `renderDrillButtons()` — populates all 6 tab views
- Drill buttons: icon grid, label, Random badge, drag grip, long-press (600 ms) to edit, click to run
- `updateLastPlayedHighlight()` — highlights the last executed drill
- `switchTab()` / `toggleMenu()` / `setTheme()` — navigation and theming
- **Drag-to-reorder**: grip handle on custom drills; drop zones for reordering and moving between custom categories; order persisted to localStorage
- `showSessionSummary()` — displays session stats popup on disconnect

#### `js/cloud.js` — Drill Sharing
Communicates with a PocketBase backend (`https://nova.varandal.de`):
- `uploadDrill(payload)` — generates a unique 6-char code (3 letters + 3 digits), POSTs drill data
- `downloadDrill(code)` — case-insensitive code lookup via API filter
- `checkCodeExists(code)` — pre-checks uniqueness before upload

#### `js/utils.js` — Utilities
Shared helpers:
- `log(msg)` — timestamped logging to console + on-screen log box (capped at 50 lines)
- `showToast(text)` — bottom-center toast notification (2.5 s)
- `clamp(val, min, max)` — math utility
- `toggleBodyScroll(lock)` — prevents scroll-behind during modals
- `MD5(string)` — full MD5 implementation used for BLE authentication
- `formatDuration(ms)` — formats milliseconds as `"1m 30s"` or `"2h 15m"`

---

### CSS

#### `css/style.css` — Stylesheet
- Mobile-first responsive layout (max 500 px container)
- **4 themes**: Standard (orange/red), Ocean (blue), Forest (green), Night (dark + pink)
- Tab grid: 3-column for factory categories, 2-column for custom
- Drill buttons: icon + label + Random badge + drag grip
- SVG countdown circle with `stroke-dashoffset` animation
- Modal system with backdrop blur
- Toast and debug log components

---

### Data Files

#### `nova_drills_v2_example.csv`
Example custom drill file using the **v2 format**:
```
Set;Ball;Name;Speed;Spin;Type;Height;Drop;BPM;Reps
```
Demonstrates multi-ball drills, variant rows (same ball number = randomization), and all three custom categories (A, B, C).

---

## Key Features

| Feature | Description |
|---|---|
| Offline-first | No server login required; all data in localStorage |
| Physics engine | RPM calculated from Speed/Spin with speed-dependent spin limits |
| BLE auth | 3-stage MD5 handshake with the robot hardware |
| Drill modes | Reps (count down) or Time (seconds count down) |
| Scatter | Per-ball drop-point randomization within validated range |
| Variants | Multiple ball options per step for pseudo-random variety |
| Drag-to-reorder | Custom drill ordering persisted locally |
| Cloud sharing | Upload/download drills via 6-char codes |
| Themes | 4 visual themes selectable at runtime |
| Tap-to-skip | Skip the 4-second countdown with a tap |
| Session stats | Ball/drill counts tracked per connected session |
| CSV import/export | Full round-trip data portability |

---

## v2.3a vs 1.3 Differences

| Aspect | v1.3 | v2.3a |
|---|---|---|
| CSV format | Raw RPM (`Top;Bottom`) | Calculated (`Speed;Spin;Type`) |
| Scatter control | No | Yes (per ball, with validation) |
| Cloud sharing | No | Yes (PocketBase API, 6-char codes) |
| Countdown skip | No | Yes (tap to skip) |
| Drag-to-reorder | No | Yes (custom categories) |
| Pause duration | Milliseconds | Seconds (0.0–5.0 s) |
| Session summary | No | Yes (on disconnect) |
| Last-played highlight | No | Yes |
| Download modal | No | Yes |
