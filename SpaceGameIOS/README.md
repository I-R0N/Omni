# Space Game — SpriteKit / iOS

Native iPhone space survival game built with **SpriteKit + Swift**.
Ported from the TypeScript Canvas 2D engine in the parent repo.

## Why SpriteKit?

| | Canvas 2D + Capacitor | **SpriteKit (this)** |
|---|---|---|
| GPU | CPU-rendered in WKWebView | Direct Metal |
| Frame rate | ~30 fps (iOS 15 regression) | 60/120 fps ProMotion |
| App size | ~15 MB + runtime | **~3–8 MB** (framework ships with iOS) |
| Battery | High (JS + WKWebView overhead) | Low (Apple-optimised) |
| Haptics / GameCenter | Bridge required | Native, one line of code |

---

## Requirements

- **Mac** running macOS 13 Ventura or later
- **Xcode 15+** (free from the Mac App Store)
- **Apple Developer account** — free account works for device testing via USB;
  you only need the paid account ($99/yr) to distribute via TestFlight or the App Store

---

## One-time Xcode project setup (~5 minutes)

These steps create the Xcode project container. You do this **once**; every
subsequent change is just editing Swift files and pressing ▶.

1. **Open Xcode** → File → New → Project
2. Choose **iOS → Game** → Next
3. Fill in:
   - Product Name: `SpaceGame`
   - Team: your Apple ID
   - Organization Identifier: `com.yourname` (anything reverse-DNS style)
   - Language: **Swift**
   - Game Technology: **SpriteKit**
4. Save the project **inside** this folder:
   `Omni/SpaceGameIOS/` so Xcode creates `SpaceGameIOS/SpaceGame.xcodeproj`
5. Xcode generates default files. **Delete these** (Move to Trash):
   - `GameScene.swift`
   - `GameScene.sks`
   - `Actions.sks`
   - Keep `Assets.xcassets` and `Info.plist`
6. In Xcode's Project Navigator (left sidebar), right-click the `SpaceGame`
   folder → **Add Files to "SpaceGame"…**
7. Select **all the `.swift` files** from `SpaceGameIOS/SpaceGame/` (including
   subfolders). Check **"Create groups"** and **"Copy items if needed"**.
8. Press **▶ (Run)** — target your connected iPhone or the Simulator.

> **Tip:** `Cmd+R` runs, `Cmd+B` builds only. The first build takes ~30 seconds;
> subsequent builds are fast (incremental).

---

## Testing on your iPhone without a paid account

1. Connect iPhone via USB cable
2. On iPhone: **Settings → Privacy & Security → Developer Mode → On** (reboot)
3. In Xcode: select your iPhone as the run target (top centre dropdown)
4. Press ▶ — Xcode installs the app and launches it
5. First run: on iPhone go to **Settings → General → VPN & Device Management**
   → trust your developer certificate

You can also run in the **iOS Simulator** (no iPhone needed) — select
"iPhone 15 Pro" from the target dropdown.

---

## Phase roadmap

| Phase | Status | What's included |
|---|---|---|
| **1 — Movement engine** | ✅ This commit | Infinite asteroid field, all 5 weapons, star-field background, health HUD |
| 2 — Power-ups | 🔲 Stub ready | Persistent buffs: shield, speed, damage mult, rapid fire |
| 3 — Enemy AI | 🔲 Stub ready | 6 subtypes: Basic, Charger, Tank, Skirmisher, Orbiter, Sniper |
| 4 — Waves & score | 🔲 Stub ready | Escalating waves, leaderboard, GameCenter integration |
| 5 — Polish & release | 🔲 | Haptics, sound, App Store submission |

---

## Project layout

```
SpaceGameIOS/
├── README.md                    ← you are here
└── SpaceGame/                   ← all Swift source files
    ├── AppDelegate.swift
    ├── GameViewController.swift
    ├── Types/
    │   ├── GameTypes.swift      ← enums & structs (port of types.ts)
    │   └── Constants.swift      ← tuning values (port of constants.ts)
    ├── Scenes/
    │   └── GameScene.swift      ← main game loop (heart of the engine)
    ├── Nodes/
    │   ├── PlayerNode.swift     ← player ship
    │   ├── EnemyNode.swift      ← enemy base class (Phase 3)
    │   ├── AsteroidNode.swift   ← destructible asteroid with shards
    │   └── ProjectileNode.swift ← bullet / homing missile
    ├── Systems/
    │   ├── WeaponSystem.swift   ← all 5 weapon types
    │   └── AISystem.swift       ← enemy AI state machine (Phase 3)
    ├── Background/
    │   └── SpaceBackground.swift← star layers, nebulae, shooting stars
    ├── UI/
    │   └── HUDNode.swift        ← health bar, weapon indicator, wave/score
    └── Input/
        └── TouchInputHandler.swift ← drag-to-move, tap-to-fire
```

---

## Key control scheme (Phase 1)

| Gesture | Action |
|---|---|
| Drag anywhere | Thrust in drag direction (release to drift) |
| Quick tap (< 200 ms) | Fire current weapon toward tap |
| Weapon button (bottom-right HUD) | Cycle through 5 weapon types |
| Pause button (top-right HUD) | Pause / resume |

---

## Tips for first-time Swift / Xcode users

- **Command-click** any SpriteKit class to jump to Apple's documentation
- The **Debug Navigator** (Cmd+7) shows live FPS and memory usage
- Shake the Simulator (Device → Shake) to trigger debug actions
- `print()` in Swift = `console.log()` in TypeScript — appears in Xcode's console
- Swift optionals (`?`, `!`) are like TypeScript's `T | undefined`; `guard let` is
  like an early-return null check
