# Deadlock Companion — Stats & improvement

A Windows desktop companion you can leave on your second monitor. Steam-name suggestions, a balanced improvement plan, detailed postgame reviews, saved goals and a local match journal turn the player dashboard into a place to review decisions over time. The Electron timer assistant and optional cropped-clock reader remain available.

**Validation:** public history, exact Steam profile lookup, Steam-name suggestions, match metadata, items, heroes, and ranks were checked live through the desktop bridge on 2026-10-09. Unit/browser tests use API fixtures; the opt-in native smoke check uses the live service. Enabled timer presets were checked against current wiki mechanics and the latest released update listed there (2026-10-06). Valve's forum currently returns a browser challenge to this cloud, so patch text was checked through the wiki's linked update pages.

## Install and launch on Windows

Install **Node.js 24 LTS** (22.12+ also supported) and Git. From PowerShell:

```powershell
git clone https://github.com/CodeCarson/project_deadlock.git
cd project_deadlock
npm ci
npm run build
npm start
```

For a portable Windows download, use [the stats update](https://github.com/CodeCarson/project_deadlock/releases/tag/v0.4.1-phase3), extract the entire ZIP and open `Deadlock Companion.exe`. Keep the extracted files together. If you have downloaded the source directory instead, start with `npm ci`.

`npm ci` installs the locked dependencies and downloads the matching official Electron binary with checksum verification. The first installation needs Internet access to npm and GitHub release assets. Match reminders work offline. Player lookup requires Internet access; previously cached player data remains viewable during outages.

For development with hot reload:

```powershell
npm run dev
```

This starts Vite, the Electron TypeScript compiler, and Electron. Close the terminal with Ctrl+C when done. Restart `npm run dev` after changes to `electron/` or the shared timer engine; React/style edits reload automatically.

`npm run dev:web` runs the interface in a browser for layout work. **Use Electron for match reminders:** browser timers and audio may be throttled in background tabs.

## Player dashboard

Open **Dashboard**, enter a numeric Steam account ID, SteamID64, `[U:1:accountID]`, a Steam `/profiles/` URL, or a numeric Statlocker/DeadlockTracker `/profile/` URL, then choose **Load player**. Or type at least two characters of a Steam display name and choose an indexed suggestion. Results show the name, avatar and account ID so duplicate names can be distinguished; a name is never automatically assigned to an account. Arrow keys and Enter select suggestions. Steam vanity URLs still need their numeric Steam ID or display name. No Steam login, Statlocker API key, or scraping is used.

The app calls fixed public endpoints on `https://api.deadlock-api.com`: player match history, exact Steam account lookup, indexed Steam-name search, active heroes, ranks, match metadata and the current item catalog. The API contract was checked against the official `deadlock-api/openapi-clients` schema and `deadlock-api/deadlock-api` source (source commit `db8b0e8`, 2026-10-08). These public endpoints were successfully tested live through the desktop bridge. The player-card endpoint requires a Patreon subscription and is not used by the dashboard.

Filters apply to the returned public history, which may not represent your complete career. Win rate counts scored wins and losses; invalid, penalised, and unscored outcomes are displayed separately. KDA uses `(kills + assists) / max(1, deaths)`. Missing metrics remain unavailable. **Net worth / min** uses each match's final net worth divided by duration; the history endpoint does not supply total earned souls per minute, so the dashboard does not claim that metric. Hero win rates and recent match details derive from the same filtered matches. A rank appears only when a match supplies a ranked display badge; its date is shown as a last-match badge, not a live current rank.

Player responses and name suggestions are cached for five minutes; hero/rank/item assets and match metadata for one day. **Refresh** bypasses the local cache without forcing a full Steam-history rebuild, with a 30-second local cooldown. The provider also imposes hourly limits. **Rebuild full history** requests `force_refetch=true`, with a one-hour cooldown persisted across launches. The API can retrieve Steam history only when the account has access through one of its Steam bots; without that access it returns its indexed records even for a forced rebuild. Consult the [provider documentation](https://api.deadlock-api.com/docs) for access requirements, which may require a subscription. The app shows the newest match date separately from the fetch timestamp and displays whether the provider reported calling Steam. A Steam fetch attempt still does not guarantee complete career history. Clearing the app cache cannot recover records absent from the provider. Failed requests retain previously validated cached data and show its timestamp and an offline-cache label. Corrupt or incompatible cache entries are fetched again. A failed lookup for a different account never relabels the preceding player's data.

## Collecting older history

Open **History coverage** to compare the latest provider response with the app's retained collection, see its oldest match date, and optionally enter your own expected career total. That total is a personal estimate, not a provider-verified count. Successful refreshes merge matches by ID instead of discarding older collected records when a later response shrinks; fresh non-missing fields take precedence.

The provider has no pagination parameter for this history endpoint. If it reports **Called Steam: no**, refreshing cannot reveal matches outside its indexed database. Follow the current access instructions on [deadlock-api.com](https://deadlock-api.com), verify that your Steam account is friends with the provider's Steam bot, then use **Rebuild full history**. The provider controls availability and may require a subscription. A Steam call does not guarantee that every older match is retrievable.

**Export collected history** saves a versioned JSON archive. **Import history archive** merges a previously exported archive for the same account; it does not scrape another service or manufacture missing matches. Imports require explicit account IDs on every row, reject mismatched accounts and unsupported formats, and are limited to 10 MB and 10,000 rows. The archive contains match history only. Goals and journal notes remain in the app's local settings profile.

## Improvement and postgame analysis

Open **Analysis** for a balanced review of survival, combat, farming and hero results. Choose one game mode; current hero/time filters also apply. Recent and previous windows contain equal, non-overlapping sets of up to 20 scored games. Deaths per 10 minutes, kills plus assists per 10 minutes, and last hits per minute divide recorded totals by their eligible match durations. Missing fields are excluded with sample counts shown. A rolling chart uses up to ten scored matches per point. These are comparisons with your own history; patch changes, opponents, hero choices and roles can affect them.

The suggested review focus selects the largest adverse relative change of at least 10% among those three rates, requiring five measured games in each window. It is a prompt to inspect decisions, not proof of a cause or a skill grade. Hero evidence shows game counts and 95% Wilson intervals alongside win rate so small samples do not appear conclusive.

Save one measurable goal for the next ten new scored matches. Its baseline uses up to 20 recent scored matches of the selected mode/hero, with at least five measured games required. Progress uses only matches played after saving the goal and after its newest known match ID; importing old games cannot count as progress. The saved scope remains fixed when browsing other filters. At least five eligible measurements are needed before assessing progress.

**Postgame review** is available on Dashboard, Analysis and Match History. Choose a match and load its detailed review on demand. The app requests already indexed metadata with `disable_steam=true`; it does not request a new replay from Steam. Some matches have no detailed metadata. Available reviews include kill participation, team wealth/damage shares, death timestamps and recorded time dead, sampled net-worth/damage charts, resource counters, and item purchase/upgrade/sale events. Team shares require a complete supported-mode roster and complete relevant fields. Damage/healing/income summaries require a snapshot within 30 seconds of match end and may omit the final seconds. Recorded income counters may not cover all sources of earned souls. Item names come from the current catalog; events are not a reconstructed final inventory or a historical build recommendation.

Use the review prompts to inspect what you knew before deaths, how you arrived at fights and which resource routes you missed. Save a short note to the local **Postgame journal** and return to it later. Notes and goals are separate for each account and persist across launches; up to 500 notes of 1,500 characters each are supported. The app cannot determine from summary statistics whether a specific death was avoidable.

## Hero analytics and match history

**Heroes** shows a matches-played chart and a full table of each hero’s available matches, wins/losses/unscored results, win rate, average K/D/A, KDA and final net worth per minute. **Dashboard** and **Heroes** include daily performance charts with expandable data tables. Rank trends use reported match badges only; accounts without them show an unavailable message. Daily dates use the computer’s local time zone.

**Match History** displays all returned matches, 25 per page, with match-ID search, result filters, newest/oldest/duration ordering and expandable history fields. The shared hero, mode and time filters persist across pages and launches. These pages use the same available history; they do not infer missing matches or career totals.

## Your first match (manual mode)

1. Open **Settings** or click **Add reminder**. For a quick personal test, set an event at `00:10`, select Personal reminder, confirm it, and enable it.
2. Choose Soft chime, Radar pulse, or Clear bell. Set the volume and press **Test sound**. Optional spoken announcements use your system's installed voices.
3. Choose advance warnings at 30, 15, and/or 5 seconds. Enabled rules also notify at the event time. Warnings before match time zero are omitted.
4. Press **Start match** when the game clock starts. To join partway through a game or correct drift, enter the actual clock as `MM:SS` and press **Sync**. Sync preserves the running/paused state.
5. **Pause** freezes the clock. **Stop** freezes it and marks the session stopped; Resume continues from that time. **Reset** clears the clock, event log, notification history, and marked clear times for a new match.
6. For a conditional rule, **Mark cleared** when that specific camp/location is cleared. This starts its configured respawn delay. **Undo** cancels an incorrect clear mark. Clearing the same location again replaces its pending respawn.

Minimising the desktop window keeps the main-process scheduler and renderer audio active. Closing the app exits it; it does not stay in the system tray. A running match prevents automatic app suspension, but does not keep a locked/hibernated computer playing sound. Test your actual Windows audio output before playing.

## Editable timer defaults

All eight built-in rules start **enabled**. They were checked on 2026-10-08 against [current mechanics](https://deadlock.wiki/Haunt) and the latest released update listed by the wiki, [October 6, 2026](https://deadlock.wiki/Update:October_6,_2026). Each rule stores a source and timing note in [`config/timing-rules.json`](config/timing-rules.json). Use **Edit rule** to change any timing, source, location or window, or switch a rule off.

| Preset                                   | First event        | Later timing                                                             |
| ---------------------------------------- | ------------------ | ------------------------------------------------------------------------ |
| Small camp                               | 2:00               | 1:25 after full clear                                                    |
| Medium camp                              | 5:00               | 4:50 after full clear, including any Sinner's Sacrifice machines         |
| Large camp                               | 8:00               | 5:35 after full clear                                                    |
| Surface boxes                            | 3:00               | Earliest 3:00 after break; uncollected loot may delay it                 |
| Surface buff containers (golden statues) | 3:00               | Earliest 3:00 after break; uncollected buffs may delay it                |
| Bridge buffs                             | 5:00               | Fixed every 5:00                                                         |
| Soul Urn                                 | 10:00 descent      | This preset alerts the first descent only; landing is 12.5 seconds later |
| Unstable Rift visual effect              | 10:00–12:00 window | 6:00–8:00 after the manually observed previous effect                    |

Boxes and buff containers have **location exceptions**: tunnels first spawn at 5:00 with a 5:00 delay; the room above Midboss first spawns at 10:00 with a 3:00 delay. Set the corresponding values when tracking those locations. Drops left uncollected may postpone their actual respawn.

The Urn's later schedule is nominally 10/15/20/25 minutes, but carrying can delay the next spawn. Its default avoids repeated exact-spawn claims and covers the verified first descent. The Rift is random: **Mark appeared** when its initial visual effect appears; the next window then follows that observed time. The capture point opens 80 seconds after the visual effect. Audio announces the beginning of a window, not an exact Rift spawn. Sync the clock manually as before.

Sources: [Haunts](https://deadlock.wiki/Haunt), [Crates](https://deadlock.wiki/Crate), [Buff containers](https://deadlock.wiki/Buff_Container), [Powerups](https://deadlock.wiki/Powerups), [Soul Urn](https://deadlock.wiki/Soul_Urn), [Unstable Rift](https://deadlock.wiki/Unstable_Rift), and the linked [September 16](https://deadlock.wiki/Update:September_16,_2026), [September 29](https://deadlock.wiki/Update:September_29,_2026), and [June 30](https://deadlock.wiki/Update:June_30,_2026) patch notes. Future patches may change these values; the app does not fetch timing changes automatically.

There are three independent scheduling modes:

| Mode                          | Behaviour                                                                                                                       |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| One scheduled event           | Fires at a time measured from match start.                                                                                      |
| Fixed schedule                | Fires at the first time and a configured interval. Only use where the game actually uses a fixed schedule.                      |
| After manually marked cleared | Optional first spawn, then a respawn only after you manually mark that location cleared. No automatic repeating camp intervals. |

Each conditional rule tracks **one location**, not every camp of that tier. Add a separate rule for each location you care about. Jungle camp rules are restricted to conditional mode. Boxes/statues also use conditional delays. Variable windows remain visible until their end and require a manually observed appearance before scheduling the next window.

Defaults are in [`config/timing-rules.json`](config/timing-rules.json). Times in JSON are seconds. Editing that source file changes defaults for new profiles after a rebuild; existing saved preferences are preserved. Untouched empty Phase 1 placeholders upgrade to these enabled presets once; customised, deleted, renamed, or deliberately disabled configured rules are preserved. **Restore defaults** resets built-in rules while retaining personal reminders and audio preferences. Use **Export** to back up rules and **Import** to apply edited JSON to an existing profile. Import replaces all timing rules and leaves sound/display preferences intact. Invalid files, duplicate IDs, invalid intervals, and unconfirmed enabled rules are rejected. Rules apply immediately without restarting the app.

### Clock and notification behaviour

- A monotonic elapsed-time clock runs in Electron's **main process**, independent of React rendering. UI snapshots arrive every 200 ms.
- Fired warnings/events are remembered for the match, including across backwards clock corrections. Reset starts a new notification history.
- Forward synchronisation rebases the clock without replaying events you jumped past. Backwards corrections allow upcoming unfired events while suppressing already delivered occurrences.
- Alerts delayed by up to 5 seconds are delivered. Older alerts and advance warnings whose event is already past are consumed silently to avoid a stale notification burst after suspension.
- Sound errors appear in the app. Muted rules/volume never imply that audio was heard. Speech depends on OS voice availability.

## Automatic match tracking — experimental local clock reader

Version 0.3.3 replaces the Overwolf helper with a standalone Windows clock reader. No Overwolf installation or developer approval is required. It reads only a small rectangle that you configure, using Windows screen capture and bundled local OCR. Images stay in memory; no recording, image files or uploads occur. Automatic tracking is off until you configure and enable it.

1. Open Deadlock with the clock visible, preferably in borderless windowed mode. Keep the same game resolution and display scaling during setup and play.
2. In **Settings → Automatic match tracking**, choose the game display and adjust the rectangle's physical-pixel X/Y/width/height to tightly surround the clock. **Test clock crop** shows only that rectangle. Exclude scores and other numbers; the maximum crop is 640 × 160 pixels.
3. Choose **Save clock area**, then enable automatic tracking. Saving is allowed even when OCR fails; enabling starts the reader, and reminders wait for reliable clock readings. Bring Deadlock to the foreground. Two consistent readings begin tracking at the visible time, including when joining mid-match.
4. Compare the companion clock with the game and test a short personal reminder, pause/unpause and alt-tab. Unreadable or missing readings pause automatic reminders. Return to the game to resume. Capture may be unavailable in exclusive fullscreen; try borderless mode or use manual controls.
5. Compare FPS/frame times in the same scene with tracking off and on. Disable it if performance suffers. Small crops and roughly one sample per second limit work, but zero performance impact is not guaranteed.

The long-lived Windows capture helper checks the foreground process name (`deadlock` or `citadel`) and window bounds before reading the configured rectangle. Only window/process metadata is inspected; no game memory, files, injection or overlay is used. OCR runs in a worker with locally bundled models, requiring no model download during play. Version 0.3.3 enlarges the crop, normalises contrast, converts it to grayscale with a white border and retries thresholded/original pixels when needed. Test clock crop shows both the original crop and the image used for recognition. Tight framing still matters: exclude scores and other numbers. Confidence and temporal consistency requirements remain unchanged. Disabling tracking releases the capture process and OCR worker. The explicit calibration preview can capture the selected rectangle outside the game, so check its coordinates before testing.

The clock advances only on accepted samples, with no extrapolation. Low-confidence, implausible or stale readings pause it. A frozen readable clock pauses after about three seconds; it cannot run ahead while frozen. Audio can arrive slightly after an event due to sampling. Initial confirmation and resumption skip events already passed instead of replaying old alerts.

This reads a visible clock rather than authoritative match events. Practice and spectator clocks cannot be distinguished from a normal match. A new clock near zero after at least 15 seconds without the prior clock resets notification history; other transitions may need **Reset** or manual **Sync**. Match end is inferred from the clock disappearing, not an explicit end event. Manual Start/Pause/Stop/Reset/Sync takes control until **Resume automatic tracking**. Mark cleared/Undo remains available during automatic tracking. Changing resolution, display position or scaling requires recalibration.

Local OCR and scheduling are tested with generated clock images, including 14–24 pixel text, low-contrast and coloured text, serif/sans-serif/monospace fonts and light/dark backgrounds. The save/enable regression test covers an unreadable crop without starting reminders. The Windows release runner tests the actual cropped-screen adapter. Recognition of your live Deadlock HUD, exclusive-fullscreen compatibility and FPS/frame-time impact still require testing on your PC.

## Persistence

Electron atomically saves settings to `settings.json` in `app.getPath('userData')` (normally `%APPDATA%\deadlock-companion` on Windows). This includes player account ID, hero/mode/time filters, automatic-tracking preference, rules, enabled categories, warning selections, volume, selected sound, speech, and compact layout. API results are saved separately in `api-cache/` inside that directory. Upgrading the application retains the same profile directory; export rules as a backup before replacing the extracted app folder. Invalid settings files are preserved as `settings.invalid-<timestamp>.json` and defaults are loaded. Browser development mode uses localStorage separately.

Match state is deliberately temporary: reopening starts at `00:00` with no clear marks, preventing an old match from resuming accidentally. Built-in sounds are generated locally with Web Audio; arbitrary custom audio-file imports are not included in this phase.

## Build a Windows installer

```powershell
npm run dist:win
```

The x64 NSIS installer is written to `release/Deadlock Companion Setup 0.4.1.exe`. It allows choosing an installation folder and creating a desktop shortcut. Signing and executable resource editing are disabled for this development release. A Windows publisher certificate and final application icon/metadata should be added before a public release.

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

For the optional live API check in the headless cloud, use `NODE_USE_ENV_PROXY=1 COMPANION_TEST_LIVE_API=1 npm run test:desktop:cloud`. It requires public API network access and leaves the default test suite independent of service availability.

- Unit tests cover event/warning boundaries, elapsed time, pause/resume/stop/reset, forward/backward sync, notification deduplication, delayed ticks, distinct conditional camp locations, rule edits, and configuration validation.
- API unit tests cover Steam IDs/profile links, missing metrics, scored outcomes, account identity validation, transport deduplication, cache expiry, refresh/rebuild cooldowns, persisted provider provenance, stored-history rate-limit responses, safe name-query encoding and cache filenames, durable history merging, account-checked archive import, metadata identity, and offline fallback. Coaching tests cover duration-weighted metrics, disjoint comparison windows, sample intervals and incomplete team/terminal data. Analytics tests cover local-date grouping, missing metrics, badge availability and history ordering.
- Browser tests exercise navigation, audio generation, event delivery, manual sync, persistence, player lookup, filters, expandable results, offline-cache labels, account switching, saved filters, hero charts, paginated/searchable history, rebuild requests, duplicate-name suggestions and stale-search responses, goals and journal persistence, detailed review, archive import/export, career estimates and responsive layout. Player API responses are intercepted fixtures; this does not validate the live service.
- The Electron test launches the **production build**, checks preload isolation, delivers an alert and starts its tone oscillators while the native window is minimised, verifies the settings file, and relaunches to confirm persistence. It also exercises API IPC with fixture responses, persists account/cache data, rejects unsupported resource requests, and verifies cached results, imported history and journal notes after relaunch. A second native test runs real local OCR on generated clock pixels with a simulated OS crop source, checks calibration, minimised reminder audio, missing readings, manual override and resumption. These use isolated temporary profiles; live game recognition and FPS remain unverified.

For this headless Debian cloud image:

```bash
CHROMIUM_PATH=/usr/bin/chromium npm run test:ui
bash scripts/test-desktop-cloud.sh
```

The desktop helper uses the image's existing Xorg dummy driver and Xfce window manager; it starts an isolated display and cleans up its own processes. Chromium's OS sandbox is disabled **only for that restricted-container test process**. A normal desktop launch does not pass that flag. On other Linux CI images, provide Xvfb and a window manager to run the minimise test. A bare X server has no native minimisation support.

Tests verify scheduling and sound generation, not human audibility through a physical speaker. Use Test sound on Windows for that last check.

## Code layout

- `electron/main.ts`: desktop lifecycle, validated IPC, atomic settings storage, clock capture coordination, and background scheduler.
- `electron/clock-capture.ts`, `scripts/capture-clock.ps1`: tiny Windows screen crops and bundled local OCR.
- `src/core/clock-reader.ts`: sample validation, clock ownership and safe reminder resumption.
- `electron/preload.cts`: narrow typed bridge; no general IPC or filesystem access is exposed.
- `src/core/timer.ts`: deterministic clock and event engine, independent of React/Electron.
- `src/core/schema.ts`: settings, rule, and command validation.
- `src/core/api.ts`: public API schemas, fixed-host transport, cache policy, account parsing, durable history archives, and statistics.
- `src/core/coaching.ts`: duration-weighted personal trends, comparison windows, win intervals and detailed review calculations.
- `src/core/settings.ts`: conservative preset migration and explicit default restoration.
- `src/components/PlayerDashboard.tsx`, `PlayerSearch.tsx`, `HistoryCoverage.tsx`: lookup suggestions, saved filters, coverage, refresh and archive controls.
- `src/components/ImprovementCenter.tsx`, `PostgameReview.tsx`: balanced analysis, saved goals, detailed match review and the local journal.
- `src/components/AnalyticsViews.tsx`, `src/core/analytics.ts`: hero analytics, performance/rank charts, local-day aggregation and the match-history explorer.
- `src/core/audio.ts`: local tone synthesis and optional speech.
- `src/core/bridge.ts`: browser-only development adapter.
- `src/App.tsx`, `src/components/RuleEditor.tsx`, `src/styles.css`: navigation, clock, queue, rule editor, and settings.

The renderer has no Node integration. Context isolation, renderer sandboxing, a content security policy, sender validation, and blocked window navigation keep the desktop boundary narrow. There is no game memory access, injection, overlay, automation, or gameplay automation. Automatic clock tracking optionally reads your configured screen rectangle locally.

## What remains

The experimental clock reader needs live Windows/Deadlock/FPS validation before it can be treated as dependable on your PC. Provider coverage may omit part of a player’s career; full history depends on the provider’s Steam access. Custom sound-file imports and a tray icon are also future enhancements. The Urn preset covers its first descent only; full tracking of pickups, delayed spawns and deliveries is a later timer enhancement.
