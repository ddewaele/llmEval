import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { NavLink, Outlet, useNavigate, useParams } from "react-router";
import { api } from "../lib/api.js";
import { ErrorText } from "../components/ui.js";

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
          {d.description && <p className="text-sm text-gray-600">{d.description}</p>}
          <p className="mt-1 text-xs text-gray-500">
            {d.draftItemCount} draft items ·{" "}
            {d.latestVersion ? `latest v${d.latestVersion}` : "no versions yet"} ·{" "}
            {d.unreviewedGroundTruths} unreviewed ground truths ·{" "}
            <span className="mono">{d.id}</span>
          </p>
        </div>
        <div className="flex gap-2">
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
      </nav>
      <ErrorText error={remove.error ?? archive.error} />
      <Outlet context={d} />
    </div>
  );
}
