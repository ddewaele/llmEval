import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import { ErrorText } from "../components/ui.js";

const PURPOSES = [
  ["default", "runs (DEFAULT_MODEL)"],
  ["judge", "llm_judge (JUDGE_MODEL)"],
  ["generation", "generation (GENERATION_MODEL)"],
] as const;

export function SettingsPage() {
  const qc = useQueryClient();
  const catalog = useQuery({ queryKey: ["models"], queryFn: () => api.models() });
  const scorers = useQuery({ queryKey: ["scorers"], queryFn: api.scorers });
  const refresh = useMutation({
    mutationFn: () => api.models(true),
    onSuccess: (data) => qc.setQueryData(["models"], data),
  });
  const c = catalog.data;
  return (
    <div className="space-y-6">
      <div>
        <h1 className="mb-1 text-xl font-semibold">Models</h1>
        <p className="mb-3 text-sm text-gray-600">
          Providers are configured through environment variables (see{" "}
          <code className="mono">.env.example</code>); pricing is reference data you can override in{" "}
          <code className="mono">models.json</code>. Without cloud keys everything can run on a
          local Ollama model: set <code className="mono">DEFAULT_MODEL</code>,{" "}
          <code className="mono">JUDGE_MODEL</code> and{" "}
          <code className="mono">GENERATION_MODEL</code> to an installed{" "}
          <code className="mono">ollama:&lt;name&gt;</code>, or rely on the automatic fallback shown
          below.
        </p>
        {c && (
          <div className="card mb-4 text-sm">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="font-semibold">Defaults</h2>
              <span className="text-xs text-gray-600">
                Ollama at <code className="mono">{c.ollama.baseUrl}</code>:{" "}
                {c.ollama.reachable === null
                  ? "not checked"
                  : c.ollama.reachable
                    ? `${c.ollama.installed.length} model(s) installed`
                    : "not reachable"}
                <button
                  className="btn btn-sm ml-2"
                  onClick={() => refresh.mutate()}
                  disabled={refresh.isPending}
                >
                  Re-discover
                </button>
              </span>
            </div>
            <table className="table">
              <thead>
                <tr>
                  <th>Purpose</th>
                  <th>Configured</th>
                  <th>Effective</th>
                </tr>
              </thead>
              <tbody>
                {PURPOSES.map(([key, label]) => {
                  const d = c.defaults[key];
                  return (
                    <tr key={key}>
                      <td className="font-medium">{label}</td>
                      <td className="mono">
                        {d.configured}{" "}
                        {d.available ? (
                          <span className="badge bg-green-100 text-green-700">usable</span>
                        ) : (
                          <span className="badge bg-amber-100 text-amber-700">not usable</span>
                        )}
                      </td>
                      <td className="mono">
                        {d.effective ?? <span className="text-red-700">none available</span>}
                        {d.fallback && (
                          <span className="badge ml-1 bg-blue-100 text-blue-700">fallback</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="card p-0">
          <table className="table">
            <thead>
              <tr>
                <th>Model id</th>
                <th>Provider</th>
                <th>Usable</th>
                <th>Input $/MTok</th>
                <th>Output $/MTok</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {c?.models.map((m) => (
                <tr key={m.id}>
                  <td className="mono">{m.id}</td>
                  <td>{m.provider}</td>
                  <td>
                    {m.available ? (
                      <span className="badge bg-green-100 text-green-700">yes</span>
                    ) : (
                      <span className="badge bg-gray-100 text-gray-600">no</span>
                    )}
                  </td>
                  <td>{m.pricing ? m.pricing.inputPerMTok : "–"}</td>
                  <td>{m.pricing ? m.pricing.outputPerMTok : "–"}</td>
                  <td className="text-xs text-gray-600">{m.notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <ErrorText error={catalog.error ?? refresh.error} />
        </div>
      </div>
      <div>
        <h2 className="mb-2 text-lg font-semibold">Scorers</h2>
        <div className="card p-0">
          <table className="table">
            <thead>
              <tr>
                <th>Type</th>
                <th>Description</th>
                <th>Config</th>
              </tr>
            </thead>
            <tbody>
              {scorers.data?.map((s) => (
                <tr key={s.type}>
                  <td className="mono">
                    {s.type}
                    {s.usesLlm && (
                      <span className="badge ml-1 bg-purple-100 text-purple-700">LLM</span>
                    )}
                  </td>
                  <td className="text-sm">{s.description}</td>
                  <td className="mono text-gray-600">
                    {Object.keys((s.configSchema.properties as Record<string, unknown>) ?? {}).join(
                      ", ",
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
