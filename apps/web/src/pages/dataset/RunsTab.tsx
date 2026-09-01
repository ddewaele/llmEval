import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useOutletContext } from "react-router";
import type { DatasetSummary, ScorerSpec } from "@llmeval/shared";
import { api } from "../../lib/api.js";
import {
  Empty,
  ErrorText,
  Field,
  StatusBadge,
  fmtCost,
  fmtDate,
  fmtNum,
} from "../../components/ui.js";

const DEFAULT_SCORERS = JSON.stringify(
  [{ key: "exact", type: "exact_match", config: {} }],
  null,
  2,
);

export function RunsTab() {
  const d = useOutletContext<DatasetSummary>();
  const qc = useQueryClient();
  const runs = useQuery({
    queryKey: ["runs", d.id],
    queryFn: () => api.runs.list({ datasetId: d.id, limit: 50 }),
    refetchInterval: 3000,
  });
  const models = useQuery({ queryKey: ["models"], queryFn: api.models });
  const [model, setModel] = useState("");
  const [name, setName] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [userTemplate, setUserTemplate] = useState("");
  const [outputSchema, setOutputSchema] = useState("");
  const [scorers, setScorers] = useState(DEFAULT_SCORERS);
  const [concurrency, setConcurrency] = useState("4");
  const [maxCost, setMaxCost] = useState("");
  const start = useMutation({
    mutationFn: () =>
      api.runs.start({
        datasetId: d.id,
        name: name || undefined,
        model: model || undefined,
        systemPrompt: systemPrompt || undefined,
        userTemplate: userTemplate || undefined,
        outputSchema: outputSchema.trim()
          ? (JSON.parse(outputSchema) as Record<string, never>)
          : undefined,
        scorers: JSON.parse(scorers) as ScorerSpec[],
        concurrency: Number(concurrency) || undefined,
        maxCostUsd: maxCost ? Number(maxCost) : undefined,
        triggeredBy: "ui",
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["runs", d.id] }),
  });
  const available = models.data?.filter((m) => m.available) ?? [];

  return (
    <div className="grid grid-cols-3 gap-4">
      <div className="col-span-2 card p-0">
        <table className="table">
          <thead>
            <tr>
              <th>Run</th>
              <th>Status</th>
              <th>Version</th>
              <th>Model</th>
              <th>Progress</th>
              <th>Scores</th>
              <th>Cost</th>
              <th>Started</th>
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
                <td>v{r.versionNumber}</td>
                <td className="text-xs">{r.config.model}</td>
                <td className="text-xs">
                  {r.completedItems + r.failedItems}/{r.totalItems}
                  {r.failedItems > 0 && (
                    <span className="text-red-600"> ({r.failedItems} failed)</span>
                  )}
                </td>
                <td className="text-xs">
                  {r.aggregates.scorers.map((s) => (
                    <div key={s.key}>
                      {s.key}: {fmtNum(s.meanScore, 2)}{" "}
                      {s.passRate !== null && `(${Math.round(s.passRate * 100)}% pass)`}
                    </div>
                  ))}
                </td>
                <td className="text-xs">{fmtCost(r.costUsd)}</td>
                <td className="text-xs text-gray-500">{fmtDate(r.startedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {runs.data?.items.length === 0 && <Empty>No runs yet.</Empty>}
        <ErrorText error={runs.error} />
      </div>

      <div className="card self-start">
        <h3 className="mb-2 text-sm font-semibold">New run</h3>
        <div className="space-y-2">
          <Field label="Name">
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Model">
            <select className="input" value={model} onChange={(e) => setModel(e.target.value)}>
              <option value="">default (DEFAULT_MODEL)</option>
              {available.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.id}
                </option>
              ))}
            </select>
          </Field>
          <Field label="System prompt">
            <textarea
              className="input"
              rows={3}
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
            />
          </Field>
          <Field
            label="User template"
            hint="{{field}} over object inputs, {{input}} for string inputs; empty = input as-is"
          >
            <textarea
              className="input mono"
              rows={3}
              value={userTemplate}
              onChange={(e) => setUserTemplate(e.target.value)}
            />
          </Field>
          <Field label="Output JSON schema (optional)">
            <textarea
              className="input mono"
              rows={3}
              value={outputSchema}
              onChange={(e) => setOutputSchema(e.target.value)}
            />
          </Field>
          <Field
            label="Scorers (JSON)"
            hint="Types: exact_match, contains, regex, json_equal, numeric_tolerance, set_overlap, llm_judge"
          >
            <textarea
              className="input mono"
              rows={5}
              value={scorers}
              onChange={(e) => setScorers(e.target.value)}
            />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Concurrency">
              <input
                className="input"
                value={concurrency}
                onChange={(e) => setConcurrency(e.target.value)}
              />
            </Field>
            <Field label="Max cost (USD)">
              <input
                className="input"
                value={maxCost}
                onChange={(e) => setMaxCost(e.target.value)}
                placeholder="none"
              />
            </Field>
          </div>
          <button
            className="btn btn-primary w-full"
            disabled={start.isPending || d.draftItemCount === 0}
            onClick={() => start.mutate()}
          >
            Start run
          </button>
          <ErrorText error={start.error} />
        </div>
      </div>
    </div>
  );
}
