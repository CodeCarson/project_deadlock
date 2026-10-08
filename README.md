# Deadlock Companion — Phase 1

A Windows desktop companion you can leave on your second monitor. This release implements the **timer assistant only**: an Electron shell, React/TypeScript interface, Tailwind styling, editable event rules, and audio alerts. No player API requests, statistics, or game integration are included.

## Install and launch on Windows

Install **Node.js 24 LTS** (22.12+ also supported) and Git. From PowerShell:

```powershell
git clone https://github.com/CodeCarson/project_deadlock.git
cd project_deadlock
npm ci
npm run build
npm start
```

The source files must first be committed/pushed to the repository before cloning them on another machine. If you have downloaded the project directory instead, open a terminal there and start with `npm ci`.

`npm ci` installs the locked dependencies and downloads the matching official Electron binary with checksum verification. The first installation needs Internet access to npm and GitHub release assets. The built Phase 1 app works offline.

For development with hot reload:

```powershell
npm run dev
```

This starts Vite, the Electron TypeScript compiler, and Electron. Close the terminal with Ctrl+C when done. Restart `npm run dev` after changes to `electron/` or the shared timer engine; React/style edits reload automatically.

`npm run dev:web` runs the interface in a browser for layout work. **Use Electron for match reminders:** browser timers and audio may be throttled in background tabs.

## Your first match

1. Open **Settings** or click **Add reminder**. For a quick personal test, set an event at `00:10`, select Personal reminder, confirm it, and enable it.
2. Choose Soft chime, Radar pulse, or Clear bell. Set the volume and press **Test sound**. Optional spoken announcements use your system's installed voices.
3. Choose advance warnings at 30, 15, and/or 5 seconds. Enabled rules also notify at the event time. Warnings before match time zero are omitted.
4. Press **Start match** when the game clock starts. To join partway through a game or correct drift, enter the actual clock as `MM:SS` and press **Sync**. Sync preserves the running/paused state.
5. **Pause** freezes the clock. **Stop** freezes it and marks the session stopped; Resume continues from that time. **Reset** clears the clock, event log, notification history, and marked clear times for a new match.
6. For a conditional rule, **Mark cleared** when that specific camp/location is cleared. This starts its configured respawn delay. **Undo** cancels an incorrect clear mark. Clearing the same location again replaces its pending respawn.

Minimising the desktop window keeps the main-process scheduler and renderer audio active. Closing the app exits it; it does not stay in the system tray. A running match prevents automatic app suspension, but does not keep a locked/hibernated computer playing sound. Test your actual Windows audio output before playing.

## Timing rules: no guessed mechanics

The built-in categories include small/medium/large camps, boxes, golden statues, bridge buffs, Soul Urn, and another objective. **They ship disabled, without timing values.** Current timing references were inaccessible in the cloud environment, so this release does not claim those mechanics are verified. The example `02:00` in the editor is an input example, not a game rule.

Before enabling a game event, enter its timings, identify the location, add a timing source/patch note, and confirm that it matches your current game version. Source text records your verification; the app cannot verify it automatically.

There are three independent scheduling modes:

| Mode                          | Behaviour                                                                                                                       |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| One scheduled event           | Fires at a time measured from match start.                                                                                      |
| Fixed schedule                | Fires at the first time and a configured interval. Only use where the game actually uses a fixed schedule.                      |
| After manually marked cleared | Optional first spawn, then a respawn only after you manually mark that location cleared. No automatic repeating camp intervals. |

Each conditional rule tracks **one location**, not every camp of that tier. Add a separate rule for each location you care about. Jungle camp rules are restricted to conditional mode. Boxes/statues also default to conditional; confirm the actual mechanics before changing their mode.

Defaults are in [`config/timing-rules.json`](config/timing-rules.json). Times in JSON are seconds. Editing that source file changes defaults for new profiles after a rebuild; existing saved preferences are preserved. Use **Export** to back up rules and **Import** to apply edited JSON to an existing profile. Import replaces all timing rules and leaves sound/display preferences intact. Invalid files, duplicate IDs, invalid intervals, and unconfirmed enabled rules are rejected. Rules apply immediately without restarting the app.

### Clock and notification behaviour

