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
  loading,
}: {
  accountId: number;
  matches: Match[];
  result: ApiResult;
  research: Research;
  onSave: (r: Research) => Promise<void>;
  onReload: () => Promise<void>;
  loading: boolean;
}) {
  const [total, setTotal] = useState(String(research.expectedTotal ?? "")),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const file = useRef<HTMLInputElement>(null);
  const oldest = matches.length
    ? Math.min(...matches.map((m) => m.start_time))
    : null;
  const exportArchive = () => {
    const archive = {
      format: "deadlock-companion-history",
      version: 1,
      accountId,
      matches: matches.map((m) => ({ ...m, account_id: accountId })),
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(archive, null, 2)], {
        type: "application/json",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `deadlock-history-${accountId}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <details className="panel history-coverage">
      <summary>
        History coverage & older games · {matches.length} collected
      </summary>
      <p>
        Oldest collected match:{" "}
        {oldest === null
          ? "unavailable"
          : new Date(oldest * 1000).toLocaleDateString()}
        .{" "}
        {result.providerCount !== undefined
          ? `Last provider response contained ${result.providerCount} unique matches; ${result.retainedCount ?? 0} additional matches are preserved locally.`
          : "Your collected history is preserved when future responses contain fewer games."}
      </p>
      {research.expectedTotal && (
        <p>
          <strong>
            {matches.length} collected / {research.expectedTotal} self-reported
            career games
          </strong>{" "}
          ·{" "}
          {matches.length <= research.expectedTotal
            ? `${Math.round((matches.length / research.expectedTotal) * 100)}% of that stated total. This is a coverage estimate, not verification of completeness.`
            : "The stated career total is now smaller than the archive; update it."}
        </p>
      )}
      <div className="history-controls">
        <label>
          Career total shown in game
          <input
            aria-label="Self-reported career matches"
            value={total}
            type="number"
            min="1"
            max="100000"
            placeholder="e.g. 500"
            onChange={(e) => setTotal(e.target.value)}
          />
        </label>
        <button
          className="button secondary small"
          disabled={busy || loading}
          onClick={() => {
            const value = total.trim() ? Number(total) : null;
            if (
              value !== null &&
              (!Number.isInteger(value) || value < 1 || value > 100000)
            ) {
              setMessage("Enter a whole number from 1 to 100000, or clear it.");
              return;
            }
            setBusy(true);
            void onSave({ ...research, expectedTotal: value })
              .catch((e) => setMessage(e.message))
              .finally(() => setBusy(false));
          }}
        >
          Save career total
        </button>
      </div>
      <h3>Request older Steam history</h3>
      <ol>
        <li>
          Open the{" "}
          <a
            href="https://api.deadlock-api.com/docs"
            target="_blank"
            rel="noreferrer"
          >
            provider's match-history documentation
          </a>{" "}
          and its{" "}
          <a href="https://deadlock-api.com" target="_blank" rel="noreferrer">
            account/access website
          </a>
          . Follow the current instructions for becoming friends with a provider
          Steam bot. Access or prioritisation may require a provider membership.
        </li>
        <li>
          Verify the bot friendship is active on Steam, then use{" "}
          <strong>Rebuild full history</strong> above. It requests a
          Steam-history rebuild and is limited to once per hour.
        </li>
        <li>
          Check whether the response reports a Steam fetch, its match count and
          the oldest date. If it still says indexed history without Steam, bot
          access has not reached this account. Repeating Refresh cannot restore
          unindexed records.
        </li>
      </ol>
      <p>
        Bot access is controlled by the provider. Its documentation describes
        combining Steam and indexed history for bot friends; the app cannot
        guarantee every historical game is still retrievable. No Steam
        credentials are entered here.
      </p>
      <h3>Keep a durable local archive</h3>
      <p>
        Refresh merges matches by ID, preserving earlier records and filling
        missing fields when better data arrives. Export a backup before changing
        computers. Import accepts the same versioned JSON format for this
        account; it merges rather than replacing history. A backup preserves
        collected records but cannot manufacture missing games.
      </p>
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
            setBusy(true);
            setMessage("");
            void (async () => {
              if (selected.size > 10 * 1024 * 1024)
                throw new Error("Archive exceeds the 10 MB limit.");
              const archive = archiveSchema.parse(
                JSON.parse(await selected.text()),
              );
              await bridge.importHistory(accountId, archive);
              await onReload();
              setMessage("History archive merged and saved.");
            })()
              .catch((error) =>
                setMessage(
                  error instanceof Error ? error.message : "Import failed.",
                ),
              )
              .finally(() => setBusy(false));
          }}
        />
      </div>
      {message && <p role="status">{message}</p>}
    </details>
  );
}
