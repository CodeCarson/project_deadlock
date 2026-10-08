# Deadlock Companion Timer Helper

This is an experimental, background-only Overwolf development app. It forwards documented Deadlock clock, pause and match-end events over an authenticated loopback WebSocket to the desktop companion. It has no overlay, capture, recording, ads, analytics or remote API calls. It requests `game_info` and `match_info` because the required clock/pause events belong to those features; it ignores roster, items and match-history information.

Use the desktop app's **Settings → Automatic match tracking → Export paired helper** to create a folder with your private pairing configuration. Do not share that folder or its `config.js`. The unpaired source folder cannot connect.

Install/update Overwolf from https://www.overwolf.com/. In Overwolf Settings, enable development options, then use **Load unpacked extension** and select the exported folder containing `manifest.json`. Start the helper if necessary. This is a development installation, not an approved Overwolf Appstore listing; Overwolf requires developer whitelisting to load or run unpacked/unreleased apps. Follow the [official developer access instructions](https://dev.overwolf.com/ow-native/reference/ow-sdk-introduction#get-whitelisted-as-a-developer) first. Do not claim a store installation or approval. Use Overwolf 0.311.0.6 or newer.

Enable **Automatic match tracking** in the desktop app, keep Overwolf and the companion running, and enter a normal Deadlock match. The companion waits for a valid match ID and a nonnegative `match_clock` sample. It never guesses time zero from loading or `match_start`. Join mid-match: the next live clock sample starts at the current game time without replaying old reminders. Clock/pause events are documented as available only in Deadlock mode.

Match end stops tracking. Missing clock samples for five seconds or a disconnected helper pauses automatic reminders. Reconnection uses fresh samples; manual Start/Pause/Stop/Reset/Sync takes control for the current match until **Resume automatic tracking** or the next match. Mark cleared/Undo continues to work with automatic tracking.

Overwolf cannot promise zero FPS or frame-time impact. This helper uses plain JavaScript, one background page, one persistent local connection, at most one clock message per second plus lifecycle events, and a 15-second status heartbeat. No provider polling or per-frame work is used. Compare the same practice scene with and without Overwolf/automatic tracking, using your normal FPS and frame-time display. If performance worsens, disable automatic tracking and exit Overwolf; manual reminders remain usable.

First Windows test: verify clock agreement, game pause/unpause, a short personal reminder, disconnect/reconnect, and automatic stop at match end. Linux protocol tests use simulated SDK events and do not establish live Windows operation or performance.

Official interfaces checked on 2026-10-08:

- https://dev.overwolf.com/ow-native/live-game-data-gep/supported-games/deadlock/
- https://dev.overwolf.com/ow-native/reference/games/events/

Supported game ID: 24482. The game-event provider can be temporarily unavailable after a game patch; use manual controls when the app reports missing events.
