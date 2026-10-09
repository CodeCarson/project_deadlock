import { useEffect, useState } from "react";
import { bridge, isDesktop } from "../core/bridge";
import { recognisedClock } from "../core/clock-reader";
import {
  captureRegionSchema,
  errorMessage,
  type CaptureRegion,
  type Settings,
  type TimerSnapshot,
} from "../core/schema";
export function ClockCaptureSettings({
  settings,
  detection,
  busy,
  onSave,
  onError,
  onTimingChange,
}: {
  settings: Settings;
  detection?: TimerSnapshot["detection"];
  busy: boolean;
  onSave: (region: CaptureRegion, enabled: boolean) => Promise<void>;
  onError: (message: string) => void;
  onTimingChange: (sync: number, grace: number) => Promise<void>;
}) {
  const [displays, setDisplays] = useState<
    Awaited<ReturnType<typeof bridge.captureDisplays>>
  >([]);
  const [region, setRegion] = useState<CaptureRegion>(
    settings.captureRegion ?? { x: 0, y: 0, width: 200, height: 72 },
  );
  const [preview, setPreview] = useState<{
    image: string;
    processedImage?: string;
    text: string;
    confidence: number;
    region: string;
  }>();
  const [testing, setTesting] = useState(false);
  useEffect(() => {
    if (isDesktop)
      void bridge
        .captureDisplays()
        .then(setDisplays)
        .catch((error) => onError(errorMessage(error)));
  }, []);
  const valid = captureRegionSchema.safeParse(region).success;
  const verified =
    preview &&
    preview.region === JSON.stringify(region) &&
    recognisedClock(preview.text, preview.confidence) !== null;
  const testCrop = async () => {
    setTesting(true);
    try {
      setPreview({
        ...(await bridge.previewClock(captureRegionSchema.parse(region))),
        region: JSON.stringify(region),
      });
    } catch (error) {
      onError(errorMessage(error));
    } finally {
      setTesting(false);
    }
  };
  return (
    <section className="panel settings-panel automatic-panel">
      <h2>Automatic match tracking</h2>
      <p>
        Reads your configured clock crop locally to seed an independent timer.
        After a few initial checks, short two-reading sync bursts run sparingly.
        No recording or uploads. Sparse OCR reduces capture work; FPS impact
        still depends on your PC.
      </p>
      <p>
        Enter a practice match so the clock is visible. Select its display, then
        adjust X/Y and size until the test image contains only the clock.
        Coordinates are physical screen pixels. Move or resize the game, or
        change display scaling: test the crop again.
      </p>
      <div className="history-controls capture-controls">
        <label>
          Game display
          <select
            aria-label="Game display"
            disabled={!isDesktop || testing}
            defaultValue=""
            onChange={(e) => {
              const d = displays.find((d) => d.id === e.target.value);
              if (d)
                setRegion({
                  x: d.x + Math.round((d.width - 200) / 2),
                  y: d.y + 8,
                  width: 200,
                  height: 72,
                });
            }}
          >
            <option value="" disabled>
              Choose a display
            </option>
            {displays.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} ({d.width} × {d.height})
              </option>
            ))}
          </select>
        </label>
        {(["x", "y", "width", "height"] as const).map((key) => (
          <label key={key}>
            {key.toUpperCase()}
            <input
              type="number"
              aria-label={`Clock crop ${key}`}
              value={Number.isFinite(region[key]) ? region[key] : ""}
              onChange={(e) =>
                setRegion({
                  ...region,
                  [key]: e.target.value === "" ? NaN : Number(e.target.value),
                })
              }
            />
          </label>
        ))}
      </div>
      <div className="history-controls">
        <button
          className="button secondary small"
          disabled={!isDesktop || !valid || busy || testing}
          onClick={() => void testCrop()}
        >
          {testing ? "Reading crop…" : "Test clock crop"}
        </button>
        <button
          className="button secondary small"
          disabled={!isDesktop || busy || testing || !valid}
          onClick={() =>
            void onSave(region, false).catch((error) =>
              onError(errorMessage(error)),
            )
          }
        >
          Save clock area
        </button>
      </div>
      {preview && (
        <div className="clock-crop-preview">
          <p>Captured clock area</p>
          <img src={preview.image} alt="Selected clock crop" />
          {preview.processedImage && (
            <>
              <p>Image used for recognition</p>
              <img src={preview.processedImage} alt="Processed clock crop" />
            </>
          )}
          <p>
            Read: {preview.text || "No text"} · confidence{" "}
            {Math.round(preview.confidence)}%
            {!verified && " — not reliable yet; adjust the crop and test again"}
          </p>
        </div>
      )}
      <p>
        You can save the clock area even if recognition fails. Enabling starts
        the reader; reminders wait for reliable readings. Keep the crop tight
        around MM:SS, with a little space around the digits.
      </p>
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={settings.automaticTracking && !!settings.captureRegion}
          disabled={!isDesktop || busy || testing || !settings.captureRegion}
          onChange={(e) =>
            void onSave(settings.captureRegion!, e.target.checked).catch(
              (error) => onError(errorMessage(error)),
            )
          }
        />
        Enable automatic match tracking
      </label>
      <p className="detection-status">
        {detection?.message ??
          "Open the Windows desktop app to use clock capture"}
      </p>
      <button
        className="button secondary small"
        disabled={!isDesktop || !settings.automaticTracking}
        onClick={() =>
          void bridge
            .resumeAutomaticTracking()
            .catch((error) => onError(errorMessage(error)))
        }
      >
        Resume automatic tracking
      </button>
      <p>
        The local timer runs between readings. Two identical readings at least
        1.5 seconds apart pause it; advancing readings resume it. Briefly
        alt-tabbing or opening a menu keeps the timer running for the configured
        grace period. If the game pauses while hidden, that pause cannot be
        detected until the clock returns. A long loss pauses reminders. New
        near-zero clocks after a 15-second gap require confirmation before
        reset.
      </p>
      <div className="history-controls">
        <label>
          Sync interval (seconds)
          <select
            aria-label="Clock sync interval"
            value={settings.clockSyncSeconds}
            disabled={busy}
            onChange={(e) =>
              void onTimingChange(
                Number(e.target.value),
                settings.clockGraceSeconds,
              ).catch((error) => onError(errorMessage(error)))
            }
          >
            {[5, 10, 15, 30, 60].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label>
          Hidden-clock grace (seconds)
          <select
            aria-label="Hidden clock grace"
            value={settings.clockGraceSeconds}
            disabled={busy}
            onChange={(e) =>
              void onTimingChange(
                settings.clockSyncSeconds,
                Number(e.target.value),
              ).catch((error) => onError(errorMessage(error)))
            }
          >
            {[5, 30, 60, 90, 120, 180, 300].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p>
        Default: two checks per 15-second sync interval after initial
        confirmation, with up to 90 seconds since the last valid reading before
        pausing. Pause detection can take one sync interval plus confirmation.
        Stop or Pause manually when leaving a match.
      </p>
      <p>
        Manual Start/Pause/Stop/Reset/Sync takes control until you resume
        automatic tracking. Mark cleared/Undo still works. The reader cannot
        identify exact match-end events or distinguish practice and spectator
        clocks. Use it for your own match and stop/reset manually if needed.
      </p>
    </section>
  );
}
