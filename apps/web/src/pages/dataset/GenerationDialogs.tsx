import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { Job } from "@llmeval/shared";
import { api, defaultModelLabel } from "../../lib/api.js";
import { ErrorText, Field, Modal } from "../../components/ui.js";

export function GenerateDialog({
  datasetId,
  selected,
  initialInstructions = "",
  onClose,
  onSaved,
}: {
  datasetId: string;
  selected: string[];
  initialInstructions?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const models = useQuery({ queryKey: ["models"], queryFn: () => api.models() });
  const [instructions, setInstructions] = useState(initialInstructions);
  const [model, setModel] = useState("");
  const [schema, setSchema] = useState("");
  const [scope, setScope] = useState<"missing" | "selected">(
    selected.length ? "selected" : "missing",
  );
  const [overwrite, setOverwrite] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const job = useQuery({
    queryKey: ["job", jobId],
    queryFn: () => api.jobs.get(jobId!),
    enabled: jobId !== null,
    refetchInterval: (q) =>
      q.state.data && ["completed", "failed", "cancelled"].includes(q.state.data.status)
        ? false
        : 700,
  });
  const start = useMutation({
    mutationFn: () =>
      api.generation.groundTruths(datasetId, {
        instructions: instructions || undefined,
        model: model || undefined,
        outputSchema: schema.trim() ? (JSON.parse(schema) as Record<string, never>) : undefined,
        itemIds: scope === "selected" ? selected : undefined,
        overwrite: scope === "selected" && overwrite,
        concurrency: 4,
      }),
    onSuccess: (j: Job) => setJobId(j.id),
  });
  const finished = Boolean(
    job.data && ["completed", "failed", "cancelled"].includes(job.data.status),
  );
  useEffect(() => {
    if (finished) onSaved();
  }, [finished, onSaved]);
  const result = job.data?.result as
    | { generated: number; failed: number; skipped: number; errors: Array<{ message: string }> }
    | null
    | undefined;
  return (
    <Modal title="Generate ground truths" onClose={onClose}>
      <p className="mb-3 text-xs text-gray-500">
        A model drafts the expected answer per item. Results are marked{" "}
        <em>generated / unreviewed</em>; approve or edit them before publishing.
      </p>
      <div className="space-y-2">
        <Field label="Scope">
          <select
            className="input"
            value={scope}
            onChange={(e) => setScope(e.target.value as typeof scope)}
          >
            <option value="missing">All draft items without a ground truth</option>
            <option value="selected" disabled={selected.length === 0}>
              Selected items ({selected.length})
            </option>
          </select>
        </Field>
        {scope === "selected" && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={overwrite}
              onChange={(e) => setOverwrite(e.target.checked)}
            />{" "}
            overwrite existing ground truths
          </label>
        )}
        <Field label="Instructions" hint="Describe the task and what a correct answer looks like.">
          <textarea
            className="input"
            rows={4}
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
          />
        </Field>
        <Field label="Model">
          <select className="input" value={model} onChange={(e) => setModel(e.target.value)}>
            <option value="">
              {defaultModelLabel(models.data?.defaults.generation, "GENERATION_MODEL")}
            </option>
            {models.data?.models
              .filter((m) => m.available)
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.id}
                </option>
              ))}
          </select>
        </Field>
        <Field label="Expected JSON schema (optional)" hint="Leave empty for free-text answers.">
          <textarea
            className="input mono"
            rows={3}
            value={schema}
            onChange={(e) => setSchema(e.target.value)}
          />
        </Field>
        <ErrorText error={start.error} />
        {job.data && (
          <p className="text-sm">
            Job <span className="badge bg-gray-100 text-gray-700">{job.data.status}</span>{" "}
            {JSON.stringify(job.data.progress)}
            {result && (
              <>
                {" "}
                · {result.generated} generated, {result.failed} failed, {result.skipped} skipped
              </>
            )}
            {job.data.error && <span className="text-red-700"> {job.data.error}</span>}
          </p>
        )}
        {result?.errors.slice(0, 3).map((e, i) => (
          <p key={i} className="text-xs text-red-700">
            {e.message}
          </p>
        ))}
        <div className="flex justify-end gap-2">
          <button className="btn" onClick={onClose}>
            {finished ? "Done" : "Cancel"}
          </button>
          <button
            className="btn btn-primary"
            disabled={start.isPending || jobId !== null}
            onClick={() => start.mutate()}
          >
            Generate
          </button>
        </div>
      </div>
    </Modal>
  );
}

