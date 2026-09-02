import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useOutletContext } from "react-router";
import type { DatasetSummary, ImportResult, Item, Job } from "@llmeval/shared";
import { api, defaultModelLabel } from "../../lib/api.js";
import { Empty, ErrorText, Field, Json, Modal, parseJsonOrText } from "../../components/ui.js";

type Filter = "all" | "missing_expected" | "unreviewed" | "reviewed";

export function ItemsTab() {
  const d = useOutletContext<DatasetSummary>();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [pages, setPages] = useState<string[]>([]); // cursors of loaded pages
  const [editing, setEditing] = useState<Item | null>(null);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [synthesizing, setSynthesizing] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const query = { filter, search: search || undefined, limit: 50 };
  const first = useQuery({
    queryKey: ["items", d.id, query],
    queryFn: () => api.items.list(d.id, query),
  });
  const more = useQuery({
    queryKey: ["items", d.id, query, pages],
    queryFn: async () => {
      const out: Item[] = [];
      let cursor: string | null = null;
      for (const c of pages) {
        const p = await api.items.list(d.id, { ...query, cursor: c });
        out.push(...p.items);
        cursor = p.nextCursor;
      }
      return { items: out, nextCursor: cursor };
    },
    enabled: pages.length > 0,
  });
  const items = [...(first.data?.items ?? []), ...(more.data?.items ?? [])];
  const nextCursor = pages.length ? more.data?.nextCursor : first.data?.nextCursor;

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["items", d.id] });
    void qc.invalidateQueries({ queryKey: ["dataset", d.id] });
  };
  const review = useMutation({
    mutationFn: (v: { ids: string[]; approve: boolean }) => api.items.review(v.ids, v.approve),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (ids: string[]) => api.items.delete(ids),
    onSuccess: () => {
      setSelected(new Set());
      invalidate();
    },
  });

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select
          className="input w-auto"
          value={filter}
          onChange={(e) => (setFilter(e.target.value as Filter), setPages([]))}
        >
          <option value="all">All items</option>
          <option value="missing_expected">Missing ground truth</option>
          <option value="unreviewed">Unreviewed ground truth</option>
          <option value="reviewed">Reviewed</option>
        </select>
        <input
          className="input w-64"
          placeholder="Search input…"
          value={search}
          onChange={(e) => (setSearch(e.target.value), setPages([]))}
        />
        <div className="ml-auto flex gap-2">
          {selected.size > 0 && (
            <>
              <button
                className="btn btn-sm"
                onClick={() => review.mutate({ ids: [...selected], approve: true })}
              >
                Approve {selected.size}
              </button>
              <button
                className="btn btn-sm btn-danger"
                onClick={() =>
                  confirm(`Delete ${selected.size} item(s) from the draft?`) &&
                  remove.mutate([...selected])
                }
              >
                Delete {selected.size}
              </button>
            </>
          )}
          <button className="btn btn-sm" onClick={() => setSynthesizing(true)}>
            Generate items
          </button>
          <button className="btn btn-sm" onClick={() => setGenerating(true)}>
            Generate ground truths
          </button>
          <button className="btn btn-sm" onClick={() => setImporting(true)}>
            Import
          </button>
          <button className="btn btn-sm btn-primary" onClick={() => setAdding(true)}>
            Add item
          </button>
        </div>
      </div>
      <div className="card p-0">
        <table className="table">
          <thead>
            <tr>
              <th className="w-8"></th>
              <th className="w-10">#</th>
              <th>Input</th>
              <th>Expected</th>
              <th>Ground truth</th>
              <th>Tags</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id} className="hover:bg-gray-50">
                <td>
                  <input
                    type="checkbox"
                    checked={selected.has(it.id)}
                    onChange={() => toggle(it.id)}
                  />
                </td>
                <td className="text-xs text-gray-500">{it.position}</td>
                <td className="max-w-md">
                  <Json value={it.input} max={300} />
                </td>
                <td className="max-w-sm">
                  {it.expected === null ? (
                    <span className="text-xs text-gray-400">none</span>
                  ) : (
                    <Json value={it.expected} max={200} />
                  )}
                </td>
                <td className="text-xs">
                  {it.expected !== null && (
                    <div className="space-y-1">
                      <span className="badge bg-gray-100 text-gray-700">{it.expectedSource}</span>
                      {it.expectedReviewedAt ? (
                        <span className="badge bg-green-100 text-green-700">reviewed</span>
                      ) : (
                        <button
                          className="btn btn-sm"
                          onClick={() => review.mutate({ ids: [it.id], approve: true })}
                        >
                          approve
                        </button>
                      )}
                      {it.expectedRationale && (
                        <div className="text-gray-500" title={it.expectedRationale}>
                          {it.expectedRationale.slice(0, 80)}
                        </div>
                      )}
                    </div>
                  )}
                </td>
                <td className="text-xs text-gray-600">
                  {(it.metadata.tags ?? []).join(", ")}
                  <div className="text-gray-400">{it.metadata.source}</div>
                </td>
                <td className="text-right whitespace-nowrap">
                  <button className="btn btn-sm" onClick={() => setEditing(it)}>
                    Edit
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {items.length === 0 && !first.isLoading && (
          <Empty>No items match. Add items manually or import a file.</Empty>
        )}
        {nextCursor && (
          <div className="p-3 text-center">
            <button className="btn btn-sm" onClick={() => setPages((p) => [...p, nextCursor])}>
              Load more
            </button>
          </div>
        )}
        <ErrorText error={first.error ?? review.error ?? remove.error} />
      </div>

      {editing && (
        <ItemEditor item={editing} onClose={() => setEditing(null)} onSaved={invalidate} />
      )}
      {adding && (
        <ItemAdder datasetId={d.id} onClose={() => setAdding(false)} onSaved={invalidate} />
      )}
      {importing && (
        <ImportDialog datasetId={d.id} onClose={() => setImporting(false)} onSaved={invalidate} />
      )}
      {synthesizing && (
        <SynthesizeDialog
          datasetId={d.id}
          selected={[...selected]}
          onClose={() => setSynthesizing(false)}
          onSaved={invalidate}
        />
      )}
      {generating && (
        <GenerateDialog
          datasetId={d.id}
          selected={[...selected]}
          onClose={() => setGenerating(false)}
          onSaved={invalidate}
        />
      )}
    </div>
  );
}

