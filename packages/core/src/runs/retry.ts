/** Heuristic for transient provider failures worth retrying. */
export function isRetryable(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as {
    status?: number;
    code?: string;
    message?: string;
    name?: string;
    cause?: unknown;
  };
  const status = e.status ?? (e as { response?: { status?: number } }).response?.status;
  if (typeof status === "number")
    return status === 408 || status === 409 || status === 429 || status >= 500;
  if (e.name === "TimeoutError") return true;
  if (e.code && ["ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "EAI_AGAIN", "EPIPE"].includes(e.code))
    return true;
  const msg = (e.message ?? "").toLowerCase();
  return /rate limit|overloaded|timeout|timed out|temporarily unavailable|econnreset|socket hang up/.test(
    msg,
  );
}

export function isAbort(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: string; message?: string };
  return e.name === "AbortError" || e.message === "cancelled" || /abort/i.test(e.message ?? "");
}

export const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? new Error("cancelled"));
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(signal?.reason ?? new Error("cancelled"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
