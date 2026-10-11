# Deadlock Companion — The Cursed Apple

A Windows companion focused on **Live Match** timers and the **Team Planner**. **Stats** currently displays **Coming soon**. Settings is available in the header.

## Download and run on Windows

[Download the portable Windows ZIP](https://github.com/CodeCarson/project_deadlock/releases/tag/v0.7.4-phase3). Close the previous app, extract the entire ZIP into a new folder, and open `Deadlock Companion.exe`. Keep the extracted files together. Existing timer, voice, clock-crop and planner settings use the same profile directory.

The application is an unsigned development prerelease. It runs as an external desktop app; it does not install an overlay, use Overwolf, inject code, access game memory or automate gameplay.

## Live Match

Start a match manually, sync its elapsed time, pause or stop it, and track objective reminders. Built-in timer rules are enabled and editable. Boxes and golden statues share one alert. Personal reminders can use custom text and timing.

Optional Windows clock capture reads only a configured screen rectangle. Configure and save the crop in Settings, preview it, then enable automatic tracking. Images are processed locally and are not recorded or uploaded. After initial clock readings, an independent timer runs between sparse checks. Repeated clock readings can confirm a pause; short alt-tabs or blocked HUD clocks use a configurable grace period. Use **Resume live tracking** on Live Match after a manual pause. A hidden clock cannot reveal whether the game itself is paused; stop tracking when leaving the match.

Reminders run in Electron's main process, including while minimized. Settings offers seven short sounds, **Silas** and **June**, volume and playback speed (0.75–2×). Both bundled voices play prerecorded built-in event cues offline, with pitch preserved. Custom or renamed reminders use Windows system speech. No neural speech model runs during a game.

Clock-reading accuracy, physical speaker output and FPS impact must also be checked in your own game setup. The checked-in timer presets cite their sources; schedules remain editable when patches change.

## Team Planner

Enter Steam names or numeric IDs for your team. Select the matching avatar/account when names collide. Choose Normal (six heroes) or Street Brawl (three), add comfort heroes, lock preferred picks, exclude heroes and select a balanced, comfort or exploration preference.

Recommendations combine each player's available hero history, hero-adjusted performance, recorded ranked hero pairs and complete ranked compositions. Empty slots receive suggested fills; unfamiliar picks are marked. Alternative lineups prioritize different unlocked picks. Roles, evidence counts and uncertainty remain visible. Recommendations describe statistical fit, not a guaranteed win probability or verified professional-tournament data.

The planner retains the shared player-data transport it needs: Steam-name search, profile lookup, durable match history, active heroes, hero benchmarks, metric distributions, pair results and compositions. The experimental Statlocker history adapter can supplement the primary archive for Normal and Street Brawl. Coverage and access depend on providers; neither source guarantees every career game. Confirmed primary Steam-bot access permits an hourly older-history rebuild. Existing history caches are retained for planner use.

Public provider requests use fixed hosts and validated account IDs. Data is cached locally; outages can fall back to validated saved data. Player data and name suggestions cache for five minutes, heroes for a day, and reference data for six hours. The planner fetches data when used. There is no periodic background Stats collection.

## Stats

This section displays **Coming soon** and makes no player-data requests. The previous dashboard, match-history browser, coaching, graphs, goals, journal, personal-rank calculator, archive import/recovery controls and Stats settings have been removed. Their dedicated source modules, charting dependency and rank artwork are removed from the application build. Shared history and hero-fit calculations remain solely to support Team Planner.

## Development

Use Node.js 24 LTS (22.12+ supported) and Git:

```powershell
git clone https://github.com/CodeCarson/project_deadlock.git
cd project_deadlock
npm ci
npm run build
npm start
```

`npm ci` installs locked dependencies and the checksum-verified Electron binary. Development uses `npm run dev`; browser-only layout work uses `npm run dev:web`. Use the Electron desktop application for minimized/background reminders. Production builds clear old generated output first so deleted source modules cannot survive in the package.

```bash
npm run build
npm test
npm run format:check
npm run test:ui
npm run test:desktop
npm run dist:win:zip
```

The cloud image can use `CHROMIUM_PATH=/usr/bin/chromium npm run test:ui` and `npm run test:desktop:cloud`. The latter uses a temporary dummy display and isolated test profiles. Tests cover timing, local OCR, alert playback, native persistence, validated planner APIs, saved planner choices, comfort/lock/exclusion behavior, and the Stats placeholder. API fixtures do not establish live provider access or full career coverage. Windows release CI checks native capture/speech and the packaged application before publishing its ZIP and SHA256.

## Local data and desktop boundary

Windows stores settings in `%APPDATA%/deadlock-companion/settings.json` and provider results in its `api-cache` directory. Browser development uses separate localStorage. Valid timer/planner settings migrate when upgrading; invalid settings are preserved before defaults load. The renderer has no Node integration. Context isolation, renderer sandboxing, sender validation, a content security policy and blocked navigation protect the desktop boundary. Stats-only API resources and import/recovery IPC are no longer exposed.

## Attribution

Deadlock artwork belongs to Valve Corporation. The app is an unofficial community companion. Artwork provenance and checksums are in `public/deadlock/sources.json` and `NOTICE.txt`.

The 106 prerecorded Silas/June clips use Supertonic 3 presets. Model provenance, the OpenRAIL-M license and clip checksums are in `public/voices/NOTICE.txt`, `LICENSE-SUPERTONIC-MODEL.txt` and `manifest.json`. The developer-only generator is `scripts/generate-natural-voices.py`; only generated audio ships. Application source is MIT licensed; third-party artwork and audio licensing are documented separately.
