import { useEffect, useRef, useState, lazy, Suspense } from "react";
import {
  Activity,
  ArrowRight,
  Bell,
  BellRing,
  Box,
  Check,
  ChevronRight,
  CircleHelp,
  Clock3,
  Crosshair,
  Download,
  History,
  LayoutDashboard,
  Users,
  Monitor,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Settings2,
  Shield,
  SlidersHorizontal,
  Sparkles,
  Square,
  Swords,
  Trash2,
  Upload,
  Volume2,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { bridge, isDesktop } from "./core/bridge";
import {
  defaultSettings,
  timingNote,
  settingsSchema,
  errorMessage,
  type Rule,
  type Settings,
  type TimerCommand,
  type TimerSnapshot,
} from "./core/schema";
import { formatClock, parseClock } from "./core/timer";
import { notify, playSound, unlockAudio } from "./core/audio";
import { RuleEditor } from "./components/RuleEditor";
import { ClockCaptureSettings } from "./components/ClockCaptureSettings";
const PlayerDashboard = lazy(() =>
  import("./components/PlayerDashboard").then((module) => ({
    default: module.PlayerDashboard,
  })),
);
import { TeamPlanner } from "./components/TeamPlanner";
import { restoreTimerDefaults } from "./core/settings";

type Page = "Stats" | "Team Planner" | "Live Match" | "Settings";
const navigation: { name: Page; icon: LucideIcon; later?: boolean }[] = [
  { name: "Stats", icon: Activity },
  { name: "Team Planner", icon: Users },
  { name: "Live Match", icon: Crosshair },
  { name: "Settings", icon: Settings2 },
];
const emptyTimer: TimerSnapshot = {
  status: "stopped",
  seconds: 0,
  upcoming: [],
  cleared: {},
  log: [],
};
const categoryIcon = (rule: Rule) =>
  rule.category === "camp"
    ? Swords
    : rule.category === "breakable"
      ? Box
      : rule.category === "custom"
        ? Bell
        : Sparkles;
export default function App() {
  const [page, setPage] = useState<Page>("Live Match");
  const [settings, setSettings] = useState<Settings>(
    structuredClone(defaultSettings),
  );
  const settingsRef = useRef(settings);
  const [timer, setTimer] = useState(emptyTimer);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editor, setEditor] = useState<Rule>();
  const [sync, setSync] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmDefaults, setConfirmDefaults] = useState(false);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let disposed = false;
    const removeTimer = bridge.onTimer((s) => {
      if (!disposed) setTimer(s);
    });
    const removeAlert = bridge.onAlert((a) => {
      if (!disposed)
        void notify(settingsRef.current, a.message).catch((e) =>
          setError(`Audio alert failed: ${e.message}`),
        );
    });
    void Promise.all([bridge.loadSettings(), bridge.getTimer()])
      .then(([s, t]) => {
        if (!disposed) {
          setSettings(s);
          settingsRef.current = s;
          setTimer(t);
          setReady(true);
        }
      })
      .catch((e) => {
        if (!disposed) setError(`Could not load settings: ${e.message}`);
      });
    return () => {
      disposed = true;
      removeTimer();
      removeAlert();
    };
  }, []);
  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(""), 3500);
    return () => clearTimeout(id);
  }, [notice]);
  const save = async (next: Settings) => {
    if (busy)
      throw new Error("A save is already in progress. Try again in a moment.");
    setBusy(true);
    try {
      const result = await bridge.saveSettings(next);
      setSettings(result);
      settingsRef.current = result;
      setNotice("Settings saved");
    } finally {
      setBusy(false);
    }
  };
  const change = (patch: Partial<Settings>) => {
    void save({ ...settings, ...patch }).catch((e) => setError(e.message));
  };
  const command = async (c: TimerCommand) => {
    try {
      if (c.type === "start") await unlockAudio();
      setTimer(await bridge.command(c));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Timer command failed.");
    }
  };
  const testAudio = async () => {
    setTesting(true);
    try {
      await playSound(settings);
      setNotice(
        settings.volume === 0 ? "Volume is muted" : "Test sound played",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sound failed.");
    } finally {
      setTesting(false);
    }
  };
  const addRule = () =>
    setEditor({
      id: crypto.randomUUID(),
      name: "Personal reminder",
      category: "custom",
      mode: "once",
      firstSpawn: 120,
      repeatSeconds: null,
      respawnSeconds: null,
      enabled: false,
      confirmed: false,
      source: "",
      location: "",
    });
  const saveRule = async (rule: Rule) => {
    const exists = settings.rules.some((r) => r.id === rule.id);
    await save({
      ...settings,
      rules: exists
        ? settings.rules.map((r) => (r.id === rule.id ? rule : r))
        : [...settings.rules, rule],
    });
  };
  const exportRules = () => {
    const url = URL.createObjectURL(
      new Blob(
        [JSON.stringify({ version: 1, rules: settings.rules }, null, 2)],
        { type: "application/json" },
      ),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "deadlock-timing-rules.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const importRules = async (file?: File) => {
    if (!file) return;
    try {
      if (file.size > 200000)
        throw new Error("Rule file must be smaller than 200 KB.");
      const data = JSON.parse(await file.text());
      if (data.version !== 1 || !Array.isArray(data.rules))
        throw new Error("Expected a version 1 timing-rule file.");
      const next = settingsSchema.parse({ ...settings, rules: data.rules });
      await save(next);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      if (fileInput.current) fileInput.current.value = "";
    }
  };
  const enabled = settings.rules.filter((r) => r.enabled);
  const next = timer.upcoming[0];
  const status =
    timer.status === "running"
      ? "Match in progress"
      : timer.status === "paused"
        ? "Match paused"
        : "Ready when you are";
  const audioControls = (
    <>
      <div className="setting-line">
        <label htmlFor="sound">Notification sound</label>
        <select
          id="sound"
          disabled={busy}
          value={settings.sound}
          onChange={(e) =>
            change({ sound: e.target.value as Settings["sound"] })
          }
        >
          <option value="chime">Soft chime</option>
          <option value="pulse">Radar pulse</option>
          <option value="bell">Clear bell</option>
        </select>
      </div>
      <div className="setting-line">
        <label htmlFor="volume">Alert volume</label>
        <span className="mono">{Math.round(settings.volume * 100)}%</span>
      </div>
      <input
        id="volume"
        aria-label="Alert volume"
        className="slider"
        type="range"
        min="0"
        max="100"
        value={Math.round(settings.volume * 100)}
        disabled={busy}
        onChange={(e) => {
          const s = { ...settings, volume: Number(e.target.value) / 100 };
          setSettings(s);
          settingsRef.current = s;
        }}
        onPointerUp={() => change({ volume: settings.volume })}
        onKeyUp={() => change({ volume: settings.volume })}
      />
      <button
        className="button secondary full"
        onClick={() => void testAudio()}
        disabled={testing}
      >
        <Volume2 size={16} />
        {testing ? "Playing…" : "Test sound"}
      </button>
      <label className="checkbox-row speech">
        <input
          type="checkbox"
          checked={settings.speech}
          disabled={busy}
          onChange={(e) => change({ speech: e.target.checked })}
        />
        Speak event announcements
      </label>
      <small className="muted">
        Speech uses voices installed on your computer.
      </small>
    </>
  );
  const ruleCards = (
    <div className="rule-grid">
      {settings.rules.map((rule) => {
        const Icon = categoryIcon(rule);
        const occurrence = timer.upcoming.find((o) => o.ruleId === rule.id);
        return (
          <article
            className={`rule-card ${rule.enabled ? "enabled" : ""}`}
            key={rule.id}
          >
            <div className="rule-top">
              <span className={`rule-icon ${rule.category}`}>
                <Icon size={21} />
              </span>
              <button
                className={`toggle ${rule.enabled ? "on" : ""}`}
                role="switch"
                aria-checked={rule.enabled}
                aria-label={`Enable ${rule.name}`}
                disabled={busy}
                onClick={() => {
                  if (!rule.confirmed) {
                    setEditor(rule);
                    return;
                  }
                  void saveRule({ ...rule, enabled: !rule.enabled }).catch(
                    (e) => setError(e.message),
                  );
                }}
              >
                <span />
              </button>
            </div>
            <h3>{rule.name}</h3>
            <p className="rule-location">{rule.location || "Match reminder"}</p>
            {rule.note && <small className="rule-note">{rule.note}</small>}
            <div className="rule-timing">
              <span>
                {rule.enabled && occurrence
                  ? occurrence.windowEnd && occurrence.at <= timer.seconds
                    ? "Open"
                    : formatClock(Math.max(0, occurrence.at - timer.seconds))
                  : rule.confirmed
                    ? "Configured"
                    : "Set timing"}
              </span>
              <span className="muted">
                {rule.enabled && occurrence
                  ? occurrence.windowEnd
                    ? `${formatClock(occurrence.at)}–${formatClock(occurrence.windowEnd)}`
                    : occurrence.kind === "respawn" &&
                        rule.category === "breakable"
                      ? "earliest respawn"
                      : "until event"
                  : rule.mode === "conditional"
                    ? "conditional respawn"
                    : rule.mode === "interval"
                      ? "fixed schedule"
                      : "first event"}
              </span>
            </div>
            <div className="rule-footer">
              <button className="text-button" onClick={() => setEditor(rule)}>
                <SlidersHorizontal size={13} />
                Edit rule
              </button>
              {rule.mode === "conditional" &&
                rule.enabled &&
                rule.respawnSeconds !== null && (
                  <button
                    className="text-button amber-text"
                    disabled={timer.status !== "running"}
                    onClick={() =>
                      void command({ type: "clear", ruleId: rule.id })
                    }
                  >
                    {rule.windowSeconds ? "Mark appeared" : "Mark cleared"}
                  </button>
                )}
            </div>
            {timer.cleared[rule.id] !== undefined && (
              <div className="clear-note">
                {rule.windowSeconds ? "Appeared" : "Cleared"} at{" "}
                {formatClock(timer.cleared[rule.id])}
                <button
                  className="text-button"
                  onClick={() =>
                    void command({ type: "undo-clear", ruleId: rule.id })
                  }
                >
                  Undo
                </button>
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
  return (
    <div className={`app ${settings.compact ? "compact" : ""}`}>
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <Crosshair size={27} />
          </div>
          <div>
            <strong>DEADLOCK</strong>
            <span>COMPANION</span>
          </div>
        </div>
        <span className="nav-label">YOUR PLAYBOOK</span>
        <nav aria-label="Main navigation">
          {navigation.map(({ name, icon: Icon, later }) => (
            <button
              key={name}
              aria-label={name}
              className={`nav-item ${page === name ? "active" : ""}`}
              onClick={() => setPage(name)}
            >
              <Icon size={19} />
              <span>{name}</span>
              {name === "Live Match" ? (
                <span className="live-dot" />
              ) : later ? (
                <span className="soon-dot" aria-hidden="true" />
              ) : null}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="phase-card">
            <span className="phase-chip">PHASE 03</span>
            <h3>Built for your next match.</h3>
            <p>
              Your stats. Your reminders.
              <br />
              Stay one step ahead.
            </p>
            <div className="tiny-line" />
          </div>
          <div className="runtime">
            <Monitor size={15} />
            <span>
              {isDesktop ? "Desktop companion" : "Browser development mode"}
            </span>
            <span className="runtime-dot" />
          </div>
          <span className="version">v0.5.0 · Independent community tool</span>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            Companion <ChevronRight size={13} />
            <strong>{page}</strong>
          </div>
          <div className="topbar-right">
            <span className="build-badge">EARLY ACCESS</span>
            <span className="divider" />
            <span className="desktop-label">
              <Shield size={14} />
              External match assistant
            </span>
          </div>
        </header>
        <main>
          {!ready ? (
            <div className="panel empty">
              <Clock3 size={30} />
              <h2>Loading your companion…</h2>
              {error && (
                <p role="alert" className="error">
                  {error}
                </p>
              )}
            </div>
          ) : (
            <>
              <div className="page-heading">
                <div>
                  <span className="eyebrow">
                    {page === "Live Match"
                      ? "STAY AHEAD OF THE CLOCK"
                      : page === "Settings"
                        ? "MAKE IT YOURS"
                        : "YOUR SECOND-MONITOR COMPANION"}
                  </span>
                  <h1>
                    {page === "Live Match"
                      ? "Live match"
                      : page === "Settings"
                        ? "Settings"
                        : page}
                  </h1>
                  <p>
                    {page === "Live Match"
                      ? "Focus on the fight. We’ll keep an eye on the time."
                      : page === "Settings"
                        ? "Tune your reminders to the way you play."
                        : page === "Team Planner"
                          ? "Build a lineup around your team's strongest heroes."
                          : "Review your games, choose one change and track your progress."}
                  </p>
                </div>
                {(page === "Live Match" || page === "Settings") && (
                  <button className="button secondary" onClick={addRule}>
                    <Plus size={16} />
                    Add reminder
                  </button>
                )}
              </div>
              {error && (
                <div className="banner error-banner" role="alert">
                  <CircleHelp size={18} />
                  <span>{error}</span>
                  <button
                    className="icon-button"
                    aria-label="Dismiss error"
                    onClick={() => setError("")}
                  >
                    <X size={16} />
                  </button>
                </div>
              )}
              {!isDesktop && page === "Live Match" && (
                <div className="banner info-banner">
                  <Monitor size={17} />
                  <span>
                    Browser mode is for development. Launch Electron for
                    dependable alerts while minimised.
                  </span>
                </div>
              )}
              {page === "Live Match" && (
                <>
                  <div className="live-grid">
                    <section
                      className={`clock-card panel ${timer.status === "running" ? "running" : ""}`}
                    >
                      <div className="clock-card-top">
                        <span className="card-label">
                          <Clock3 size={16} />
                          MATCH CLOCK
                        </span>
                        <span className={`status-pill ${timer.status}`}>
                          <i />
                          {status}
                        </span>
                      </div>
                      <div className="clock-stage">
                        <div className="clock-orbit" />
                        <span className="clock-ticks">
                          {settings.automaticTracking &&
                          timer.detection?.connected &&
                          !timer.detection.manualOverride
                            ? "AUTO-SYNCED TIMER"
                            : "MANUAL SYNC"}
                        </span>
                        <div
                          className="match-clock"
                          aria-label="Match clock"
                          role="timer"
                        >
                          {formatClock(timer.seconds)}
                        </div>
                        <span className="clock-caption">
                          YOUR MATCH. YOUR PACE.
                        </span>
                      </div>
                      {settings.automaticTracking && (
                        <p className="detection-status">
                          {timer.detection?.message ??
                            "Automatic tracking requires the desktop app"}
                        </p>
                      )}
                      <div className="clock-buttons">
                        <button
                          className="button primary large"
                          onClick={() =>
                            void command({
                              type:
                                timer.status === "running" ? "pause" : "start",
                            })
                          }
                        >
                          {timer.status === "running" ? (
                            <Pause size={17} />
                          ) : (
                            <Play size={17} />
                          )}{" "}
                          {timer.status === "running"
                            ? "Pause"
                            : timer.seconds > 0
                              ? "Resume match"
                              : "Start match"}
                        </button>
                        <button
                          className="button secondary"
                          disabled={timer.status === "stopped"}
                          onClick={() => void command({ type: "stop" })}
                        >
                          <Square size={15} />
                          Stop
                        </button>
                        <button
                          className="icon-button outlined"
                          aria-label="Reset timer"
                          onClick={() => {
                            if (timer.seconds > 0) setConfirmReset(true);
                            else void command({ type: "reset" });
                          }}
                        >
                          <RotateCcw size={17} />
                        </button>
                      </div>
                      {confirmReset && (
                        <div className="reset-confirm">
                          Reset the clock and cleared camps?
                          <button
                            className="text-button amber-text"
                            onClick={() => {
                              void command({ type: "reset" });
                              setConfirmReset(false);
                            }}
                          >
                            Reset
                          </button>
                          <button
                            className="text-button"
                            onClick={() => setConfirmReset(false)}
                          >
                            Cancel
                          </button>
                        </div>
                      )}
                      <form
                        className="sync-row"
                        onSubmit={(e) => {
                          e.preventDefault();
                          try {
                            void command({
                              type: "sync",
                              seconds: parseClock(sync),
                            });
                            setSync("");
                          } catch (e) {
                            setError((e as Error).message);
                          }
                        }}
                      >
                        <label htmlFor="sync-clock">Sync to game clock</label>
                        <div>
                          <input
                            id="sync-clock"
                            aria-label="Sync to game clock"
                            placeholder="MM:SS"
                            value={sync}
                            onChange={(e) => setSync(e.target.value)}
                          />
                          <button className="sync-button" type="submit">
                            Sync <ArrowRight size={14} />
                          </button>
                        </div>
                      </form>
                    </section>
                    <div className="live-right">
                      <section className="panel upcoming-panel">
                        <div className="section-heading">
                          <span className="card-label">
                            <BellRing size={16} />
                            UP NEXT
                          </span>
                          <span className="counter">
                            {enabled.length} active
                          </span>
                        </div>
                        {next ? (
                          <>
                            <div className="next-event">
                              <span className="next-icon">
                                <Sparkles size={23} />
                              </span>
                              <div>
                                <span className="eyebrow">
                                  {next.windowEnd
                                    ? "VARIABLE SPAWN WINDOW"
                                    : next.kind === "respawn"
                                      ? "CONDITIONAL RESPAWN"
                                      : "SCHEDULED EVENT"}
                                </span>
                                <h2>{next.name}</h2>
                                <p>
                                  {next.windowEnd
                                    ? `${formatClock(next.at)}–${formatClock(next.windowEnd)} · visual effect`
                                    : next.location ||
                                      `At ${formatClock(next.at)} match time`}
                                </p>
                              </div>
                              <span className="next-countdown">
                                {next.windowEnd && next.at <= timer.seconds
                                  ? "Open"
                                  : formatClock(next.at - timer.seconds)}
                              </span>
                            </div>
                            <div className="timeline-list">
                              {timer.upcoming.slice(1, 4).map((o) => (
                                <div key={o.key}>
                                  <i />
                                  <span>{o.name}</span>
                                  <time>
                                    {formatClock(o.at)}
                                    {o.windowEnd
                                      ? `–${formatClock(o.windowEnd)}`
                                      : ""}
                                  </time>
                                </div>
                              ))}
                            </div>
                          </>
                        ) : (
                          <div className="empty-upcoming">
                            <div className="empty-icon">
                              <Bell size={23} />
                            </div>
                            <h3>Your next move, on time.</h3>
                            <p>
                              Configure and confirm an event timing to see your
                              upcoming reminders here.
                            </p>
                            <button
                              className="text-button purple-text"
                              onClick={() => setPage("Settings")}
                            >
                              Configure reminders <ArrowRight size={14} />
                            </button>
                          </div>
                        )}
                      </section>
                      <section className="panel sound-panel">
                        <div className="section-heading">
                          <span className="card-label">
                            <Volume2 size={16} />
                            AUDIO ALERTS
                          </span>
                          <span className="subtle-tag">
                            {settings.volume === 0 ? "MUTED" : "SOUND ON"}
                          </span>
                        </div>
                        {audioControls}
                      </section>
                    </div>
                  </div>
                  <section className="events-section">
                    <div className="section-heading">
                      <div>
                        <h2>
                          Event reminders{" "}
                          <span className="heading-count">
                            {settings.rules.length}
                          </span>
                        </h2>
                        <p>
                          Scheduled spawns and location-specific respawns, kept
                          separate.
                        </p>
                      </div>
                      <button
                        className="text-button"
                        onClick={() => setPage("Settings")}
                      >
                        <Settings2 size={15} />
                        Manage rules
                      </button>
                    </div>
                    <div className="timing-notice">
                      <Shield size={15} />
                      <span>{timingNote}</span>
                    </div>
                    {ruleCards}
                  </section>
                  <section className="panel log-panel">
                    <div className="section-heading">
                      <span className="card-label">
                        <Activity size={16} />
                        REMINDER ACTIVITY
                      </span>
                      <span className="muted">This match</span>
                    </div>
                    {timer.log.length ? (
                      <div className="log-list">
                        {timer.log.slice(0, 8).map((a) => (
                          <div key={a.id}>
                            <span className="log-dot" />
                            <time>{formatClock(a.at)}</time>
                            <span>{a.message}</span>
                            {a.late && <small>delivered late</small>}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="muted">
                        Alerts will appear here as your match progresses. Press
                        Test sound before your first match.
                      </p>
                    )}
                  </section>
                </>
              )}
              {page === "Settings" && (
                <>
                  <ClockCaptureSettings
                    settings={settings}
                    detection={timer.detection}
                    busy={busy}
                    onSave={(captureRegion, automaticTracking) =>
                      save({
                        ...settings,
                        captureRegion,
                        automaticTracking,
                      }).then(() => {})
                    }
                    onError={setError}
                    onTimingChange={(clockSyncSeconds, clockGraceSeconds) =>
                      save({
                        ...settingsRef.current,
                        clockSyncSeconds,
                        clockGraceSeconds,
                      }).then(() => {})
                    }
                  />
                  <div className="settings-grid">
                    <section className="panel settings-panel">
                      <div className="section-heading">
                        <div>
                          <h2>Sound & notifications</h2>
                          <p>A little heads-up goes a long way.</p>
                        </div>
                        <Volume2 size={21} className="muted" />
                      </div>
                      {audioControls}
                    </section>
                    <section className="panel settings-panel">
                      <div className="section-heading">
                        <div>
                          <h2>Advance warnings</h2>
                          <p>Get ready before the event arrives.</p>
                        </div>
                        <Bell size={21} className="muted" />
                      </div>
                      <div className="warning-options">
                        {[30, 15, 5].map((n) => (
                          <label
                            className={`warning-option ${settings.warnings.includes(n) ? "selected" : ""}`}
                            key={n}
                          >
                            <input
                              type="checkbox"
                              disabled={busy}
                              checked={settings.warnings.includes(n)}
                              onChange={(e) =>
                                change({
                                  warnings: e.target.checked
                                    ? [...settings.warnings, n]
                                    : settings.warnings.filter((v) => v !== n),
                                })
                              }
                            />
                            <strong>
                              {n}
                              <small>sec</small>
                            </strong>
                            <span>before event</span>
                          </label>
                        ))}
                      </div>
                      <p className="muted">
                        The event-time alert always plays for enabled rules.
                        Late, obsolete alerts are skipped to avoid a burst after
                        sleep.
                      </p>
                      <label className="checkbox-row">
                        <input
                          type="checkbox"
                          disabled={busy}
                          checked={settings.compact}
                          onChange={(e) =>
                            change({ compact: e.target.checked })
                          }
                        />
                        Use a compact layout
                      </label>
                    </section>
                  </div>
                  <section className="events-section">
                    <div className="section-heading">
                      <div>
                        <h2>Your timing rules</h2>
                        <p>
                          Saved locally between launches. Changes apply
                          immediately.
                        </p>
                      </div>
                      <div className="button-group">
                        <button
                          className="button secondary small"
                          disabled={busy}
                          onClick={() => setConfirmDefaults(true)}
                        >
                          <RotateCcw size={14} />
                          Restore defaults
                        </button>
                        <button
                          className="button secondary small"
                          onClick={() => fileInput.current?.click()}
                        >
                          <Upload size={14} />
                          Import
                        </button>
                        <button
                          className="button secondary small"
                          onClick={exportRules}
                        >
                          <Download size={14} />
                          Export
                        </button>
                        <input
                          ref={fileInput}
                          className="visually-hidden"
                          type="file"
                          accept=".json,application/json"
                          aria-label="Import timing rules"
                          onChange={(e) =>
                            void importRules(e.target.files?.[0])
                          }
                        />
                      </div>
                    </div>
                    <div className="timing-notice">
                      <CircleHelp size={16} />
                      <span>
                        Import replaces your rules, not your audio preferences.
                        Keep a source or patch note with each game timing.
                      </span>
                    </div>
                    {ruleCards}
                    {confirmDefaults && (
                      <div className="banner info-banner">
                        <span>
                          Restore built-in timer rules? Your personal reminders
                          and audio settings will be kept.
                        </span>
                        <button
                          className="text-button purple-text"
                          disabled={busy}
                          onClick={() =>
                            void save(restoreTimerDefaults(settings))
                              .then(() => setConfirmDefaults(false))
                              .catch((e) => setError(e.message))
                          }
                        >
                          Restore
                        </button>
                        <button
                          className="text-button"
                          onClick={() => setConfirmDefaults(false)}
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                    <div className="custom-rule-list">
                      {settings.rules
                        .filter(
                          (r) =>
                            !defaultSettings.rules.some((d) => d.id === r.id),
                        )
                        .map((r) => (
                          <div key={r.id}>
                            <span>{r.name}</span>
                            <button
                              className="text-button danger-text"
                              disabled={busy}
                              aria-label={`Delete ${r.name}`}
                              onClick={() =>
                                void save({
                                  ...settings,
                                  rules: settings.rules.filter(
                                    (x) => x.id !== r.id,
                                  ),
                                }).catch((e) => setError(e.message))
                              }
                            >
                              <Trash2 size={14} />
                              Delete custom rule
                            </button>
                          </div>
                        ))}
                    </div>
                  </section>
                  <div className="panel settings-info">
                    <Shield size={24} />
                    <div>
                      <h3>Second-monitor only, by design.</h3>
                      <p>
                        No game memory access, injection, gameplay automation,
                        or overlay. The match clock is controlled and
                        synchronised by you.
                      </p>
                    </div>
                  </div>
                </>
              )}
              {page === "Team Planner" && (
                <TeamPlanner
                  accountId={settings.accountId}
                  saved={settings.planner}
                  onSave={(planner) =>
                    save({ ...settingsRef.current, planner }).then(() => {})
                  }
                />
              )}
              {page === "Stats" && (
                <Suspense
                  fallback={
                    <section className="panel player-empty" role="status">
                      Loading player tools…
                    </section>
                  }
                >
                  <PlayerDashboard
                    view="Stats"
                    savedFilters={settings.playerFilters}
                    research={settings.playerResearch[settings.accountId]}
                    onResearchChange={(research) =>
                      save({
                        ...settingsRef.current,
                        playerResearch: {
                          ...settingsRef.current.playerResearch,
                          [settings.accountId]: research,
                        },
                      })
                    }
                    onFiltersChange={(playerFilters) =>
                      change({ playerFilters })
                    }
                    accountId={settings.accountId}
                    onAccountChange={(accountId) =>
                      save({
                        ...settings,
                        accountId,
                        playerFilters: defaultSettings.playerFilters,
                      })
                    }
                  />
                </Suspense>
              )}
            </>
          )}
          <footer className="main-footer">
            <span>
              <Crosshair size={12} />
              DEADLOCK COMPANION
            </span>
            <span>Independent project · Not affiliated with Valve</span>
          </footer>
        </main>
      </div>
      {notice && (
        <div className="toast" role="status">
          <Check size={16} />
          {notice}
        </div>
      )}
      {editor && (
        <RuleEditor
          rule={editor}
          onSave={saveRule}
          onClose={() => setEditor(undefined)}
        />
      )}
    </div>
  );
}
