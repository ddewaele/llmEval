import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import { ErrorText } from "../components/ui.js";

export function SettingsPage() {
  const models = useQuery({ queryKey: ["models"], queryFn: api.models });
  const scorers = useQuery({ queryKey: ["scorers"], queryFn: api.scorers });
  return (
    <div className="space-y-6">
      <div>
        <h1 className="mb-1 text-xl font-semibold">Models</h1>
        <p className="mb-3 text-sm text-gray-600">
          Providers are configured through environment variables (see{" "}
          <code className="mono">.env.example</code>); pricing is reference data you can override in{" "}
          <code className="mono">models.json</code>.
        </p>
        <div className="card p-0">
          <table className="table">
            <thead>
              <tr>
                <th>Model id</th>
                <th>Provider</th>
                <th>Available</th>
                <th>Input $/MTok</th>
                <th>Output $/MTok</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {models.data?.map((m) => (
                <tr key={m.id}>
                  <td className="mono">{m.id}</td>
                  <td>{m.provider}</td>
                  <td>
                    {m.available ? (
                      <span className="badge bg-green-100 text-green-700">configured</span>
                    ) : (
                      <span className="badge bg-gray-100 text-gray-600">missing key</span>
                    )}
                  </td>
                  <td>{m.pricing ? m.pricing.inputPerMTok : "–"}</td>
                  <td>{m.pricing ? m.pricing.outputPerMTok : "–"}</td>
                  <td className="text-xs text-gray-600">{m.notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <ErrorText error={models.error} />
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
