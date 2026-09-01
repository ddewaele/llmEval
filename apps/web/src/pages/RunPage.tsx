import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import type { Run, RunItem, Score } from "@llmeval/shared";
import { api } from "../lib/api.js";
import { useRunEvents } from "../lib/useRunEvents.js";
import {
  Empty,
  ErrorText,
  Field,
  Json,
  Modal,
  StatusBadge,
  fmtCost,
  fmtDate,
  fmtNum,
} from "../components/ui.js";

const ACTIVE = new Set(["pending", "running"]);

export function RunPage() {
  const { id = "" } = useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const run = useQuery({ queryKey: ["run", id], queryFn: () => api.runs.get(id) });
  const r = run.data;
  const progress = useRunEvents(id, r?.status);
  const [status, setStatus] = useState("");
  const [scorerKey, setScorerKey] = useState("");
  const [pages, setPages] = useState<string[]>([]);
  const [selected, setSelected] = useState<RunItem | null>(null);
  const [rescoring, setRescoring] = useState(false);
  const [compareWith, setCompareWith] = useState("");

  const params = { status: status || undefined, scorerKey: scorerKey || undefined, limit: 50 };
  const first = useQuery({
    queryKey: ["run-items", id, params],
    queryFn: () => api.runs.items(id, params),
  });
  const more = useQuery({
    queryKey: ["run-items", id, params, pages],
    queryFn: async () => {
      const out: RunItem[] = [];
      let cursor: string | null = null;
      for (const c of pages) {
        const p = await api.runs.items(id, { ...params, cursor: c });
        out.push(...p.items);
        cursor = p.nextCursor;
      }
      return { items: out, nextCursor: cursor };
    },
    enabled: pages.length > 0,
  });
  const items = [...(first.data?.items ?? []), ...(more.data?.items ?? [])];
  const nextCursor = pages.length ? more.data?.nextCursor : first.data?.nextCursor;
  const siblings = useQuery({
    queryKey: ["runs", r?.datasetId],
    queryFn: () => api.runs.list({ datasetId: r!.datasetId, limit: 50 }),
    enabled: Boolean(r),
  });
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["run", id] });
    void qc.invalidateQueries({ queryKey: ["run-items", id] });
  };
  const cancel = useMutation({ mutationFn: () => api.runs.cancel(id), onSuccess: invalidate });
  const resume = useMutation({ mutationFn: () => api.runs.resume(id), onSuccess: invalidate });

  if (run.error) return <ErrorText error={run.error} />;
  if (!r) return <p className="text-sm text-gray-500">Loading…</p>;
  const done = progress ? progress.completed + progress.failed : r.completedItems + r.failedItems;
  const total = progress?.total ?? r.totalItems;
  const scorerKeys = r.scorers.map((s) => s.key);

  return (
    <div>
      <p className="mb-2 text-xs">
        <Link to={`/datasets/${r.datasetId}/runs`} className="text-indigo-700 hover:underline">
          ← dataset runs
        </Link>
      </p>
      <div className="mb-3 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold">
            {r.name ?? `Run ${r.id.slice(-8)}`} <StatusBadge status={r.status} />
          </h1>
          <p className="text-sm text-gray-600">
            <span className="mono">{r.config.model}</span> · v{r.versionNumber} · {r.inputTokens} in
            / {r.outputTokens} out tokens · {fmtCost(r.costUsd)} · started {fmtDate(r.startedAt)} ·
            by {r.triggeredBy}
          </p>
          {r.error && <p className="text-sm text-red-700">{r.error}</p>}
        </div>
        <div className="flex items-center gap-2">
          <select
            className="input w-auto"
            value={compareWith}
            onChange={(e) => setCompareWith(e.target.value)}
          >
            <option value="">Compare with…</option>
            {siblings.data?.items
              .filter((s) => s.id !== r.id)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name ?? s.id.slice(-8)} · {s.config.model} · v{s.versionNumber}
                </option>
              ))}
          </select>
          <button
            className="btn btn-sm"
            disabled={!compareWith}
            onClick={() => void navigate(`/compare?a=${r.id}&b=${compareWith}`)}
          >
            Compare
          </button>
          <button
            className="btn btn-sm"
            onClick={() => setRescoring(true)}
            disabled={ACTIVE.has(r.status)}
          >
            Add scorer
          </button>
          {ACTIVE.has(r.status) ? (
            <button
              className="btn btn-sm btn-danger"
              onClick={() => cancel.mutate()}
              disabled={cancel.isPending}
            >
              Cancel
            </button>
          ) : (
            r.status !== "completed" && (
              <button
                className="btn btn-sm"
                onClick={() => resume.mutate()}
                disabled={resume.isPending}
              >
                Resume
              </button>
            )
          )}
        </div>
      </div>
      <ErrorText error={cancel.error ?? resume.error} />

      <div className="mb-4">
        <div className="mb-1 flex justify-between text-xs text-gray-600">
          <span>
            {done}/{total} items
            {r.failedItems > 0 && <span className="text-red-600"> · {r.failedItems} failed</span>}
          </span>
          <span>
            latency p50 {r.aggregates.latency.p50Ms ?? "–"} ms · p95{" "}
            {r.aggregates.latency.p95Ms ?? "–"} ms
          </span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded bg-gray-200">
          <div
            className={`h-2 ${ACTIVE.has(r.status) ? "bg-blue-500" : "bg-green-500"}`}
            style={{ width: `${total ? (done / total) * 100 : 0}%` }}
          />
        </div>
      </div>

      <div className="mb-4 grid grid-cols-4 gap-3">
        {r.aggregates.scorers.map((s) => (
          <div key={s.key} className="card">
            <p className="text-xs text-gray-500">
              {s.key} <span className="text-gray-400">({s.type})</span>
            </p>
            <p className="text-2xl font-semibold">{fmtNum(s.meanScore, 2)}</p>
            <p className="text-xs text-gray-500">
              {s.passRate !== null && `${Math.round(s.passRate * 100)}% pass · `}
              {s.scoredCount} scored
              {s.errorCount > 0 && <span className="text-red-600">, {s.errorCount} errors</span>}
            </p>
          </div>
        ))}
        <div className="card">
          <p className="text-xs text-gray-500">config</p>
          <p className="mono truncate" title={r.config.systemPrompt ?? ""}>
            system: {r.config.systemPrompt ? r.config.systemPrompt.slice(0, 60) : "–"}
          </p>
          <p className="mono truncate" title={r.config.userTemplate ?? ""}>
            template: {r.config.userTemplate ? r.config.userTemplate.slice(0, 60) : "–"}
          </p>
          <p className="mono">structured: {r.config.outputSchema ? "yes" : "no"}</p>
        </div>
      </div>

      <div className="mb-2 flex items-center gap-2">
        <select
          className="input w-auto"
          value={status}
          onChange={(e) => (setStatus(e.target.value), setPages([]))}
        >
          <option value="">All statuses</option>
          {["completed", "failed", "pending", "running", "cancelled"].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          className="input w-auto"
          value={scorerKey}
          onChange={(e) => (setScorerKey(e.target.value), setPages([]))}
        >
          <option value="">All items</option>
          {scorerKeys.map((k) => (
            <option key={k} value={k}>
              failed “{k}”
            </option>
          ))}
        </select>
        <span className="text-xs text-gray-500">{items.length} shown</span>
      </div>

      <div className="card p-0">
        <table className="table">
          <thead>
            <tr>
              <th className="w-10">#</th>
              <th>Input</th>
              <th>Expected</th>
              <th>Output</th>
              <th>Scores</th>
              <th>Latency</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr
                key={it.id}
                className="cursor-pointer hover:bg-gray-50"
                onClick={() => setSelected(it)}
              >
                <td className="text-xs text-gray-500">{it.position}</td>
                <td className="max-w-xs">
                  <Json value={it.input} max={160} />
                </td>
                <td className="max-w-xs">
                  {it.expected === null ? (
                    <span className="text-xs text-gray-400">none</span>
                  ) : (
                    <Json value={it.expected} max={160} />
                  )}
                </td>
                <td className="max-w-sm">
                  {it.error ? (
                    <span className="text-xs text-red-700">{it.error}</span>
                  ) : (
                    <Json value={it.output} max={200} />
                  )}
                </td>
                <td className="whitespace-nowrap text-xs">
                  {it.scores.map((s) => (
                    <ScorePill key={s.id} score={s} />
                  ))}
                </td>
                <td className="text-xs text-gray-600">
                  {it.latencyMs === null ? "–" : `${it.latencyMs} ms`}
                </td>
                <td>
                  <StatusBadge status={it.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {items.length === 0 && !first.isLoading && <Empty>No items match.</Empty>}
        {nextCursor && (
          <div className="p-3 text-center">
            <button className="btn btn-sm" onClick={() => setPages((p) => [...p, nextCursor])}>
              Load more
            </button>
          </div>
        )}
        <ErrorText error={first.error} />
      </div>

      {selected && <RunItemDrawer item={selected} onClose={() => setSelected(null)} />}
      {rescoring && (
        <RescoreDialog run={r} onClose={() => setRescoring(false)} onDone={invalidate} />
      )}
    </div>
  );
}