- A monotonic elapsed-time clock runs in Electron's **main process**, independent of React rendering. UI snapshots arrive every 200 ms.
- Fired warnings/events are remembered for the match, including across backwards clock corrections. Reset starts a new notification history.
- Forward synchronisation rebases the clock without replaying events you jumped past. Backwards corrections allow upcoming unfired events while suppressing already delivered occurrences.
- Alerts delayed by up to 5 seconds are delivered. Older alerts and advance warnings whose event is already past are consumed silently to avoid a stale notification burst after suspension.
- Sound errors appear in the app. Muted rules/volume never imply that audio was heard. Speech depends on OS voice availability.

## Persistence

Electron atomically saves settings to `settings.json` in `app.getPath('userData')` (normally `%APPDATA%\deadlock-companion` on Windows). This includes rules, enabled categories, warning selections, volume, selected sound, speech, and compact layout. Invalid settings files are preserved as `settings.invalid-<timestamp>.json` and defaults are loaded. Browser development mode uses localStorage separately.

Match state is deliberately temporary: reopening starts at `00:00` with no clear marks, preventing an old match from resuming accidentally. Built-in sounds are generated locally with Web Audio; arbitrary custom audio-file imports are not included in this phase.

## Build a Windows installer

```powershell
npm run dist:win
```

The x64 NSIS installer is written to `release/Deadlock Companion Setup 0.1.0.exe`. It allows choosing an installation folder and creating a desktop shortcut. Signing and executable resource editing are disabled for this development release. A Windows publisher certificate and final application icon/metadata should be added before a public release.

For a portable Windows folder instead of an installer:

```powershell
npm run dist:win:zip
```

Extract the resulting ZIP completely, then launch `Deadlock Companion.exe` inside it. Keep the accompanying files next to the executable.

The cloud can build the portable ZIP. Its NSIS installer step needs Wine; the available bundled Wine toolset failed to load its runtime DLLs here, so a complete installer has not been validated in this environment. Run `npm run dist:win` on Windows to avoid that Linux prerequisite.

A generated installer or ZIP must be tested on Windows; Linux build success alone does not demonstrate that Windows installation, sound routing, or minimisation work on your PC.

## Validation

```powershell
npm test
npm run build
npx playwright install chromium
npm run test:ui
npm run test:desktop
```

- Unit tests cover event/warning boundaries, elapsed time, pause/resume/stop/reset, forward/backward sync, notification deduplication, delayed ticks, distinct conditional camp locations, rule edits, and configuration validation.
- Browser tests exercise actual navigation, audio generation, event delivery, manual sync, persistence, error messages, and responsive layout.
- The Electron test launches the **production build**, checks preload isolation, delivers an alert and starts its tone oscillators while the native window is minimised, verifies the settings file, and relaunches to confirm persistence. It uses an isolated temporary profile.

For this headless Debian cloud image:

```bash
CHROMIUM_PATH=/usr/bin/chromium npm run test:ui
bash scripts/test-desktop-cloud.sh
```

The desktop helper uses the image's existing Xorg dummy driver and Xfce window manager; it starts an isolated display and cleans up its own processes. Chromium's OS sandbox is disabled **only for that restricted-container test process**. A normal desktop launch does not pass that flag. On other Linux CI images, provide Xvfb and a window manager to run the minimise test. A bare X server has no native minimisation support.

Tests verify scheduling and sound generation, not human audibility through a physical speaker. Use Test sound on Windows for that last check.

## Code layout

- `electron/main.ts`: desktop lifecycle, validated IPC, atomic settings storage, and background scheduler.
- `electron/preload.cts`: narrow typed bridge; no general IPC or filesystem access is exposed.
- `src/core/timer.ts`: deterministic clock and event engine, independent of React/Electron.
- `src/core/schema.ts`: settings, rule, and command validation.
- `src/core/audio.ts`: local tone synthesis and optional speech.
- `src/core/bridge.ts`: browser-only development adapter.
- `src/App.tsx`, `src/components/RuleEditor.tsx`, `src/styles.css`: navigation, clock, queue, rule editor, and settings.

The renderer has no Node integration. Context isolation, renderer sandboxing, a content security policy, sender validation, and blocked window navigation keep the desktop boundary narrow. There is no game memory access, injection, overlay, automation, or live-clock discovery.

## What comes next

First finish Phase 1 validation on your Windows machine and verify objective timings against the current patch. Optional Phase 1 improvements are custom sound-file imports, a tray icon, and accessibility refinements. Dashboard statistics, player lookup, match history, hero analytics, API caching, and charts are explicitly deferred to later phases. Their navigation destinations are labelled as planned, and no fabricated player data is displayed.
