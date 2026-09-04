import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useOutletContext } from "react-router";
import type { DatasetSummary, ScorerSpec } from "@llmeval/shared";
import { api, defaultModelLabel } from "../../lib/api.js";
import {
  Empty,
  ErrorText,
  HelpField,
  StatusBadge,
  fmtCost,
  fmtDate,
  fmtNum,
  inferSchema,
} from "../../components/ui.js";

const DEFAULT_SCORERS = JSON.stringify(
  [{ key: "exact", type: "exact_match", config: {} }],
  null,
  2,
);

const SCORER_PRESETS: Array<{
  type: string;
  label: string;
  config: (ctx: { listField: string | null }) => Record<string, unknown>;
}> = [
  { type: "exact_match", label: "exact_match", config: () => ({ caseInsensitive: true }) },
  { type: "contains", label: "contains", config: () => ({ caseInsensitive: true }) },
  { type: "json_equal", label: "json_equal", config: () => ({}) },
  {
    type: "set_overlap",
    label: "set_overlap",
    config: (c) => ({ path: c.listField ?? "items", passThreshold: 1 }),
  },
  {
    type: "numeric_tolerance",
    label: "numeric_tolerance",
    config: () => ({ path: "score", abs: 0.1 }),
  },
  { type: "regex", label: "regex", config: () => ({ pattern: "^(yes|no)$", flags: "i" }) },
  {
    type: "llm_judge",
    label: "llm_judge",
    config: () => ({
      rubric:
        "The output must contain the facts of the expected answer; wording may differ. Invented facts score 0.",
      passThreshold: 0.7,
    }),
  },
];

