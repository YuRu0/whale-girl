<div align="center">

# WhaleGirl · 鲸鱼娘

**Keep a whale girl on your desktop — and restyle the Codex UI while you're at it.**

A breathing, wandering, throwable desktop pet,
plus a theme-injection engine that skins the [Codex](https://github.com/openai/codex) desktop app.

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Windows%20x64-blue.svg)](#requirements)
[![Electron](https://img.shields.io/badge/Electron-43.3.0-47848f.svg)](https://www.electronjs.org/)

English | [简体中文](./README.md)

</div>

---

## ✨ Features

### 🐟 Desktop pet

- Transparent always-on-top window that lives on your desktop, powered by [dsh-pet](https://github.com/PC2005-cloud/dsh-pet)
- Idle breathing, random actions, left/right turns, screen wandering
- **Click** for a squash-and-stretch reaction (with a "bloop" sound), **drag and fling** it and it bounces back
- Right-click menu to play any action on demand
- Adjustable size / position / pinning

### 🎨 Codex UI themes

- **Shorekeeper · Night Sea** — frosted glass + character art, cold night-sea palette
- **Midnight DeepSeek · Rainy Night** — live video wallpaper + HUD (clock / date / ambient line / live weather)

- Switch from the tray, applied instantly, no Codex restart needed

### 🎬 Swappable startup animation

- Plays a short clip when Codex opens, auto-aligned to the window
- Tray → "Import from file…" and drop in an mp4/webm/mov
- Falls back to the built-in clip if playback fails

### 📊 Usage dashboard

- `Ctrl + Alt + U` to open; reads Codex session logs and CC Switch archives
- Today / 30-day trend, breakdown by app and model, context usage
- Optional voice broadcast of today's usage

---

## 📦 Install

### Option 1: installer (recommended)

Grab the latest `WhaleGirl-1.3.4-Setup.exe` from [Releases](../../releases) and run it.

- Chinese setup wizard
- Defaults to `D:\鲸鱼娘\whale-girl` (changeable)
- Creates a **desktop shortcut** and a Start Menu entry
- Optional sign-in on first launch, optional run at login

> The installer is unsigned, so SmartScreen may warn about an unknown publisher.
> Choose "More info → Run anyway".

### Option 2: run from source

```bash
git clone https://github.com/YuRu0/whale-girl.git
cd whale-girl
npm install
npm start          # requires an Electron 43.3.0 runtime on this machine
```

---

## 🚀 Usage

Once running, WhaleGirl lives in the **system tray**. Right-click the tray icon:

| Item | Description |
| --- | --- |
| Open Codex × Shorekeeper | Launch Codex and apply the active theme |
| View usage (`Ctrl+Alt+U`) | Open the usage dashboard |
| Announce today's usage | Voice-broadcast today's consumption |
| Codex ▸ Replay intro | Play the startup animation again |
| Codex ▸ Intro ▸ … | Switch / import a clip, or open the clips folder |
| Codex ▸ UI theme | Switch between the two themes |

**Pet interaction**: left-click (with sound) · hold to drag · fling to bounce · right-click to pick an action

**Data location**: everything stays in `install dir\data\` on your machine. Nothing is uploaded.

---

## 🔧 How it works

```
┌──────────────┐   CDP (127.0.0.1:9227)   ┌──────────────┐
│  WhaleGirl   │ ───────────────────────► │  Codex       │
│  Electron    │   Runtime.evaluate       │  (Chromium)  │
└──────────────┘                          └──────────────┘
```

1. Launches Codex with `--remote-debugging-port=9227`
2. Polls the Codex page every 3.5 s
3. **When already injected, sends only a lightweight probe** — no re-sending of multi-MB CSS / images / video
4. First injection ships assets inline as base64 data URIs (~7.7 MB)
5. Themes only touch CSS variables and add decorative layers — **they never take over Codex's logic or data**

### About the "black overlay"

Codex paints a near-black layer (`::before`, roughly `#0d1117`) on its own workspace
container, which covers the wallpaper. Earlier releases neutralized it with a hardcoded
class selector — but Codex's class names carry a **build hash**
(e.g. `_WorkspaceContent_etoz9_2`), so the rule silently **stopped matching on other
machines or after a Codex update**.

It is now handled by **runtime detection** that uses no class names at all:

- Samples a 4×4 grid → `elementsFromPoint` for the full draw stack at each point
- For large elements (≥ 18% of the viewport), inspects `::before` / `::after` and the
  element itself for `background-color`, the darkest gradient stop, and
  `backdrop-filter: brightness(0.x)`
- Marks hits and neutralizes them with a single CSS rule; re-checks every 4 s
- Every ~48 s it also sweeps the DOM to catch `pointer-events: none` overlays
  (hit-testing never returns those)

---

## 📁 Repository layout

```
whale-girl/
├─ app/                          # app sources (= resources/app after install)
│  ├─ main.cjs                   # entry: tray, launch orchestration, settings
│  ├─ preload.cjs / splash.*     # splash screen
│  ├─ codex/
│  │  ├─ integration.cjs         # tray menu, Codex orchestration, theme switch, usage announce
│  │  ├─ theme.cjs               # theme controller: CDP injection, multi-theme, runtime un-black
│  │  ├─ intro-main.cjs / intro.*# startup animation (separate process, keeps GPU decode)
│  │  ├─ panel.* / usage-*.cjs   # usage dashboard and stats readers
│  │  ├─ themes/
│  │  │  ├─ shorekeeper/         # Shorekeeper · Night Sea
│  │  │  └─ midnight-deepseek/   # Midnight DeepSeek · Rainy Night
│  │  └─ intros/                 # drop a video file here
│  └─ vendor/dsh-pet/             # bundled pet engine (MIT)
├─ packaging/                    # electron-builder config and build script
├─ docs/
├─ .github/                      # issue / PR templates
└─ LICENSE · README.md · CHANGELOG.md · SECURITY.md · CONTRIBUTING.md
```

---

## 🛠 Build your own installer

```bash
cd packaging
npm install
npm run build          # electron-builder --win --x64 --prepackaged ./WhaleGirl
```

Output: `packaging/dist/WhaleGirl-1.3.4-Setup.exe`.

> `packaging/WhaleGirl/` is the Electron runtime working copy (binaries included).
> It is git-ignored; the build script syncs `app/` into it.

---

## ❓ FAQ

**The theme doesn't apply.**
Make sure Codex was launched from the tray ("Open Codex × Shorekeeper") — injection
only works when it starts with the debugging port. If Codex is already open, close it and relaunch.

**The wallpaper / animation is misaligned.**
Use "Replay intro" from the tray; it re-tracks the Codex window (`window-tracker.ps1`).

**Can I turn the pet off?**
Right-click the tray icon → Quit. Pet, theme, intro and auto-start are all individually toggleable.

**Does it interfere with Codex?**
No. It only injects CSS and standalone decorative layers. It reads your local `.codex`
and CC Switch files read-only for the usage dashboard.

**Does the video wallpaper play sound?**
No. The Midnight DeepSeek theme forces the video muted; only clicking the pet makes a sound.

---

## 🔒 Privacy

- All data is stored locally in `install dir\data\`. **Nothing is uploaded.**
- Weather is the only outbound request: current temperature and weather code from
  `api.open-meteo.com`, **with no machine identifiers**. The HUD falls back to
  time/date only when it is turned off in the tray.

---

## 🙏 Credits & notices

- Pet engine [dsh-pet](https://github.com/PC2005-cloud/dsh-pet) · MIT · Copyright (c) 2026 PC2005-cloud
- Runtime [Electron](https://www.electronjs.org/) · MIT
- Weather [Open-Meteo](https://open-meteo.com/) (free for non-commercial use)

**On assets**: the artwork and video files bundled in this repository are for
demonstration purposes. Character likenesses (e.g. Shorekeeper) belong to their
respective rights holders and are **not covered by the MIT license**.
Replace them with your own assets before redistributing or using commercially.
See [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).

---

## 📄 License

The code is released under the **MIT** license. See [LICENSE](./LICENSE).

```
Copyright (c) 2026 YuRu0
```
