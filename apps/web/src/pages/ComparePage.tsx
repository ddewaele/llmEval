import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import type { ComparedItem } from "@llmeval/shared";
import { api } from "../lib/api.js";
import { Empty, ErrorText, Json, StatusBadge, fmtCost, fmtNum } from "../components/ui.js";

export function ComparePage() {
  const [params, setParams] = useSearchParams();
  const a = params.get("a") ?? "";
  const b = params.get("b") ?? "";
  const [onlyRegressions, setOnlyRegressions] = useState(false);
  const [scorerKey, setScorerKey] = useState("");
  const runA = useQuery({
    queryKey: ["run", a],
    queryFn: () => api.runs.get(a),
    enabled: Boolean(a),
  });
  const siblings = useQuery({
    queryKey: ["runs", runA.data?.datasetId],
    queryFn: () => api.runs.list({ datasetId: runA.data!.datasetId, limit: 50 }),
    enabled: Boolean(runA.data),
  });
  const cmp = useQuery({
    queryKey: ["compare", a, b, onlyRegressions, scorerKey],
    queryFn: () => api.runs.compare(a, b, onlyRegressions, scorerKey || undefined),
    enabled: Boolean(a && b),
  });
  const c = cmp.data;
  const keys = c ? c.aggregateDeltas.map((d) => d.key) : [];

  return (
    <div>
      <h1 className="mb-3 text-xl font-semibold">Compare runs</h1>
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-gray-600">A (baseline)</span>
        <RunPicker
          value={a}
          runs={siblings.data?.items ?? (runA.data ? [runA.data] : [])}
          onChange={(v) => setParams({ a: v, b })}
        />
        <span className="text-gray-600">B (candidate)</span>
        <RunPicker
          value={b}
          runs={siblings.data?.items ?? []}
          onChange={(v) => setParams({ a, b: v })}
        />
        <label className="ml-2 flex items-center gap-1">
          <input
            type="checkbox"
            checked={onlyRegressions}
            onChange={(e) => setOnlyRegressions(e.target.checked)}
          />{" "}
          only regressions
        </label>
        <select
          className="input w-auto"
          value={scorerKey}
          onChange={(e) => setScorerKey(e.target.value)}
        >
          <option value="">all scorers</option>
          {keys.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </div>
      <ErrorText error={cmp.error ?? runA.error} />
      {!a || !b ? (
        <Empty>Pick two runs of the same dataset. Tip: open a run and use “Compare with…”.</Empty>
      ) : null}
      {c && (
        <>
          <div className="mb-4 grid grid-cols-5 gap-3">
            <Stat label="compared" value={String(c.summary.compared)} />
            <Stat
              label="regressions"
              value={String(c.summary.regressions)}
              tone={c.summary.regressions ? "bad" : "good"}
            />
            <Stat
              label="improvements"
              value={String(c.summary.improvements)}
              tone={c.summary.improvements ? "good" : undefined}
            />
            <Stat
              label="latency Δ (mean)"
              value={
                c.latencyDeltaMs === null
                  ? "–"
                  : `${c.latencyDeltaMs > 0 ? "+" : ""}${c.latencyDeltaMs} ms`
              }
            />
            <Stat
              label="cost Δ"
              value={
                c.costDeltaUsd === null
                  ? "–"
                  : `${c.costDeltaUsd > 0 ? "+" : ""}${fmtCost(c.costDeltaUsd)}`
              }
            />
          </div>
          <div className="mb-4 grid grid-cols-2 gap-3">
            {[c.a, c.b].map((r, i) => (
              <div key={r.id} className="card text-sm">
                <p className="mb-1 text-xs font-semibold text-gray-500 uppercase">
                  {i === 0 ? "A · baseline" : "B · candidate"}
                </p>
                <p>
                  <Link
                    to={`/runs/${r.id}`}
                    className="font-medium text-indigo-700 hover:underline"
                  >
                    {r.name ?? r.id.slice(-8)}
                  </Link>{" "}
                  <StatusBadge status={r.status} /> · <span className="mono">{r.config.model}</span>{" "}
                  · v{r.versionNumber} · {fmtCost(r.costUsd)}
                </p>
                <p className="mono mt-1 truncate text-gray-600" title={r.config.systemPrompt ?? ""}>
                  system: {r.config.systemPrompt ?? "–"}
                </p>
                <p className="mono truncate text-gray-600" title={r.config.userTemplate ?? ""}>
                  template: {r.config.userTemplate ?? "–"}
                </p>
              </div>
            ))}
          </div>
          {!c.sameVersion && (
            <p className="mb-2 text-xs text-amber-700">
              Runs used different dataset versions; items missing on one side are counted in “only
              in A/B” ({c.summary.onlyInA}/{c.summary.onlyInB}).
            </p>
          )}
          <div className="card mb-4 p-0">
            <table className="table">
              <thead>
                <tr>
                  <th>Scorer</th>
                  <th>Mean A</th>
                  <th>Mean B</th>
                  <th>Δ mean</th>
                  <th>Pass A</th>
                  <th>Pass B</th>
                  <th>Δ pass</th>
                </tr>
              </thead>
              <tbody>
                {c.aggregateDeltas.map((d) => (
                  <tr key={d.key}>
                    <td className="font-medium">{d.key}</td>
                    <td>{fmtNum(d.meanScoreA, 3)}</td>
                    <td>{fmtNum(d.meanScoreB, 3)}</td>
                    <td className={delta(d.meanScoreDelta)}>{signed(d.meanScoreDelta)}</td>
                    <td>{pct(d.passRateA)}</td>
                    <td>{pct(d.passRateB)}</td>
                    <td className={delta(d.passRateDelta)}>{pct(d.passRateDelta, true)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="card p-0">
            <table className="table">
              <thead>
                <tr>
                  <th className="w-10">#</th>
                  <th>Input</th>
                  <th>Expected</th>
                  <th>A output</th>
                  <th>B output</th>
                  <th>Δ scores</th>
                </tr>
              </thead>
              <tbody>
                {c.items.map((it) => (
                  <ItemRow key={it.itemId} it={it} />
                ))}
              </tbody>
            </table>
            {c.items.length === 0 && <Empty>No items to show.</Empty>}
            {c.truncated && (
              <p className="p-3 text-center text-xs text-gray-500">
                Showing the first {c.items.length} items.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function ItemRow({ it }: { it: ComparedItem }) {
  const tone = it.regression ? "bg-red-50" : it.improvement ? "bg-green-50" : "";
  return (
    <tr className={tone}>
      <td className="text-xs text-gray-500">{it.position}</td>
      <td className="max-w-xs">
        <Json value={it.input} max={160} />
      </td>
      <td className="max-w-xs">
        <Json value={it.expected} max={160} />
      </td>
      <td className="max-w-sm">
        {it.a ? (
          it.a.error ? (
            <span className="text-xs text-red-700">{it.a.error}</span>
          ) : (
            <Json value={it.a.output} max={200} />
          )
        ) : (
          <span className="text-xs text-gray-400">not in A</span>
        )}
      </td>
      <td className="max-w-sm">
        {it.b ? (
          it.b.error ? (
            <span className="text-xs text-red-700">{it.b.error}</span>
          ) : (
            <Json value={it.b.output} max={200} />
          )
        ) : (
          <span className="text-xs text-gray-400">not in B</span>
        )}
      </td>
      <td className="whitespace-nowrap text-xs">
        {Object.entries(it.deltas).map(([k, v]) => (
          <div key={k} className={delta(v)}>
            {k}: {fmtNum(it.a?.scores[k] ?? null, 2)} → {fmtNum(it.b?.scores[k] ?? null, 2)} (
            {signed(v)})
          </div>
        ))}
      </td>
    </tr>
  );
}

function RunPicker({
  value,
  runs,
  onChange,
}: {
  value: string;
  runs: Array<{
    id: string;
    name: string | null;
    config: { model: string };
    versionNumber: number;
  }>;
  onChange: (v: string) => void;
}) {
  return (
    <select className="input w-auto" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">select run…</option>
      {runs.map((r) => (
        <option key={r.id} value={r.id}>
          {r.name ?? r.id.slice(-8)} · {r.config.model} · v{r.versionNumber}
        </option>
      ))}
    </select>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" }) {
  return (
    <div className="card">
      <p className="text-xs text-gray-500">{label}</p>
      <p
        className={`text-2xl font-semibold ${tone === "bad" ? "text-red-700" : tone === "good" ? "text-green-700" : ""}`}
      >
        {value}
      </p>
    </div>
  );
}

const signed = (n: number | null) => (n === null ? "–" : `${n > 0 ? "+" : ""}${n.toFixed(3)}`);
const pct = (n: number | null, sign = false) =>
  n === null ? "–" : `${sign && n > 0 ? "+" : ""}${Math.round(n * 100)}%`;
const delta = (n: number | null) =>
  n === null || n === 0 ? "" : n < 0 ? "text-red-700 font-medium" : "text-green-700 font-medium";
