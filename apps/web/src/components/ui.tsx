import { useState, type ReactNode } from "react";

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

export interface FieldHelp {
  /** What the field is and how the value is used. */
  text: string;
  /** Concrete example the user can insert. */
  example?: string;
  onUseExample?: () => void;
  /** Anchor in docs/MANUAL.md */
  manual?: string;
}

const MANUAL_URL = "https://github.com/ddewaele/llmEval/blob/main/docs/MANUAL.md";

/** A form field with a "?" toggle that explains the field and offers a ready-made example. */
export function HelpField({
  label,
  help,
  children,
  hint,
}: {
  label: string;
  help: FieldHelp;
  children: ReactNode;
  hint?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <div className="mb-1 flex items-center gap-1">
        <label className="label mb-0">{label}</label>
        <button
          type="button"
          className={`flex h-4 w-4 items-center justify-center rounded-full border text-[10px] font-bold ${open ? "border-indigo-600 bg-indigo-600 text-white" : "border-gray-400 text-gray-500 hover:border-indigo-500 hover:text-indigo-600"}`}
          title="What is this?"
          aria-label={`Help for ${label}`}
          onClick={() => setOpen((o) => !o)}
        >
          ?
        </button>
      </div>
      {open && (
        <div className="mb-2 rounded-md border border-indigo-100 bg-indigo-50 p-2 text-xs text-gray-700">
          <p className="whitespace-pre-wrap">{help.text}</p>
          {help.example !== undefined && (
            <pre className="mono mt-2 max-h-40 overflow-auto rounded border border-indigo-100 bg-white p-2 whitespace-pre-wrap">
              {help.example}
            </pre>
          )}
          <div className="mt-2 flex gap-2">
            {help.onUseExample && (
              <button type="button" className="btn btn-sm" onClick={help.onUseExample}>
                Use example
              </button>
            )}
            {help.manual && (
              <a
                className="btn btn-sm"
                href={`${MANUAL_URL}#${help.manual}`}
                target="_blank"
                rel="noreferrer"
              >
                Manual
              </a>
            )}
          </div>
        </div>
      )}
      {children}
      {hint && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
    </div>
  );
}

/** Derive a JSON Schema from an example value (used to propose an output schema from `expected`). */
export function inferSchema(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) {
    return { type: "array", items: value.length ? inferSchema(value[0]) : { type: "string" } };
  }
  if (value === null || value === undefined) return { type: "string" };
  switch (typeof value) {
    case "number":
      return { type: "number" };
    case "boolean":
      return { type: "boolean" };
    case "object": {
      const props = Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, inferSchema(v)]),
      );
      return {
        type: "object",
        properties: props,
        required: Object.keys(props),
        additionalProperties: false,
      };
    }
    default:
      return { type: "string" };
  }
}