export function RunsTab() {
  const d = useOutletContext<DatasetSummary>();
  const qc = useQueryClient();
  const runs = useQuery({
    queryKey: ["runs", d.id],
    queryFn: () => api.runs.list({ datasetId: d.id, limit: 50 }),
    refetchInterval: 3000,
  });
  const models = useQuery({ queryKey: ["models"], queryFn: () => api.models() });
  const firstItem = useQuery({
    queryKey: ["items", d.id, "first"],
    queryFn: async () => (await api.items.list(d.id, { limit: 1 })).items[0] ?? null,
  });
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
  const available = models.data?.models.filter((m) => m.available) ?? [];
  const defaults = models.data?.defaults;

  // Examples derived from this dataset so the guidance matches the user's own data.
  const item = firstItem.data ?? null;
  const input = item?.input;
  const inputFields =
    input && typeof input === "object" && !Array.isArray(input) ? Object.keys(input) : null;
  const expected = item?.expected ?? null;
  const expectedIsObject =
    expected !== null && typeof expected === "object" && !Array.isArray(expected);
  const listField = expectedIsObject
    ? (Object.entries(expected as Record<string, unknown>).find(([, v]) => Array.isArray(v))?.[0] ??
      null)
    : null;
  const taskText = d.description
    ? d.description.replace(/\.$/, "")
    : "solve the task described by the dataset";
  const systemExample = `You ${taskText.charAt(0).toLowerCase()}${taskText.slice(1)}.\nAnswer with the final answer only, no explanation.`;
  const templateExample = inputFields
    ? inputFields.map((f) => `${f.charAt(0).toUpperCase()}${f.slice(1)}: {{${f}}}`).join("\n")
    : "{{input}}";
  const schemaExample = JSON.stringify(
    expectedIsObject
      ? inferSchema(expected)
      : { type: "object", properties: { answer: { type: "string" } }, required: ["answer"] },
    null,
    2,
  );
  const scorerExample = JSON.stringify(
    [
      listField
        ? { key: "codes", type: "set_overlap", config: { path: listField, passThreshold: 1 } }
        : expectedIsObject
          ? { key: "strict", type: "json_equal", config: {} }
          : { key: "exact", type: "exact_match", config: { caseInsensitive: true } },
      {
        key: "judge",
        type: "llm_judge",
        config: {
          rubric: "The output must match the expected answer in substance; wording may differ.",
          passThreshold: 0.7,
        },
      },
    ],
    null,
    2,
  );
  const addScorer = (type: string) => {
    const preset = SCORER_PRESETS.find((p) => p.type === type)!;
    let current: ScorerSpec[] = [];
    try {
      const parsed = JSON.parse(scorers) as unknown;
      if (Array.isArray(parsed)) current = parsed as ScorerSpec[];
    } catch {
      current = [];
    }
    const base = type.replace(/_.*/, "");
    let key = base;
    for (let i = 2; current.some((s) => s.key === key); i++) key = `${base}${i}`;
    setScorers(
      JSON.stringify([...current, { key, type, config: preset.config({ listField }) }], null, 2),
    );
  };

  return (
    <div className="space-y-4">
      <div className="card p-0">
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
        {runs.data?.items.length === 0 && <Empty>No runs yet. Configure one below.</Empty>}
        <ErrorText error={runs.error} />
      </div>

      <div className="card">
        <div className="mb-3 flex items-baseline justify-between">
          <h3 className="text-sm font-semibold">New run</h3>
          <p className="text-xs text-gray-500">
            A run sends every item of the latest version to one model with one prompt setup and
            scores the answers. Click the{" "}
            <span className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-gray-400 text-[10px] font-bold text-gray-500">
              ?
            </span>{" "}
            next to a field for an explanation and an example based on your data.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-3">
            <HelpField
              label="Name"
              help={{
                text: "A label for this run so you can tell variants apart in the runs table and in Compare. Say what you changed: the prompt variant, the model, or the version.",
                example: "baseline prompt",
                onUseExample: () =>
                  setName(
                    runs.data?.items.length
                      ? `variant ${(runs.data.items.length + 1).toString()}`
                      : "baseline prompt",
                  ),
                manual: "4-running-a-dataset-against-a-model",
              }}
            >
              <input
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. baseline prompt"
              />
            </HelpField>
            <HelpField
              label="Model"
              help={{
                text: "Which model answers the items, as provider:model. The first option is the configured default; when its provider has no key the effective fallback (usually a local Ollama model) is shown. Only usable models are listed; see Settings for pricing and availability.",
                manual: "7-models-and-settings",
              }}
            >
              <select className="input" value={model} onChange={(e) => setModel(e.target.value)}>
                <option value="">{defaultModelLabel(defaults?.default, "DEFAULT_MODEL")}</option>
                {available.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.id}
                  </option>
                ))}
              </select>
            </HelpField>
            <HelpField
              label="System prompt"
              help={{
                text: "Instructions the model receives before every item: the role, the task, the rules for the answer format. It is identical for all items, so keep item-specific content out of it. You may use {{field}} placeholders here as well. Tip: state the allowed answers explicitly when you score with exact_match.",
                example: systemExample,
                onUseExample: () => setSystemPrompt(systemExample),
                manual: "4-running-a-dataset-against-a-model",
              }}
            >
              <textarea
                className="input"
                rows={5}
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                placeholder="You classify customer emails. Answer with exactly one label: spam, product_search, support or invoice."
              />
            </HelpField>
            <HelpField
              label="User template"
              help={{
                text:
                  (inputFields
                    ? `How each item's input becomes the user message. Your items are objects with the fields ${inputFields.map((f) => `{{${f}}}`).join(", ")}; reference them with those placeholders (nested paths like {{customer.name}} and {{json field}} for raw JSON also work).`
                    : Array.isArray(input)
                      ? "Your items are chat-message arrays; they are sent as-is and the template is ignored."
                      : "How each item's input becomes the user message. Your items are strings: use {{input}} where the text should go.") +
                  " Leave empty to send the input unchanged (objects as JSON).",
                example: templateExample,
                onUseExample: () => setUserTemplate(templateExample),
                manual: "32-items-the-shape-of-input-and-expected",
              }}
              hint={item ? `First item input: ${JSON.stringify(input).slice(0, 120)}` : undefined}
            >
              <textarea
                className="input mono"
                rows={4}
                value={userTemplate}
                onChange={(e) => setUserTemplate(e.target.value)}
                placeholder={templateExample}
              />
            </HelpField>
          </div>
          <div className="space-y-3">
            <HelpField
              label="Output JSON schema (optional)"
              help={{
                text:
                  "When set, the model must return an object matching this JSON Schema and the output is stored as that object instead of text. Use it whenever expected is an object, so json_equal, set_overlap and numeric_tolerance can read fields via their `path`. " +
                  (expectedIsObject
                    ? "The example below is derived from your first item's expected value."
                    : "Leave empty for free-text answers (labels, sentences)."),
                example: schemaExample,
                onUseExample: () => setOutputSchema(schemaExample),
                manual: "55-json_equal",
              }}
            >
              <textarea
                className="input mono"
                rows={6}
                value={outputSchema}
                onChange={(e) => setOutputSchema(e.target.value)}
                placeholder={expectedIsObject ? schemaExample : "leave empty for free text"}
              />
            </HelpField>
            <HelpField
              label="Scorers (JSON)"
              help={{
                text: "How answers are graded: a list of { key, type, config }. key is your name for the scorer (shown in tables), type picks the scorer, config depends on the type. Rules of thumb: exact_match for labels, set_overlap (with path) for lists such as codes, json_equal for structured answers, numeric_tolerance for numbers, llm_judge with a rubric for anything needing judgement. Use the buttons below to append a preset; the example is tailored to your expected values.",
                example: scorerExample,
                onUseExample: () => setScorers(scorerExample),
                manual: "5-scoring",
              }}
            >
              <textarea
                className="input mono"
                rows={8}
                value={scorers}
                onChange={(e) => setScorers(e.target.value)}
              />
              <div className="mt-1 flex flex-wrap gap-1">
                {SCORER_PRESETS.map((p) => (
                  <button
                    key={p.type}
                    type="button"
                    className="btn btn-sm"
                    onClick={() => addScorer(p.type)}
                  >
                    + {p.label}
                  </button>
                ))}
              </div>
            </HelpField>
            <div className="grid grid-cols-2 gap-2">
              <HelpField
                label="Concurrency"
                help={{
                  text: "How many items are sent to the model in parallel. Higher is faster but hits provider rate limits sooner; 1–4 for local Ollama, 4–8 for cloud providers.",
                }}
              >
                <input
                  className="input"
                  value={concurrency}
                  onChange={(e) => setConcurrency(e.target.value)}
                />
              </HelpField>
              <HelpField
                label="Max cost (USD)"
                help={{
                  text: "Safety cap: the run is stopped and marked failed when the estimated cost (from the model's pricing) exceeds this amount. Leave empty for no cap. Only models with known pricing can be capped.",
                }}
              >
                <input
                  className="input"
                  value={maxCost}
                  onChange={(e) => setMaxCost(e.target.value)}
                  placeholder="none"
                />
              </HelpField>
            </div>
            {defaults && !defaults.default.effective && (
              <p className="text-xs text-red-700">
                No usable model: add a provider key to .env or start Ollama with a pulled model.
              </p>
            )}
            <button
              className="btn btn-primary w-full"
              disabled={
                start.isPending ||
                d.draftItemCount === 0 ||
                (defaults !== undefined && !defaults.default.effective && !model)
              }
              onClick={() => start.mutate()}
            >
              Start run
            </button>
            <ErrorText error={start.error} />
          </div>
        </div>
      </div>
    </div>
  );
}
