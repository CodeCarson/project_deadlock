import { useState, useId, useEffect, useRef } from "react";
import { X, Save, ShieldCheck } from "lucide-react";
import { ruleSchema, errorMessage, type Rule } from "../core/schema";
import { formatClock, parseClock } from "../core/timer";
export function RuleEditor({
  rule,
  onSave,
  onClose,
}: {
  rule: Rule;
  onSave: (rule: Rule) => Promise<void>;
  onClose: () => void;
}) {
  const id = useId();
  const modalRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    modalRef.current?.querySelector<HTMLInputElement>("input")?.focus();
    return () => previous?.focus();
  }, []);
  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
    }
    if (e.key !== "Tab") return;
    const elements = Array.from(
      modalRef.current?.querySelectorAll<HTMLElement>(
        "button:not(:disabled), input:not(:disabled), select:not(:disabled)",
      ) ?? [],
    );
    const first = elements[0],
      last = elements[elements.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last?.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first?.focus();
    }
  };
  const [draft, setDraft] = useState(rule);
  const [first, setFirst] = useState(
    rule.firstSpawn === null ? "" : formatClock(rule.firstSpawn),
  );
  const [repeat, setRepeat] = useState(
    rule.repeatSeconds === null ? "" : formatClock(rule.repeatSeconds),
  );
  const [respawn, setRespawn] = useState(
    rule.respawnSeconds === null ? "" : formatClock(rule.respawnSeconds),
  );
  const [windowSize, setWindowSize] = useState(
    rule.windowSeconds ? formatClock(rule.windowSeconds) : "",
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const patch = (change: Partial<Rule>) => setDraft({ ...draft, ...change });
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const parsed = ruleSchema.parse({
        ...draft,
        firstSpawn: first.trim() ? parseClock(first) : null,
        repeatSeconds: repeat.trim() ? parseClock(repeat) : null,
        respawnSeconds: respawn.trim() ? parseClock(respawn) : null,
        windowSeconds:
          draft.mode === "conditional" && windowSize.trim()
            ? parseClock(windowSize)
            : null,
      });
      await onSave(parsed);
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="modal-backdrop" onKeyDown={handleKey}>
      <section
        ref={modalRef}
        className="modal panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
      >
        <header className="section-heading">
          <div>
            <span className="eyebrow">REMINDER CONFIGURATION</span>
            <h2 id={`${id}-title`}>Edit event rule</h2>
          </div>
          <button
            className="icon-button"
            aria-label="Close rule editor"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </header>
        <form onSubmit={submit}>
          <div className="form-grid">
            <label className="span-2">
              Event name
              <input
                value={draft.name}
                maxLength={80}
                required
                onChange={(e) => patch({ name: e.target.value })}
              />
            </label>
            <label>
              Category
              <select
                value={draft.category}
                onChange={(e) => {
                  const category = e.target.value as Rule["category"];
                  patch({
                    category,
                    ...(category === "camp"
                      ? { mode: "conditional" as const }
                      : {}),
                  });
                }}
              >
                <option value="custom">Personal reminder</option>
                <option value="camp">Jungle camp</option>
                <option value="breakable">Box / statue</option>
                <option value="objective">Objective</option>
              </select>
            </label>
            <label>
              Timing type
              <select
                value={draft.mode}
                onChange={(e) =>
                  patch({ mode: e.target.value as Rule["mode"] })
                }
                disabled={draft.category === "camp"}
              >
                <option value="once">One scheduled event</option>
                <option value="interval">Fixed schedule</option>
                <option value="conditional">
                  After manually marked cleared
                </option>
              </select>
            </label>
            <label>
              First event (MM:SS)
              <input
                placeholder="e.g. 02:00, or leave blank"
                value={first}
                onChange={(e) => setFirst(e.target.value)}
              />
              <small>
                {draft.mode === "conditional"
                  ? "Optional first spawn, independent of respawns."
                  : "Time since match start."}
              </small>
            </label>
            {draft.mode === "interval" && (
              <label>
                Repeat every (MM:SS)
                <input
                  placeholder="e.g. 05:00"
                  value={repeat}
                  onChange={(e) => setRepeat(e.target.value)}
                />
                <small>Only for events on a fixed match schedule.</small>
              </label>
            )}
            {draft.mode === "conditional" && (
              <label>
                Spawn window length (MM:SS)
                <input
                  value={windowSize}
                  placeholder="Leave blank for an exact timer"
                  onChange={(e) => setWindowSize(e.target.value)}
                />
                <small>
                  First event and delay are the earliest possible times. Mark
                  the observed appearance to start the next window.
                </small>
              </label>
            )}
            {draft.mode === "conditional" && (
              <label>
                Respawn delay (MM:SS)
                <input
                  placeholder="Verified delay, or leave blank"
                  value={respawn}
                  onChange={(e) => setRespawn(e.target.value)}
                />
                <small>
                  {windowSize
                    ? "Starts when you mark the visual effect appeared."
                    : "Starts only when you mark this location cleared."}
                </small>
              </label>
            )}
            <label className="span-2">
              Timing note
              <input
                value={draft.note ?? ""}
                onChange={(e) => patch({ note: e.target.value })}
                maxLength={600}
              />
            </label>
            <label className="span-2">
              Specific location
              <input
                value={draft.location}
                maxLength={100}
                placeholder="e.g. Amber / left lane / rooftop camp"
                onChange={(e) => patch({ location: e.target.value })}
              />
              <small>
                One rule tracks one location. Create a separate rule for each
                camp.
              </small>
            </label>
            <label className="span-2">
              Timing source / patch note
              <input
                value={draft.source}
                maxLength={500}
                placeholder="Source URL, patch version, or your personal reminder note"
                onChange={(e) => patch({ source: e.target.value })}
              />
            </label>
          </div>
          <div className="callout">
            <ShieldCheck size={19} />
            <p>
              Game timings change. Confirm your timings against the current
              patch. Camp respawns are conditional; this app never repeats them
              on a fixed schedule.
            </p>
          </div>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={draft.confirmed}
              onChange={(e) =>
                patch({
                  confirmed: e.target.checked,
                  ...(!e.target.checked ? { enabled: false } : {}),
                })
              }
            />
            I have verified these timings, or this is my own personal reminder.
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={draft.enabled}
              disabled={!draft.confirmed}
              onChange={(e) => patch({ enabled: e.target.checked })}
            />
            Enable audio reminders for this event
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <footer className="dialog-actions">
            <button
              type="button"
              className="button secondary"
              onClick={onClose}
            >
              Cancel
            </button>
            <button className="button primary" disabled={busy}>
              <Save size={16} />
              {busy ? "Saving…" : "Save rule"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
