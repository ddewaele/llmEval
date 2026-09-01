import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { RunEvent } from "@llmeval/shared";
import { api } from "./api.js";

const TERMINAL = new Set(["completed", "failed", "cancelled", "interrupted"]);

/**
 * Subscribes to a run's Server-Sent Events while it is active and refreshes the run and its
 * items (throttled) on every event. Returns the latest progress counters for instant feedback.
 */
export function useRunEvents(runId: string, status: string | undefined) {
  const qc = useQueryClient();
  const [progress, setProgress] = useState<{
    completed: number;
    failed: number;
    total: number;
  } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!status || TERMINAL.has(status)) return;
    const source = new EventSource(api.runs.eventsUrl(runId));
    const refresh = () => {
      if (timer.current) return;
      timer.current = setTimeout(() => {
        timer.current = null;
        void qc.invalidateQueries({ queryKey: ["run", runId] });
        void qc.invalidateQueries({ queryKey: ["run-items", runId] });
      }, 400);
    };
    const onEvent = (e: MessageEvent<string>) => {
      const event = JSON.parse(e.data) as RunEvent;
      if (event.type === "item") {
        setProgress({
          completed: event.completedItems,
          failed: event.failedItems,
          total: event.totalItems,
        });
      }
      refresh();
      if (event.type === "run" && TERMINAL.has(event.status)) source.close();
    };
    source.addEventListener("snapshot", onEvent as EventListener);
    source.addEventListener("item", onEvent as EventListener);
    source.addEventListener("run", onEvent as EventListener);
    source.onerror = () => source.close();
    return () => {
      source.close();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [runId, status, qc]);

  return progress;
}
