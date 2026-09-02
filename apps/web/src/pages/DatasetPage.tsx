import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { NavLink, Outlet, useNavigate, useParams } from "react-router";
import { api } from "../lib/api.js";
import { ErrorText, Field, Modal } from "../components/ui.js";
import type { DatasetSummary } from "@llmeval/shared";

const tab = ({ isActive }: { isActive: boolean }) =>
  `border-b-2 px-3 py-2 text-sm font-medium ${isActive ? "border-indigo-600 text-indigo-700" : "border-transparent text-gray-600 hover:text-gray-900"}`;

export function DatasetPage() {
  const { id = "" } = useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const dataset = useQuery({ queryKey: ["dataset", id], queryFn: () => api.datasets.get(id) });
  const archive = useMutation({
    mutationFn: (archived: boolean) => api.datasets.archive(id, archived),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["dataset", id] }),
  });
  const remove = useMutation({
    mutationFn: () => api.datasets.delete(id, true),
    onSuccess: () => void navigate("/"),
  });
  const [editing, setEditing] = useState(false);
  const d = dataset.data;
  if (dataset.error) return <ErrorText error={dataset.error} />;
  if (!d) return <p className="text-sm text-gray-500">Loading…</p>;

  return (
    <div>
      <div className="mb-3 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold">
            {d.name}{" "}
            {d.archivedAt && <span className="badge bg-gray-100 text-gray-600">archived</span>}
          </h1>
          {d.description ? (
            <p className="mt-1 max-w-3xl text-sm whitespace-pre-wrap text-gray-700">
              {d.description}
            </p>
          ) : (
            <p className="mt-1 text-sm text-gray-400 italic">
              No description yet. Describe what this dataset evaluates; generation and rubrics use
              it.
            </p>
          )}
          {d.tags.length > 0 && (
            <p className="mt-1 text-xs text-gray-500">
              {d.tags.map((t) => (
                <span key={t} className="badge mr-1 bg-gray-100 text-gray-700">
                  {t}
                </span>
              ))}
            </p>
          )}
          {d.generationBrief && (
            <details className="mt-1 text-xs text-gray-600">
              <summary className="cursor-pointer">Generation brief</summary>
              <p className="mt-1 max-w-3xl whitespace-pre-wrap">{d.generationBrief}</p>
            </details>
          )}
          <p className="mt-1 text-xs text-gray-500">
            {d.draftItemCount} draft items ·{" "}
            {d.latestVersion ? `latest v${d.latestVersion}` : "no versions yet"} ·{" "}
            {d.unreviewedGroundTruths} unreviewed ground truths ·{" "}
            <span className="mono">{d.id}</span>
          </p>
        </div>
        <div className="flex gap-2">
          <button className="btn btn-sm" onClick={() => setEditing(true)}>
            Edit details
          </button>
          <button className="btn btn-sm" onClick={() => archive.mutate(!d.archivedAt)}>
            {d.archivedAt ? "Unarchive" : "Archive"}
          </button>
          <button
            className="btn btn-sm btn-danger"
            onClick={() => {
              if (confirm(`Delete dataset "${d.name}" with all items, versions and runs?`))
                remove.mutate();
            }}
          >
            Delete
          </button>
        </div>
      </div>
      <nav className="mb-4 flex gap-2 border-b border-gray-200">
        <NavLink to="" end className={tab}>
          Items
        </NavLink>
        <NavLink to="versions" className={tab}>
          Versions
        </NavLink>
        <NavLink to="runs" className={tab}>
          Runs
        </NavLink>
        <NavLink to="history" className={tab}>
          History
        </NavLink>
      </nav>
      <ErrorText error={remove.error ?? archive.error} />
      <Outlet context={d} />
      {editing && (
        <DetailsEditor
          dataset={d}
          onClose={() => setEditing(false)}
          onSaved={() => {
            void qc.invalidateQueries({ queryKey: ["dataset", id] });
            void qc.invalidateQueries({ queryKey: ["datasets"] });
          }}
        />
      )}
    </div>
  );
}

function DetailsEditor({
  dataset,
  onClose,
  onSaved,
}: {
  dataset: DatasetSummary;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(dataset.name);
  const [description, setDescription] = useState(dataset.description ?? "");
  const [tags, setTags] = useState(dataset.tags.join(", "));
  const [brief, setBrief] = useState(dataset.generationBrief ?? "");
  const save = useMutation({
    mutationFn: () =>
      api.datasets.update(dataset.id, {
        name,
        description: description.trim() === "" ? null : description,
        tags: tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        generationBrief: brief.trim() === "" ? null : brief,
      }),
    onSuccess: () => {
      onSaved();
      onClose();
    },
  });
  return (
    <Modal title="Edit dataset details" onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
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
        <Field
          label="Description"
          hint="What the dataset evaluates and what a correct answer looks like."
        >
          <textarea
            className="input"
            rows={5}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
        <Field label="Tags (comma separated)">
          <input className="input" value={tags} onChange={(e) => setTags(e.target.value)} />
        </Field>
        <Field
          label="Generation brief"
          hint="Reused as the default description for synthetic items and as instructions for ground-truth generation."
        >
          <textarea
            className="input"
            rows={5}
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
          />
        </Field>
        <ErrorText error={save.error} />
        <div className="flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={save.isPending || !name.trim()}
          >
            Save
          </button>
        </div>
      </form>
    </Modal>
  );
}
