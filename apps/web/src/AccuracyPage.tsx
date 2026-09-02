// Public, signed-out accuracy scorecard at /accuracy. Mounted outside the
// Clerk wrapper in main.tsx — anyone can view it, and it is deliberately
// indexable (title only, no noindex meta): this page is the public record of
// how the PolyTrade agent's directional calls grade out.
import { CircleAlert, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { AgentPredictionHitRate } from "@polytrade/contracts";

import { GatewayError } from "./api";
import { env } from "./env";
import { fetchPublicAgentScorecard } from "./public-api";

export default function AccuracyPage() {
  const [scorecard, setScorecard] = useState<AgentPredictionHitRate | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);

  // Indexable public page: name the tab, but never noindex it.
  useEffect(() => {
    document.title = "Prediction accuracy · PolyTrade";
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      setScorecard(await fetchPublicAgentScorecard(env.VITE_API_URL));
    } catch (error) {
      void error;
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <main className="paper-loading"><RefreshCw className="spin" /><span>Loading prediction accuracy…</span></main>
    );
  }

  if (failed || !scorecard) {
    return (
      <main className="detail-page accuracy-page">
        <section className="empty-page-card">
          <CircleAlert aria-hidden="true" />
          <h1>Accuracy scorecard could not be loaded</h1>
          <p>The gateway did not answer this request. It may be a temporary outage — try again in a moment.</p>
          <button className="button button-primary" type="button" onClick={() => void load()}><RefreshCw /> Try again</button>
        </section>
      </main>
    );
  }

  const { totals } = scorecard;

  return (
    <main className="detail-page accuracy-page">
      <header className="page-title">
        <div>
          <span className="eyebrow">PolyTrade agent</span>
          <h1>Prediction accuracy</h1>
          <p>Every directional call the chat agent makes about a live Polymarket market is recorded and graded once the market resolves. Virtual bookkeeping only — no wallet, no real funds.</p>
        </div>
      </header>

      <section className="data-section accuracy-summary" aria-label="Accuracy summary">
        <div className="summary-metrics">
          <SummaryStat label="Hit rate" value={totals.hitRatePct === null ? "—" : `${totals.hitRatePct}%`} />
          <SummaryStat label="Resolved calls" value={String(totals.graded)} />
          <SummaryStat label="Hits" value={String(totals.hits)} />
          <SummaryStat label="Pending" value={String(totals.pending)} />
          <SummaryStat label="Voided" value={String(totals.voided)} />
        </div>
        {totals.hitRatePct === null && totals.pending === 0 && (
          <p className="table-empty">No graded calls yet. The scorecard fills in as the agent's predictions resolve.</p>
        )}
      </section>

      {scorecard.byCategory.length > 0 && (
        <section className="data-section paper-table-section" aria-label="Accuracy by category">
          <header><h2>By category</h2><span className="count-pill">{scorecard.byCategory.length}</span></header>
          <div className="table-scroll"><table><thead><tr><th>Category</th><th>Resolved</th><th>Hits</th><th>Hit rate</th></tr></thead><tbody>
            {scorecard.byCategory.map((row) => (
              <tr key={row.category}>
                <th>{row.category}</th>
                <td>{row.graded}</td>
                <td>{row.hits}</td>
                <td>{row.hitRatePct === null ? "—" : `${row.hitRatePct}%`}</td>
              </tr>
            ))}
          </tbody></table></div>
        </section>
      )}

      {scorecard.recent.length > 0 && (
        <section className="data-section paper-table-section" aria-label="Recent graded predictions">
          <header><h2>Recent graded predictions</h2><span className="count-pill">{scorecard.recent.length}</span></header>
          <div className="table-scroll"><table><thead><tr><th>Market</th><th>Agent called</th><th>Resolved</th><th>Result</th></tr></thead><tbody>
            {scorecard.recent.map((row, index) => (
              <tr key={`${row.marketQuestion}-${row.madeAt}-${index}`}>
                <th>{row.marketQuestion}<small>{row.category ?? "Other"}</small></th>
                <td>{row.predictedOutcome}</td>
                <td>{row.gradedOutcome ?? "—"}</td>
                <td><span className={row.hit === true ? "accuracy-pill accuracy-hit" : "accuracy-pill accuracy-miss"}>{row.hit === true ? "Hit" : "Miss"}</span></td>
              </tr>
            ))}
          </tbody></table></div>
        </section>
      )}

      <p className="accuracy-disclaimer">
        Past accuracy does not predict future results. These are the outcomes of recorded calls on
        simulated bookkeeping — not investment advice, and not expected returns.
        Observed {formatDate(scorecard.observedAt)}.
      </p>
    </main>
  );
}

function SummaryStat(props: { label: string; value: string }) {
  return <span><strong>{props.value}</strong><small>{props.label}</small></span>;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}