import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import { api } from "../lib/api.js";
import { Empty, ErrorText, Field, Modal, fmtDate } from "../components/ui.js";

export function DatasetsPage() {
  const qc = useQueryClient();
  const [showArchived, setShowArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const datasets = useQuery({
    queryKey: ["datasets", showArchived],
    queryFn: () => api.datasets.list(showArchived),
  });
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const create = useMutation({
    mutationFn: () => api.datasets.create({ name, description: description || undefined }),
    onSuccess: () => {
      setCreating(false);
      setName("");
      setDescription("");
      void qc.invalidateQueries({ queryKey: ["datasets"] });
    },
  });

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Datasets</h1>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1 text-sm text-gray-600">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
            />{" "}
            show archived
          </label>
          <button className="btn btn-primary" onClick={() => setCreating(true)}>
            New dataset
          </button>
        </div>
      </div>
      <div className="card p-0">
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Draft items</th>
              <th>Versions</th>
              <th>Unreviewed GT</th>
              <th>Tags</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {datasets.data?.map((d) => (
              <tr key={d.id} className="hover:bg-gray-50">
                <td>
                  <Link
                    to={`/datasets/${d.id}`}
                    className="font-medium text-indigo-700 hover:underline"
                  >
                    {d.name}
                  </Link>
                  {d.archivedAt && (
                    <span className="badge ml-2 bg-gray-100 text-gray-600">archived</span>
                  )}
                  {d.description && <div className="text-xs text-gray-500">{d.description}</div>}
                </td>
                <td>{d.draftItemCount}</td>
                <td>{d.latestVersion ? `v${d.latestVersion} (${d.versionCount})` : "–"}</td>
                <td>{d.unreviewedGroundTruths || "–"}</td>
                <td className="text-xs text-gray-600">{d.tags.join(", ")}</td>
                <td className="text-xs text-gray-500">{fmtDate(d.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {datasets.data?.length === 0 && <Empty>No datasets yet. Create one to get started.</Empty>}
        <ErrorText error={datasets.error} />
      </div>

      {creating && (
        <Modal title="New dataset" onClose={() => setCreating(false)}>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate();
            }}
          >
            <Field label="Name">
              <input
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                autoFocus
              />
            </Field>
            <Field label="Description">
              <textarea
                className="input"
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </Field>
            <ErrorText error={create.error} />
            <div className="flex justify-end gap-2">
              <button type="button" className="btn" onClick={() => setCreating(false)}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={create.isPending}>
                Create
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