function ItemEditor({
  item,
  onClose,
  onSaved,
}: {
  item: Item;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [input, setInput] = useState(
    typeof item.input === "string" ? item.input : JSON.stringify(item.input, null, 2),
  );
  const [expected, setExpected] = useState(
    item.expected === null
      ? ""
      : typeof item.expected === "string"
        ? item.expected
        : JSON.stringify(item.expected, null, 2),
  );
  const [tags, setTags] = useState((item.metadata.tags ?? []).join(", "));
  const [notes, setNotes] = useState(item.metadata.notes ?? "");
  const save = useMutation({
    mutationFn: () =>
      api.items.update(item.id, {
        input: parseJsonOrText(input) as Item["input"],
        expected: expected.trim() === "" ? null : (parseJsonOrText(expected) as Item["expected"]),
        metadata: {
          tags: tags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
          ...(notes ? { notes } : {}),
        },
      }),
    onSuccess: () => {
      onSaved();
      onClose();
    },
  });
  return (
    <Modal title={`Edit item #${item.position}`} onClose={onClose} wide>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Input (text or JSON)">
          <textarea
            className="input mono"
            rows={10}
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
        </Field>
        <Field
          label="Expected (text or JSON; empty = none)"
          hint="Editing marks the ground truth as human-provided and reviewed."
        >
          <textarea
            className="input mono"
            rows={10}
            value={expected}
            onChange={(e) => setExpected(e.target.value)}
          />
        </Field>
        <Field label="Tags (comma separated)">
          <input className="input" value={tags} onChange={(e) => setTags(e.target.value)} />
        </Field>
        <Field label="Notes">
          <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>
      <ErrorText error={save.error} />
      <div className="mt-3 flex justify-end gap-2">
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button className="btn btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>
          Save
        </button>
      </div>
    </Modal>
  );
}

function ItemAdder({
  datasetId,
  onClose,
  onSaved,
}: {
  datasetId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [input, setInput] = useState("");
  const [expected, setExpected] = useState("");
  const [tags, setTags] = useState("");
  const add = useMutation({
    mutationFn: () =>
      api.items.add(datasetId, [
        {
          input: parseJsonOrText(input) as Item["input"],
          ...(expected.trim() ? { expected: parseJsonOrText(expected) as Item["expected"] } : {}),
          metadata: {
            source: "manual",
            tags: tags
              .split(",")
              .map((t) => t.trim())
              .filter(Boolean),
          },
        },
      ]),
    onSuccess: () => {
      onSaved();
      onClose();
    },
  });
  return (
    <Modal title="Add item" onClose={onClose} wide>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Input (text or JSON object / messages array)">
          <textarea
            className="input mono"
            rows={8}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            autoFocus
          />
        </Field>
        <Field label="Expected (optional)">
          <textarea
            className="input mono"
            rows={8}
            value={expected}
            onChange={(e) => setExpected(e.target.value)}
          />
        </Field>
        <Field label="Tags (comma separated)">
          <input className="input" value={tags} onChange={(e) => setTags(e.target.value)} />
        </Field>
      </div>
      <ErrorText error={add.error} />
      <div className="mt-3 flex justify-end gap-2">
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn btn-primary"
          disabled={add.isPending || !input.trim()}
          onClick={() => add.mutate()}
        >
          Add
        </button>
      </div>
    </Modal>
  );
}

function ImportDialog({
  datasetId,
  onClose,
  onSaved,
}: {
  datasetId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [format, setFormat] = useState<"json" | "jsonl" | "csv" | "xlsx">("csv");
  const [content, setContent] = useState<string>("");
  const [fileName, setFileName] = useState("");
  const [inputCols, setInputCols] = useState("");
  const [expectedCol, setExpectedCol] = useState("");
  const [split, setSplit] = useState("");
  const [sheet, setSheet] = useState("");
  const [tags, setTags] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);

  const body = (dryRun: boolean) => {
    const inputs = inputCols
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    return {
      format,
      content,
      dryRun,
      dedupe: true,
      sheet: sheet || undefined,
      tags: tags
        ? tags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean)
        : undefined,
      mapping:
        format === "csv" || format === "xlsx"
          ? {
              parseJson: true,
              ...(inputs.length ? { input: inputs.length === 1 ? inputs[0]! : inputs } : {}),
              ...(expectedCol ? { expected: expectedCol } : {}),
              ...(split ? { expectedSplit: split } : {}),
            }
          : undefined,
    };
  };
  const run = useMutation({
    mutationFn: (dryRun: boolean) => api.items.import(datasetId, body(dryRun)),
    onSuccess: (res, dryRun) => {
      setResult(res);
      if (!dryRun) onSaved();
    },
  });

  const onFile = (file: File) => {
    setFileName(file.name);
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (ext === "xlsx") setFormat("xlsx");
    else if (ext === "csv") setFormat("csv");
    else if (ext === "jsonl") setFormat("jsonl");
    else if (ext === "json") setFormat("json");
    const reader = new FileReader();
    if (ext === "xlsx") {
      reader.onload = () => setContent(String(reader.result).split(",")[1] ?? "");
      reader.readAsDataURL(file);
    } else {
      reader.onload = () => setContent(String(reader.result));
      reader.readAsText(file);
    }
  };

  return (
    <Modal title="Import items" onClose={onClose} wide>
      <div className="grid grid-cols-2 gap-3">
        <Field label="File (json, jsonl, csv, xlsx)">
          <input
            type="file"
            className="input"
            onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
          />
          {fileName && <p className="mt-1 text-xs text-gray-500">{fileName}</p>}
        </Field>
        <Field label="Format">
          <select
            className="input"
            value={format}
            onChange={(e) => setFormat(e.target.value as typeof format)}
          >
            <option value="csv">csv</option>
            <option value="xlsx">xlsx</option>
            <option value="json">json</option>
            <option value="jsonl">jsonl</option>
          </select>
        </Field>
        {(format === "csv" || format === "xlsx") && (
          <>
            <Field
              label="Input column(s)"
              hint="Comma separated; several columns become an input object. Empty = column named 'input' or all unused columns."
            >
              <input
                className="input"
                value={inputCols}
                onChange={(e) => setInputCols(e.target.value)}
                placeholder="subject, body"
              />
            </Field>
            <Field label="Expected column" hint="Empty = column named 'expected'.">
              <input
                className="input"
                value={expectedCol}
                onChange={(e) => setExpectedCol(e.target.value)}
                placeholder="codes"
              />
            </Field>
            <Field label="Split expected into a list on" hint="e.g. ',' for code lists">
              <input className="input" value={split} onChange={(e) => setSplit(e.target.value)} />
            </Field>
            {format === "xlsx" && (
              <Field label="Sheet name (default first)">
                <input className="input" value={sheet} onChange={(e) => setSheet(e.target.value)} />
              </Field>
            )}
          </>
        )}
        <Field label="Tags for all imported items">
          <input className="input" value={tags} onChange={(e) => setTags(e.target.value)} />
        </Field>
        {format !== "xlsx" && (
          <div className="col-span-2">
            <Field label="Or paste content">
              <textarea
                className="input mono"
                rows={5}
                value={content}
                onChange={(e) => setContent(e.target.value)}
              />
            </Field>
          </div>
        )}
      </div>
      <ErrorText error={run.error} />
      {result && (
        <div className="mt-3 rounded-md border border-gray-200 bg-gray-50 p-3 text-sm">
          <p>
            <strong>{result.dryRun ? "Preview" : "Imported"}:</strong> {result.totalRows} rows ·{" "}
            {result.added} {result.dryRun ? "would be added" : "added"} · {result.skippedDuplicates}{" "}
            duplicates skipped · {result.errors.length} errors
            {result.columns && <> · columns: {result.columns.join(", ")}</>}
          </p>
          {result.errors.slice(0, 5).map((e) => (
            <p key={e.row} className="text-red-700">
              row {e.row}: {e.message}
            </p>
          ))}
          {result.preview.slice(0, 3).map((p, i) => (
            <div key={i} className="mt-2 grid grid-cols-2 gap-2">
              <Json value={p.input} max={200} />
              <Json value={p.expected} max={200} />
            </div>
          ))}
        </div>
      )}
      <div className="mt-3 flex justify-end gap-2">
        <button className="btn" onClick={onClose}>
          Close
        </button>
        <button
          className="btn"
          disabled={!content || run.isPending}
          onClick={() => run.mutate(true)}
        >
          Preview (dry run)
        </button>
        <button
          className="btn btn-primary"
          disabled={!content || run.isPending}
          onClick={() => run.mutate(false)}
        >
          Import
        </button>
      </div>
    </Modal>
  );
}

function GenerateDialog({
  datasetId,
  selected,
  onClose,
  onSaved,
}: {
  datasetId: string;
  selected: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const models = useQuery({ queryKey: ["models"], queryFn: () => api.models() });
  const [instructions, setInstructions] = useState("");
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

function SynthesizeDialog({
  datasetId,
  selected,
  onClose,
  onSaved,
}: {
  datasetId: string;
  selected: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const models = useQuery({ queryKey: ["models"], queryFn: () => api.models() });
  const [description, setDescription] = useState("");
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
