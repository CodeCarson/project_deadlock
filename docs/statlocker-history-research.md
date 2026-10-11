# Statlocker history research — 2026-10-11

The goal is Steam display name → account → the largest accessible match archive. A display name resolves an identity; match retrieval is a separate operation. Multiple Steam accounts can share the same name.

## What the public evidence establishes

1. **Statlocker has a separate profile/history service.** A public Python client requests `https://statlocker.gg/api/profile/data/matches/{account_id}/true?gameMode=1` and reads `matchHistory` and `profileAggregateStats.totalMatches`. It uses `hero_id`, `player_kills`, `player_deaths`, `player_assists`, `match_result` and `player_team`. It does not send an API key. This establishes a demonstrated endpoint, not a guarantee that anonymous access still works or that its list equals lifetime games. The meaning of the `true` path segment is undocumented in this client.
   - [Source, pinned](https://github.com/bh4455/dl_statcheck/blob/ac34f99a6259b7f16ce46349069cfcf78a1a3a6e/tracker.py)
2. **Some Statlocker API clients require a key.** A separate .NET client configures `X-API-Key` and exposes aggregate statistics and detailed match endpoints. Authentication may differ by endpoint/version. We do not collect a key or bypass authentication.
   - [Client, pinned](https://github.com/BTELNYY/statlocker.NET/blob/56c58d14ab0709a901e7f88ece3db9573c2d631d/Statlocker/Client.cs)
   - [Aggregate response, pinned](https://github.com/BTELNYY/statlocker.NET/blob/56c58d14ab0709a901e7f88ece3db9573c2d631d/Statlocker/Schema/Account/AccountResponse.cs)
3. **Our existing provider distinguishes its indexed database from Steam history.** Its server code looks up friendship with a provider bot. Without a bot, it returns ClickHouse records and `Called-Steam: false`. With access it combines the index and Game Coordinator data. Ordinary Steam requests fetch the first page; `force_refetch=true` follows `continue_cursor` through older pages, with explicit termination guards. Public REST requests do not accept a page cursor. The forced route has an hourly IP limit.
   - [History route, pinned](https://github.com/deadlock-api/deadlock-api/blob/74045de96a4ee999d22525fdcabaf84d13b546d7/api/src/routes/v1/players/match_history.rs)
4. **Name lookup is an indexed Steam-profile search, not Steam account authentication.** Our provider's `steam-search` searches names/account IDs. We disable its default recent-match minimum to include less active profiles. Selection confirms the account when names collide.
   - [Steam search, pinned](https://github.com/deadlock-api/deadlock-api/blob/74045de96a4ee999d22525fdcabaf84d13b546d7/api/src/routes/v1/players/steam/route.rs)
5. **A documented route to indexing more games exists.** Deadlock API's ingest tool reads replay references in Steam's HTTP cache and submits match IDs/salts so the provider can download metadata. Current versions also describe Steam-session recovery features. This is a separate optional application; installing it or submitting cached replay references is not performed by Companion. Review its current README and data handling first.
   - [Ingest documentation, pinned](https://github.com/deadlock-api/deadlock-api-ingest/blob/c4a10f4269fe7f55fe96dae193fc94d47befd990/README.md)

## What could not be verified

The cloud's network rejected live requests to `statlocker.gg` and `api.deadlock-api.com` with proxy/HTTP 403. The incorrect guessed domains `statlocker.com` and `statlock.gg` were also rejected before the real domain was established from public clients. These errors do not establish that Statlocker denies access on a user's PC.

Statlocker's private backend ingestion process, current name-search endpoint, freshness policy and all-history access contract were not accessible in public source. We cannot claim that Statlocker uses our provider, that its companion is required, that a name alone unlocks private games, or that it contains every career match. Its indexed database may contain records missing from another provider; the exact cause of the observed difference remains unverified.

For SteamID64 **76561198020658201**, the correct account ID is **60392473**. The user reports 506 games versus approximately 260 collected. Neither number was newly confirmed against a live provider during this investigation. Aggregate totals and individual history records can differ in mode/date scope, so importing a total without the actual games would not improve coaching.

## Implemented behavior

- Only Silas and June are selectable; removed voice assets are absent from the package.
- Selecting a Steam-name suggestion loads the same account-scoped archive as a numeric ID. A single exact suggestion can be submitted directly; ambiguous names require selection.
- Stats and background refresh check the existing provider plus Statlocker's demonstrated profile-history route for Normal and Street Brawl. Street Brawl uses the documented game-mode parameter pattern, but its live support remains unverified. Other modes remain available through the primary provider. Each mode failure is reported rather than silently called complete.
- The adapter is experimental. It checks response structure, available profile/account identities and requested game mode, preserves missing metrics as null, and merges actual rows by match ID. Existing primary values win conflicting overlaps; non-null secondary evidence fills gaps. There is no fabricated expansion to a reported aggregate total.
- The merged archive persists locally. Cached secondary checks last five minutes (manual refresh can retry after 30 seconds). Provider outages retain saved games. Source availability and counts appear beside the archive, separately from the user's self-reported career total.
- Confirmed primary Steam access triggers older-page rebuilding automatically, at most hourly. Bot setup, indexed match-ID recovery, archive import/export and optional ingest setup remain available in the archive section.

## Path to a complete picture

First try the new combined source check by selecting the Steam name. If additional Statlocker records are accessible, they become part of the single archive. If it denies access, this update cannot copy its private data automatically; its source status says so.

For remaining gaps, enable the provider's documented Steam-bot access and let the automatic full rebuild retrieve older pages. Alternatively, indexed match IDs or a validated account archive can be imported. The optional ingest tool can expose metadata for still-accessible replay references. Expired/unavailable records and provider permission limits remain real constraints. Complete career coverage should be claimed only when the actual match list has been reconciled against the in-game history, not simply when an aggregate number is reached.

No neural speech inference, new overlay, game-memory access or match-time polling was added. CPU/FPS behavior on the user's PC still needs in-game measurement.
