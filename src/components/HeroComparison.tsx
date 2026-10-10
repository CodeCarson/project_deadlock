import { comparisonBars } from "../core/improvement-graphs";
import { DeadlockArt } from "./DeadlockArt";
type Row = {
  key: string;
  label: string;
  value: number;
  expected: number;
  source: string;
};
const n = (v: number) =>
  v.toLocaleString(undefined, { maximumFractionDigits: 1 });
export function HeroComparison({
  rows,
  focus,
}: {
  rows: Row[];
  focus?: string;
}) {
  if (!rows.length) return null;
  return (
    <section
      className="hero-comparison"
      aria-label="This game versus hero reference"
    >
      <div className="section-heading">
        <div>
          <h3>This game vs hero reference</h3>
          <p>Two bars per measure. Deaths: lower is better.</p>
        </div>
        <DeadlockArt name="spirit.svg" />
      </div>
      <div className="comparison-grid">
        {rows.map((row) => {
          const bar = comparisonBars(
            row.value,
            row.expected,
            row.key === "deaths",
          );
          return (
            <article
              className={`comparison-row ${row.key === focus ? "focus" : ""}`}
              key={row.key}
              data-direction={bar.direction}
            >
              <div className="comparison-title">
                <strong>{row.label}</strong>
                <small>
                  {row.key === focus
                    ? "Next-game focus"
                    : bar.direction === "better"
                      ? "Stronger result"
                      : bar.direction === "equal"
                        ? "At reference"
                        : "Needs review"}
                </small>
              </div>
              <div className="comparison-bar">
                <span>This game</span>
                <div>
                  <i style={{ width: `${bar.valueWidth}%` }} />
                </div>
                <b>{n(row.value)}</b>
              </div>
              <div className="comparison-bar reference">
                <span>Reference</span>
                <div>
                  <i style={{ width: `${bar.referenceWidth}%` }} />
                </div>
                <b>{n(row.expected)}</b>
              </div>
              <small className="comparison-source">
                {row.source.startsWith("your")
                  ? "Your previous games · duration adjusted"
                  : "Community median · same hero, mode and duration band"}
              </small>
            </article>
          );
        })}
      </div>
    </section>
  );
}
