/* Minimal SDK relay. No overlay, capture, remote services or match-history collection. */
(() => {
  "use strict";
  const ow = window.overwolf,
    config = window.HELPER_CONFIG;
  if (!ow || !config || !/^[a-f0-9]{64}$/.test(config.token)) return;
  let socket,
    retry,
    sequence = 0,
    backoff = 1000,
    paired = false;
  let matchId = null,
    inMatch = false,
    paused = false,
    lastClock = null;
  let provider = "waiting",
    registering = false,
    gameRunning = false,
    lastSentClock = "";
  const validId = (value) =>
    typeof value === "string" && /^[1-9][0-9]{0,19}$/.test(value);
  const send = (packet) => {
    if (!paired || socket.readyState !== WebSocket.OPEN) return;
    if (socket.bufferedAmount > 8192) {
      socket.close();
      return;
    }
    socket.send(JSON.stringify({ ...packet, sequence: sequence++ }));
  };
  const status = () =>
    send({ kind: "status", message: provider, observedAt: Date.now() });
  const clock = () => {
    if (
      !inMatch ||
      !matchId ||
      !lastClock ||
      Date.now() - lastClock.observedAt > 4000
    )
      return;
    const signature = `${matchId}:${lastClock.observedAt}:${paused}`;
    if (signature === lastSentClock || !paired) return;
    lastSentClock = signature;
    send({ kind: "clock", matchId, paused, ...lastClock });
  };
  const end = () => {
    if (matchId && inMatch)
      send({ kind: "end", matchId, observedAt: Date.now() });
    inMatch = false;
    matchId = null;
    lastClock = null;
    paused = false;
    status();
  };
  const info = (update) => {
    const state =
      update.info ||
      update.res ||
      (update.category && update.key
        ? { [update.category]: { [update.key]: update.value } }
        : {});
    const game = state.game_info || {},
      match = state.match_info || {};
    if (game.phase === "PostGame") {
      end();
      return;
    }
    if (
      ["Init", "WaitingForPlayersToJoin", "PreGameWait"].includes(game.phase)
    ) {
      inMatch = false;
      matchId = null;
      lastClock = null;
      paused = false;
    }
    if (game.phase === "GameInProgress") inMatch = true;
    if (match.match_id !== undefined && validId(String(match.match_id))) {
      const id = String(match.match_id);
      if (matchId && id !== matchId) {
        lastClock = null;
        paused = false;
      }
      matchId = id;
    }
    // No roster/items/history data is read or forwarded.
    clock();
  };
  const register = () => {
    if (registering) return;
    registering = true;
    ow.games.events.setRequiredFeatures(
      ["game_info", "match_info"],
      (result) => {
        registering = false;
        provider = result.success ? "ready" : "error";
        status();
        if (result.success)
          ow.games.events.getInfo((result) => {
            if (result.success) info(result);
          });
      },
    );
  };
  ow.games.events.onInfoUpdates2.addListener(info);
  ow.games.events.onNewEvents.addListener((update) => {
    for (const event of update.events || []) {
      if (event.name === "match_start") {
        inMatch = true;
        matchId = null;
        paused = false;
        lastClock = null;
        ow.games.events.getInfo((result) => {
          if (result.success) info(result);
        });
      } else if (event.name === "match_end") end();
      else if (event.name === "game_paused") {
        if (event.data === true || event.data === "true") {
          paused = true;
          if (lastClock) lastClock.observedAt = Date.now();
          clock();
        } else if (event.data === false || event.data === "false") {
          paused = false;
          lastClock = null; // Resume only at the next actual clock sample.
        }
      } else if (
        event.name === "match_clock" &&
        typeof event.data === "string" &&
        /^\d{1,4}:[0-5]\d$/.test(event.data)
      ) {
        const [minutes, seconds] = event.data.split(":").map(Number);
        const elapsed = minutes * 60 + seconds;
        if (elapsed <= 86400) {
          lastClock = { seconds: elapsed, observedAt: Date.now() };
          clock();
        }
      }
    }
  });
  ow.games.events.onError.addListener(() => {
    provider = "error";
    status();
  });
  ow.games.onGameInfoUpdated.addListener((update) => {
    const game = update.gameInfo;
    if (!game || game.classId !== 24482) return;
    if (!game.isRunning) {
      gameRunning = false;
      end();
    } else if (!gameRunning) {
      gameRunning = true;
      register();
    }
  });
  ow.games.getRunningGameInfo((game) => {
    if (game && game.classId === 24482 && game.isRunning) {
      gameRunning = true;
      register();
    }
  });
  const connect = () => {
    clearTimeout(retry);
    paired = false;
    socket = new WebSocket(config.endpoint);
    socket.onopen = () =>
      socket.send(JSON.stringify({ kind: "pair", token: config.token }));
    socket.onmessage = (event) => {
      try {
        if (JSON.parse(event.data).kind === "paired") {
          paired = true;
          sequence = 0;
          backoff = 1000;
          lastSentClock = "";
          status();
          clock();
        }
      } catch {
        socket.close();
      }
    };
    socket.onerror = () => socket.close();
    socket.onclose = () => {
      paired = false;
      retry = setTimeout(connect, backoff);
      backoff = Math.min(backoff * 2, 30000);
    };
  };
  connect();
  setInterval(status, 15000);
})();