export function SynthesizeDialog({
  datasetId,
  selected,
  initialDescription = "",
  onClose,
  onSaved,
}: {
  datasetId: string;
  selected: string[];
  initialDescription?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const models = useQuery({ queryKey: ["models"], queryFn: () => api.models() });
  const [description, setDescription] = useState(initialDescription);
  const [count, setCount] = useState("20");
  const [model, setModel] = useState("");
  const [withExpected, setWithExpected] = useState(true);
  const [tags, setTags] = useState("synthetic");
  const [jobId, setJobId] = useState<string | null>(null);
  const job = useQuery({
    queryKey: ["job", jobId],
    queryFn: () => api.jobs.get(jobId!),
    enabled: jobId !== null,
    refetchInterval: (q) =>
      q.state.data && ["completed", "failed", "cancelled"].includes(q.state.data.status)
        ? false
        : 700,
  });
  const start = useMutation({
    mutationFn: () =>
      api.generation.items(datasetId, {
        description,
        count: Number(count) || 20,
        model: model || undefined,
        withExpected,
        seedItemIds: selected.length ? selected : undefined,
        tags: tags
          ? tags
              .split(",")
              .map((t) => t.trim())
              .filter(Boolean)
          : undefined,
        batchSize: 10,
      }),
    onSuccess: (j: Job) => setJobId(j.id),
  });
  const finished = Boolean(
    job.data && ["completed", "failed", "cancelled"].includes(job.data.status),
  );
  useEffect(() => {
    if (finished) onSaved();
  }, [finished, onSaved]);
  const result = job.data?.result as
    | { generated: number; duplicatesDropped: number; rounds: number; errors: string[] }
    | null
    | undefined;
  return (
    <Modal title="Generate synthetic items" onClose={onClose}>
      <p className="mb-3 text-xs text-gray-500">
        Describe the task; a model writes new, diverse inputs (and ground truths) into the draft.
        Duplicates are skipped.
        {selected.length > 0 && ` The ${selected.length} selected item(s) are used as examples.`}
      </p>
      <div className="space-y-2">
        <Field label="Description of the task and desired inputs">
          <textarea
            className="input"
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            autoFocus
          />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Count">
            <input className="input" value={count} onChange={(e) => setCount(e.target.value)} />
          </Field>
          <Field label="Model">
            <select className="input" value={model} onChange={(e) => setModel(e.target.value)}>
              <option value="">
                {defaultModelLabel(models.data?.defaults.generation, "GENERATION_MODEL")}
              </option>
              {models.data?.models
                .filter((m) => m.available)
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.id}
                  </option>
                ))}
            </select>
          </Field>
        </div>
        <Field label="Tags">
          <input className="input" value={tags} onChange={(e) => setTags(e.target.value)} />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={withExpected}
            onChange={(e) => setWithExpected(e.target.checked)}
          />{" "}
          also draft ground truths (marked unreviewed)
        </label>
        <ErrorText error={start.error} />
        {job.data && (
          <p className="text-sm">
            Job <span className="badge bg-gray-100 text-gray-700">{job.data.status}</span>{" "}
            {JSON.stringify(job.data.progress)}
            {result &&
              ` · ${result.generated} generated, ${result.duplicatesDropped} duplicates dropped, ${result.rounds} rounds`}
            {job.data.error && <span className="text-red-700"> {job.data.error}</span>}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button className="btn" onClick={onClose}>
            {finished ? "Done" : "Cancel"}
          </button>
          <button
            className="btn btn-primary"
            disabled={start.isPending || jobId !== null || !description.trim()}
            onClick={() => start.mutate()}
          >
            Generate
          </button>
        </div>
      </div>
    </Modal>
  );
}
