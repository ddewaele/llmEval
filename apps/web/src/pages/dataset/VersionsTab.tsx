import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useOutletContext } from "react-router";
import type { DatasetSummary, VersionItem } from "@llmeval/shared";
import { api } from "../../lib/api.js";
import { Empty, ErrorText, Field, Json, fmtDate } from "../../components/ui.js";

export function VersionsTab() {
  const d = useOutletContext<DatasetSummary>();
  const qc = useQueryClient();
  const versions = useQuery({
    queryKey: ["versions", d.id],
    queryFn: () => api.versions.list(d.id),
  });
  const [label, setLabel] = useState("");
  const [notes, setNotes] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const publish = useMutation({
    mutationFn: () =>
      api.versions.publish(d.id, { label: label || undefined, notes: notes || undefined }),
    onSuccess: (res) => {
      setWarnings(res.warnings);
      setLabel("");
      setNotes("");
      void qc.invalidateQueries({ queryKey: ["versions", d.id] });
      void qc.invalidateQueries({ queryKey: ["dataset", d.id] });
    },
  });
  const latest = versions.data?.[0]?.number;
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("draft");
  const fromRef = from === "" ? (latest ?? null) : from === "draft" ? "draft" : Number(from);
  const toRef = to === "draft" ? "draft" : Number(to);
  const diff = useQuery({
    queryKey: ["diff", d.id, fromRef, toRef],
    queryFn: () => api.versions.diff(d.id, fromRef as number | "draft", toRef),
    enabled: fromRef !== null,
  });

  return (
    <div className="grid grid-cols-3 gap-4">
      <div className="col-span-2 space-y-4">
        <div className="card p-0">
          <table className="table">
            <thead>
              <tr>
                <th>Version</th>
                <th>Label</th>
                <th>Items</th>
                <th>Notes</th>
                <th>Published</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {versions.data?.map((v) => (
                <tr key={v.id}>
                  <td className="font-medium">v{v.number}</td>
                  <td>{v.label ?? "–"}</td>
                  <td>{v.itemCount}</td>
                  <td className="text-xs text-gray-600">{v.notes ?? "–"}</td>
                  <td className="text-xs text-gray-500">{fmtDate(v.createdAt)}</td>
                  <td className="text-right">
                    <a className="btn btn-sm" href={api.versions.exportUrl(d.id, v.number)}>
                      Export JSONL
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {versions.data?.length === 0 && (
            <Empty>No versions yet. Publish the draft to freeze it.</Empty>
          )}
        </div>

        {fromRef !== null && (
          <div className="card">
            <div className="mb-2 flex items-center gap-2 text-sm">
              <span className="font-medium">Diff</span>
              <select
                className="input w-auto"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              >
                {versions.data?.map((v) => (
                  <option key={v.number} value={String(v.number)}>
                    v{v.number}
                  </option>
                ))}
              </select>
              <span>→</span>
              <select className="input w-auto" value={to} onChange={(e) => setTo(e.target.value)}>
                <option value="draft">draft</option>
                {versions.data?.map((v) => (
                  <option key={v.number} value={String(v.number)}>
                    v{v.number}
                  </option>
                ))}
              </select>
              {diff.data && (
                <span className="text-gray-600">
                  {diff.data.added.length} added · {diff.data.removed.length} removed ·{" "}
                  {diff.data.changed.length} changed · {diff.data.unchanged} unchanged
                </span>
              )}
            </div>
            <ErrorText error={diff.error} />
            {diff.data && (
              <div className="space-y-2 text-sm">
                <DiffList title="Added" items={diff.data.added} color="green" />
                <DiffList title="Removed" items={diff.data.removed} color="red" />
                {diff.data.changed.length > 0 && (
                  <div>
                    <p className="font-medium text-amber-700">Changed</p>
                    {diff.data.changed.slice(0, 20).map((c) => (
                      <div
                        key={c.itemId}
                        className="grid grid-cols-2 gap-2 border-t border-gray-100 py-1"
                      >
                        <Json
                          value={{
                            input: c.from.input,
                            expected: c.from.expected,
                            metadata: c.from.metadata,
                          }}
                          max={300}
                        />
                        <Json
                          value={{
                            input: c.to.input,
                            expected: c.to.expected,
                            metadata: c.to.metadata,
                          }}
                          max={300}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="card self-start">
        <h3 className="mb-2 text-sm font-semibold">Publish draft</h3>
        <p className="mb-3 text-xs text-gray-500">
          Freezes the current {d.draftItemCount} draft items as v{(latest ?? 0) + 1}. Runs always
          execute against a version.
        </p>
        <div className="space-y-2">
          <Field label="Label">
            <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} />
          </Field>
          <Field label="Notes / changelog">
            <textarea
              className="input"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </Field>
          <button
            className="btn btn-primary w-full"
            disabled={publish.isPending || d.draftItemCount === 0}
            onClick={() => publish.mutate()}
          >
            Publish
          </button>
          <ErrorText error={publish.error} />
          {warnings.map((w) => (
            <p key={w} className="text-xs text-amber-700">
              ⚠ {w}
            </p>
          ))}
        </div>
      </div>
    </div>
  );
}

function DiffList({
  title,
  items,
  color,
}: {
  title: string;
  items: VersionItem[];
  color: "green" | "red";
}) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className={`font-medium ${color === "green" ? "text-green-700" : "text-red-700"}`}>
        {title}
      </p>
      {items.slice(0, 20).map((i) => (
        <div key={i.itemId} className="border-t border-gray-100 py-1">
          <Json value={{ input: i.input, expected: i.expected }} max={200} />
        </div>
      ))}
    </div>
  );
}
