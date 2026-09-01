import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { api } from "../lib/api.js";
import { Empty, ErrorText, StatusBadge, fmtCost, fmtDate, fmtNum } from "../components/ui.js";

export function RunsPage() {
  const runs = useQuery({
    queryKey: ["runs", "all"],
    queryFn: () => api.runs.list({ limit: 100 }),
    refetchInterval: 3000,
  });
  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold">Runs</h1>
      <div className="card p-0">
        <table className="table">
          <thead>
            <tr>
              <th>Run</th>
              <th>Status</th>
              <th>Dataset</th>
              <th>Model</th>
              <th>Progress</th>
              <th>Scores</th>
              <th>Cost</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {runs.data?.items.map((r) => (
              <tr key={r.id} className="hover:bg-gray-50">
                <td>
                  <Link
                    to={`/runs/${r.id}`}
                    className="font-medium text-indigo-700 hover:underline"
                  >
                    {r.name ?? r.id.slice(-8)}
                  </Link>
                </td>
                <td>
                  <StatusBadge status={r.status} />
                </td>
                <td>
                  <Link
                    to={`/datasets/${r.datasetId}`}
                    className="text-xs text-indigo-700 hover:underline"
                  >
                    {r.datasetId.slice(-8)} v{r.versionNumber}
                  </Link>
                </td>
                <td className="text-xs">{r.config.model}</td>
                <td className="text-xs">
                  {r.completedItems + r.failedItems}/{r.totalItems}
                </td>
                <td className="text-xs">
                  {r.aggregates.scorers.map((s) => (
                    <div key={s.key}>
                      {s.key}: {fmtNum(s.meanScore, 2)}
                    </div>
                  ))}
                </td>
                <td className="text-xs">{fmtCost(r.costUsd)}</td>
                <td className="text-xs text-gray-500">{fmtDate(r.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {runs.data?.items.length === 0 && <Empty>No runs yet.</Empty>}
        <ErrorText error={runs.error} />
      </div>
    </div>
  );
}
