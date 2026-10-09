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
}: {
  settings: Settings;
  detection?: TimerSnapshot["detection"];
  busy: boolean;
  onSave: (region: CaptureRegion, enabled: boolean) => Promise<void>;
  onError: (message: string) => void;
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
        Standalone, experimental clock reader for Windows. Reads a small screen
        crop locally, about once per second. No Overwolf, recording or uploads.
        Performance and live-game accuracy still need testing on your PC.
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
        During tracking, capture runs only while Deadlock is the foreground
        window and the chosen area is inside it. Unreadable or inconsistent
        readings pause reminders. Two consistent readings start or resume
        tracking; the clock never advances between readings. A stopped clock is
        treated as paused. A new clock near 00:00 after at least 15 seconds
        without a readable clock resets the previous session.
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
