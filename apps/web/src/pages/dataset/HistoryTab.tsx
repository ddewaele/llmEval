import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useOutletContext } from "react-router";
import type { DatasetSummary, Job } from "@llmeval/shared";
import { api } from "../../lib/api.js";
import { Empty, ErrorText, StatusBadge, fmtDate } from "../../components/ui.js";
import { GenerateDialog, SynthesizeDialog } from "./GenerationDialogs.js";

type Params = {
  description?: string;
  instructions?: string | null;
  model?: string;
  count?: number;
  scorer?: { key: string; type: string };
};

/** Background jobs of this dataset: what generated which items, with which brief and model. */
export function HistoryTab() {
  const d = useOutletContext<DatasetSummary>();
  const jobs = useQuery({
    queryKey: ["jobs", d.id],
    queryFn: () => api.jobs.list(d.id),
    refetchInterval: 3000,
  });
  const [reuse, setReuse] = useState<{ kind: "items" | "truths"; text: string } | null>(null);
  return (
    <div>
      <p className="mb-3 text-sm text-gray-600">
        Every generation and re-scoring job is recorded with its inputs and result; generated items
        carry the job id in their metadata.
        {d.generationBrief
          ? " The dataset's generation brief is used whenever a job is started without a description."
          : " Set a generation brief in Edit details to reuse it across jobs."}
      </p>
      <div className="card p-0">
        <table className="table">
          <thead>
            <tr>
              <th>When</th>
              <th>Job</th>
              <th>Status</th>
              <th>Model</th>
              <th>Brief / instructions</th>
              <th>Result</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {jobs.data?.map((j) => {
              const p = j.params as Params;
              const text = p.description ?? p.instructions ?? null;
              return (
                <tr key={j.id}>
                  <td className="text-xs whitespace-nowrap text-gray-500">
                    {fmtDate(j.createdAt)}
                  </td>
                  <td className="text-sm">
                    {j.kind}
                    {p.count !== undefined && (
                      <span className="text-xs text-gray-500"> · {p.count} wanted</span>
                    )}
                    {p.scorer && (
                      <span className="text-xs text-gray-500">
                        {" "}
                        · {p.scorer.key} ({p.scorer.type})
                      </span>
                    )}
                  </td>
                  <td>
                    <StatusBadge status={j.status} />
                  </td>
                  <td className="mono text-xs">{p.model ?? "–"}</td>
                  <td className="max-w-md text-xs whitespace-pre-wrap text-gray-700">
                    {text ?? <span className="text-gray-400">–</span>}
                  </td>
                  <td className="text-xs text-gray-600">
                    {j.error ? (
                      <span className="text-red-700">{j.error}</span>
                    ) : j.result ? (
                      summarise(j)
                    ) : (
                      JSON.stringify(j.progress)
                    )}
                  </td>
                  <td className="text-right whitespace-nowrap">
                    {text &&
                      (j.kind === "generate_items" || j.kind === "generate_ground_truths") && (
                        <button
                          className="btn btn-sm"
                          onClick={() =>
                            setReuse({
                              kind: j.kind === "generate_items" ? "items" : "truths",
                              text,
                            })
                          }
                        >
                          Reuse
                        </button>
                      )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {jobs.data?.length === 0 && (
          <Empty>No jobs yet. Generate items or ground truths from the Items tab.</Empty>
        )}
        <ErrorText error={jobs.error} />
      </div>
      {reuse?.kind === "items" && (
        <SynthesizeDialog
          datasetId={d.id}
          selected={[]}
          initialDescription={reuse.text}
          onClose={() => setReuse(null)}
          onSaved={() => void jobs.refetch()}
        />
      )}
      {reuse?.kind === "truths" && (
        <GenerateDialog
          datasetId={d.id}
          selected={[]}
          initialInstructions={reuse.text}
          onClose={() => setReuse(null)}
          onSaved={() => void jobs.refetch()}
        />
      )}
    </div>
  );
}

function summarise(j: Job): string {
  const r = j.result as Record<string, unknown>;
  if (j.kind === "generate_items")
    return `${r.generated} generated, ${r.duplicatesDropped} duplicates dropped, ${r.rounds} round(s)`;
  if (j.kind === "generate_ground_truths")
    return `${r.generated} generated, ${r.failed} failed, ${r.skipped} skipped`;
  return JSON.stringify(r);
}