export function ScorePill({ score }: { score: Score }) {
  const color =
    score.error !== null
      ? "bg-red-100 text-red-700"
      : score.passed === true
        ? "bg-green-100 text-green-700"
        : score.passed === false
          ? "bg-amber-100 text-amber-700"
          : "bg-gray-100 text-gray-700";
  return (
    <span className={`badge mr-1 mb-1 ${color}`} title={score.error ?? score.rationale ?? ""}>
      {score.scorerKey}: {score.error ? "err" : fmtNum(score.score, 2)}
    </span>
  );
}

function RunItemDrawer({ item, onClose }: { item: RunItem; onClose: () => void }) {
  const full = useQuery({ queryKey: ["run-item", item.id], queryFn: () => api.runs.item(item.id) });
  const it = full.data ?? item;
  return (
    <Modal
      title={`Item #${it.position} · ${it.status}${it.attempt > 1 ? ` · ${it.attempt} attempts` : ""}`}
      onClose={onClose}
      wide
    >
      <div className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <h4 className="mb-1 font-medium">Messages sent</h4>
          {it.renderedMessages?.map((m, i) => (
            <div key={i} className="mb-2 rounded border border-gray-200 bg-gray-50 p-2">
              <p className="mb-1 text-xs font-semibold text-gray-500 uppercase">{m.role}</p>
              <Json value={m.content} max={2000} />
            </div>
          )) ?? <p className="text-gray-500">not rendered yet</p>}
        </div>
        <div className="space-y-3">
          <div>
            <h4 className="mb-1 font-medium">Expected</h4>
            <Json value={it.expected} max={2000} />
          </div>
          <div>
            <h4 className="mb-1 font-medium">Output</h4>
            {it.error ? (
              <p className="text-red-700">{it.error}</p>
            ) : (
              <Json value={it.output} max={4000} />
            )}
          </div>
          <div>
            <h4 className="mb-1 font-medium">Scores</h4>
            {it.scores.length === 0 && <p className="text-xs text-gray-500">none</p>}
            {it.scores.map((s) => (
              <div key={s.id} className="mb-2 rounded border border-gray-200 p-2">
                <div className="flex items-center gap-2">
                  <ScorePill score={s} />
                  <span className="text-xs text-gray-500">{s.scorerType}</span>
                  {s.judgeModel && (
                    <span className="text-xs text-gray-500">
                      · {s.judgeModel} · {s.judgeTokens} tok · {fmtCost(s.judgeCostUsd)}
                    </span>
                  )}
                </div>
                {s.rationale && <p className="mt-1 text-xs text-gray-700">{s.rationale}</p>}
                {s.error && <p className="mt-1 text-xs text-red-700">{s.error}</p>}
                {s.details !== null && <Json value={s.details} max={600} />}
              </div>
            ))}
          </div>
          <div>
            <h4 className="mb-1 font-medium">Provider metadata</h4>
            <Json value={it.rawResponse} max={1000} />
            <p className="mt-1 text-xs text-gray-500">
              {it.inputTokens ?? "–"} in / {it.outputTokens ?? "–"} out tokens ·{" "}
              {fmtCost(it.costUsd)} · {it.latencyMs ?? "–"} ms
            </p>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function RescoreDialog({
  run,
  onClose,
  onDone,
}: {
  run: Run;
  onClose: () => void;
  onDone: () => void;
}) {
  const scorers = useQuery({ queryKey: ["scorers"], queryFn: api.scorers });
  const [type, setType] = useState("exact_match");
  const [key, setKey] = useState("exact");
  const [config, setConfig] = useState("{}");
  const [overwrite, setOverwrite] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const job = useQuery({
    queryKey: ["job", jobId],
    queryFn: () => api.jobs.get(jobId!),
    enabled: jobId !== null,
    refetchInterval: (q) =>
      q.state.data && ["completed", "failed", "cancelled"].includes(q.state.data.status)
        ? false
        : 500,
  });
  const start = useMutation({
    mutationFn: () =>
      api.runs.rescore(
        run.id,
        { key, type, config: JSON.parse(config) as Record<string, unknown> },
        overwrite,
      ),
    onSuccess: (j) => setJobId(j.id),
  });
  const finished = Boolean(
    job.data && ["completed", "failed", "cancelled"].includes(job.data.status),
  );
  useEffect(() => {
    if (finished) onDone();
  }, [finished, onDone]);
  const selected = scorers.data?.find((s) => s.type === type);
  return (
    <Modal title="Add scorer to this run" onClose={onClose}>
      <p className="mb-3 text-xs text-gray-500">
        Scores the run's completed items with a new scorer; the model is not called again (except by
        llm_judge).
      </p>
      <div className="space-y-2">
        <Field label="Scorer type">
          <select
            className="input"
            value={type}
            onChange={(e) => {
              setType(e.target.value);
              setKey(e.target.value.replace(/_.*/, ""));
            }}
          >
            {scorers.data?.map((s) => (
              <option key={s.type} value={s.type}>
                {s.type}
              </option>
            ))}
          </select>
          {selected && <p className="mt-1 text-xs text-gray-500">{selected.description}</p>}
        </Field>
        <Field
          label="Key"
          hint={`Existing keys: ${run.scorers.map((s) => s.key).join(", ") || "none"}`}
        >
          <input className="input" value={key} onChange={(e) => setKey(e.target.value)} />
        </Field>
        <Field
          label="Config (JSON)"
          hint={
            selected
              ? `Fields: ${Object.keys((selected.configSchema.properties as object) ?? {}).join(", ")}`
              : undefined
          }
        >
          <textarea
            className="input mono"
            rows={4}
            value={config}
            onChange={(e) => setConfig(e.target.value)}
          />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={overwrite}
            onChange={(e) => setOverwrite(e.target.checked)}
          />{" "}
          overwrite existing scorer with this key
        </label>
        <ErrorText error={start.error} />
        {job.data && (
          <p className="text-sm">
            Job <StatusBadge status={job.data.status} /> {JSON.stringify(job.data.progress)}{" "}
            {job.data.error && <span className="text-red-700">{job.data.error}</span>}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button className="btn" onClick={onClose}>
            {finished ? "Done" : "Cancel"}
          </button>
          <button
            className="btn btn-primary"
            disabled={start.isPending || jobId !== null}
            onClick={() => start.mutate()}
          >
            Score
          </button>
        </div>
      </div>
    </Modal>
  );
}
