import { useRef, useState } from "react";
import { bridge } from "../core/bridge";
import { archiveSchema, type ApiResult, type Match } from "../core/api";
import type { Research } from "./ImprovementCenter";
export function HistoryCoverage({
  accountId,
  matches,
  result,
  research,
  onSave,
  onReload,
  onRebuild,
  loading,
}: {
  accountId: number;
  matches: Match[];
  result: ApiResult;
  research: Research;
  onSave: (r: Research) => Promise<void>;
  onReload: () => Promise<void>;
  onRebuild: () => Promise<void>;
  loading: boolean;
}) {
  const [total, setTotal] = useState(String(research.expectedTotal ?? "")),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [ids, setIds] = useState("");
  const file = useRef<HTMLInputElement>(null);
  const expected = research.expectedTotal,
    missing = expected ? Math.max(0, expected - matches.length) : null;
  const oldest = matches.length
    ? Math.min(...matches.map((m) => m.start_time))
    : null;
  const remaining = Math.max(
    0,
    (result.forceFetchedAt ?? 0) + 3600000 - Date.now(),
  );
  const exportArchive = () => {
    const url = URL.createObjectURL(
      new Blob(
        [
          JSON.stringify(
            {
              format: "deadlock-companion-history",
              version: 1,
              accountId,
              matches: matches.map((m) => ({ ...m, account_id: accountId })),
            },
            null,
            2,
          ),
        ],
        { type: "application/json" },
      ),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `deadlock-history-${accountId}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    setMessage("");
    try {
      await task();
    } catch (e) {
      setMessage(
        e instanceof Error ? e.message : "Could not update the archive.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="panel history-coverage">
      <div className="section-heading">
        <div>
          <span className="eyebrow">START WITH THE FULL PICTURE</span>
          <h2>Your match archive</h2>
        </div>
        <span
          className={`data-pill ${missing || result.historySource !== "steam" ? "stale" : ""}`}
        >
          {missing
            ? `${missing} games missing`
            : expected
              ? "Total reached"
              : "Coverage unverified"}
        </span>
      </div>
      <div className="archive-count">
        <strong>{matches.length}</strong>
        <span>
          {expected
            ? ` / ${expected} career games reported by you`
            : "games collected — enter your in-game total below"}
        </span>
      </div>
      {expected && (
        <strong>
          {matches.length} collected / {expected} self-reported career games
        </strong>
      )}
      {expected && (
        <progress
          aria-label="Collected career history"
          value={Math.min(matches.length, expected)}
          max={expected}
        />
      )}
      <p>
        {result.historySource === "steam"
          ? "Steam fetch received."
          : "Indexed history only — Steam access has not been confirmed."}{" "}
        {missing
          ? "Rank and team picks use this partial archive."
          : "Reaching your stated total does not verify every record."}
      </p>
      <div className="history-controls">
        <label>
          Career total shown in game
          <input
            aria-label="Self-reported career matches"
            value={total}
            type="number"
            min="1"
            max="100000"
            placeholder="e.g. 506"
            onChange={(e) => setTotal(e.target.value)}
          />
        </label>
        <button
          className="button secondary small"
          disabled={busy || loading}
          onClick={() =>
            void run(async () => {
              const value = total.trim() ? Number(total) : null;
              if (
                value !== null &&
                (!Number.isInteger(value) || value < 1 || value > 100000)
              )
                throw new Error("Enter a whole number from 1 to 100000.");
              await onSave({ ...research, expectedTotal: value });
              setMessage("Career total saved.");
            })
          }
        >
          Save career total
        </button>
      </div>
      <details open={result.historySource !== "steam" ? true : undefined}>
        <summary>
          History coverage & older games · {matches.length} collected
        </summary>
        <ol className="recovery-steps">
          <li>
            <strong>Connect a Steam bot.</strong> Open the provider website,
            sign in there and follow its current bot-friend instructions. Access
            may require a membership.
          </li>
          <li>
            <strong>Accept the bot friendship on Steam.</strong> Return here
            once it is active.
          </li>
          <li>
            <strong>Rebuild full history.</strong> The app merges the response
            into your archive. A Steam fetch and older dates show whether access
            worked.
          </li>
        </ol>
        <div className="history-controls">
          <a
            className="button secondary small"
            href="https://deadlock-api.com"
            target="_blank"
            rel="noreferrer"
          >
            Set up Steam history access
          </a>
          <button
            className="button primary small"
            disabled={busy || loading || remaining > 0}
            onClick={() =>
              void run(async () => {
                await onRebuild();
                setMessage(
                  "Rebuild checked. Review the count and Steam status above.",
                );
              })
            }
          >
            Rebuild full history
          </button>
        </div>
        {remaining > 0 && (
          <small>
            Next rebuild in about {Math.ceil(remaining / 60000)} minutes. Normal
            Refresh still checks recent games.
          </small>
        )}
        <p className="muted">
          The API has no history pagination. A rebuild needs bot access; missing
          records cannot be created by repeated Refresh.{" "}
          <a
            href="https://api.deadlock-api.com/docs"
            target="_blank"
            rel="noreferrer"
          >
            Provider documentation
          </a>
        </p>
      </details>
      <details>
        <summary>Recover known match IDs or move your archive</summary>
        <p>
          Paste up to 30 older match IDs from your in-game history. Only indexed
          matches containing your account can be recovered.
        </p>
        <div className="history-controls">
          <label>
            Older match IDs
            <input
              aria-label="Older match IDs"
              value={ids}
              placeholder="112140499, …"
              onChange={(e) => setIds(e.target.value)}
            />
          </label>
          <button
            className="button secondary small"
            disabled={busy || loading || !ids.trim()}
            onClick={() =>
              void run(async () => {
                const parts = ids.trim().split(/[\s,;]+/);
                if (
                  parts.length > 30 ||
                  parts.some(
                    (v) =>
                      !/^\d+$/.test(v) ||
                      !Number.isSafeInteger(Number(v)) ||
                      Number(v) < 1,
                  )
                )
                  throw new Error("Use up to 30 positive numeric match IDs.");
                const recovered = await bridge.recoverHistory(
                  accountId,
                  parts.map(Number),
                );
                await onReload();
                setMessage(
                  `${recovered.recovered} verified matches merged.${recovered.errors.length ? ` ${recovered.errors.length} unavailable: ${recovered.errors[0]}` : ""}`,
                );
              })
            }
          >
            Recover match IDs
          </button>
        </div>
        <div className="history-controls">
          <button className="button secondary small" onClick={exportArchive}>
            Export collected history
          </button>
          <button
            className="button secondary small"
            disabled={busy || loading}
            onClick={() => file.current?.click()}
          >
            Import history archive
          </button>
          <input
            ref={file}
            type="file"
            accept="application/json,.json"
            hidden
            aria-label="Import history archive file"
            onChange={(e) => {
              const selected = e.target.files?.[0];
              e.target.value = "";
              if (!selected) return;
              void run(async () => {
                if (selected.size > 10 * 1024 * 1024)
                  throw new Error("Archive exceeds the 10 MB limit.");
                const archive = archiveSchema.parse(
                  JSON.parse(await selected.text()),
                );
                await bridge.importHistory(accountId, archive);
                await onReload();
                setMessage("History archive merged and saved.");
              });
            }}
          />
        </div>
      </details>
      <small>
        Newest collected:{" "}
        {matches.length
          ? new Date(
              Math.max(...matches.map((m) => m.start_time)) * 1000,
            ).toLocaleString()
          : "unavailable"}{" "}
        · Oldest collected:{" "}
        {oldest === null
          ? "unavailable"
          : new Date(oldest * 1000).toLocaleDateString()}{" "}
        · {result.providerCount ?? "Unknown"} games in last response ·{" "}
        {result.retainedCount ?? 0} extra games retained locally. No Steam
        credentials are entered here.
      </small>
      {message && <p role="status">{message}</p>}
    </section>
  );
}
