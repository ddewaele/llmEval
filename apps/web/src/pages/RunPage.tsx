import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { api } from "../lib/api.js";
import { ErrorText, StatusBadge, fmtCost, fmtNum } from "../components/ui.js";

/** Minimal run summary; the full results table, live progress and compare view land in the next slice. */
export function RunPage() {
  const { id = "" } = useParams();
  const run = useQuery({
    queryKey: ["run", id],
    queryFn: () => api.runs.get(id),
    refetchInterval: 2000,
  });
  const r = run.data;
  if (run.error) return <ErrorText error={run.error} />;
  if (!r) return <p className="text-sm text-gray-500">Loading…</p>;
  return (
    <div>
      <p className="mb-2 text-xs">
        <Link to={`/datasets/${r.datasetId}/runs`} className="text-indigo-700 hover:underline">
          ← dataset runs
        </Link>
      </p>
      <h1 className="mb-1 text-xl font-semibold">
        {r.name ?? `Run ${r.id.slice(-8)}`} <StatusBadge status={r.status} />
      </h1>
      <p className="mb-4 text-sm text-gray-600">
        {r.config.model} · v{r.versionNumber} · {r.completedItems + r.failedItems}/{r.totalItems}{" "}
        items · {r.inputTokens}/{r.outputTokens} tokens · {fmtCost(r.costUsd)}
        {r.error && <span className="text-red-700"> · {r.error}</span>}
      </p>
      <div className="grid grid-cols-4 gap-3">
        {r.aggregates.scorers.map((s) => (
          <div key={s.key} className="card">
            <p className="text-xs text-gray-500">
              {s.key} <span className="text-gray-400">({s.type})</span>
            </p>
            <p className="text-2xl font-semibold">{fmtNum(s.meanScore, 2)}</p>
            <p className="text-xs text-gray-500">
              {s.passRate !== null && `${Math.round(s.passRate * 100)}% pass · `}
              {s.scoredCount} scored{s.errorCount > 0 && `, ${s.errorCount} errors`}
            </p>
          </div>
        ))}
        <div className="card">
          <p className="text-xs text-gray-500">latency p50 / p95</p>
          <p className="text-2xl font-semibold">
            {r.aggregates.latency.p50Ms ?? "–"}{" "}
            <span className="text-base text-gray-400">
              / {r.aggregates.latency.p95Ms ?? "–"} ms
            </span>
          </p>
        </div>
      </div>
    </div>
  );
}
