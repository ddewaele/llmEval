import type { ReactNode } from "react";

export function Json({ value, max = 400 }: { value: unknown; max?: number }) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  const shown = text.length > max ? `${text.slice(0, max)}…` : text;
  return (
    <pre className="mono max-h-48 overflow-auto whitespace-pre-wrap break-words text-gray-800">
      {shown}
    </pre>
  );
}

const statusColors: Record<string, string> = {
  pending: "bg-gray-100 text-gray-700",
  running: "bg-blue-100 text-blue-700",
  completed: "bg-green-100 text-green-700",
  failed: "bg-red-100 text-red-700",
  cancelled: "bg-amber-100 text-amber-700",
  interrupted: "bg-amber-100 text-amber-700",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`badge ${statusColors[status] ?? "bg-gray-100 text-gray-700"}`}>{status}</span>
  );
}

export function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center bg-black/30 p-6"
      onClick={onClose}
    >
      <div
        className={`card max-h-[90vh] w-full overflow-auto ${wide ? "max-w-4xl" : "max-w-xl"}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold">{title}</h2>
          <button className="btn btn-sm" onClick={onClose}>
            Close
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  const msg = error instanceof Error ? error.message : String(error);
  return <p className="mt-2 text-sm text-red-700">{msg}</p>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-gray-500">{children}</p>;
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
      {hint && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
    </div>
  );
}

export function parseJsonOrText(s: string): unknown {
  const t = s.trim();
  if (t === "") return undefined;
  if (/^[[{"]|^-?\d|^(true|false|null)$/.test(t)) {
    try {
      return JSON.parse(t);
    } catch {
      return s;
    }
  }
  return s;
}

export const fmtNum = (n: number | null | undefined, digits = 3) =>
  n === null || n === undefined ? "–" : n.toFixed(digits);
export const fmtCost = (n: number | null | undefined) =>
  n === null || n === undefined ? "–" : `$${n.toFixed(4)}`;
export const fmtDate = (s: string | null | undefined) => (s ? new Date(s).toLocaleString() : "–");
