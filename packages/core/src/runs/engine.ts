import { and, eq, inArray, sql } from "drizzle-orm";
import pLimit from "p-limit";
import type { JsonObject, JsonValue, RunEvent, ScorerSpec, TaskConfig } from "@llmeval/shared";
import type { Config } from "../config.js";
import type { Db } from "../db/client.js";
import { runItems, runs, itemRevisions } from "../db/schema.js";
import type { ChatModel, ChatModelFactory } from "../llm/client.js";
import { buildMessages } from "../llm/messages.js";
import type { ModelRegistry } from "../llm/models.js";
import { estimateCost } from "../llm/pricing.js";
import { nowIso } from "../util/time.js";
import type { JobRunner } from "./job-runner.js";
import { isRetryable, isTimeout, sleep } from "./retry.js";

export interface RunEngineOptions {
  maxAttempts?: number;
  /** Base backoff in ms (doubles per attempt). */
  backoffMs?: number;
  defaultTimeoutMs?: number;
}

/** Hook invoked after each completed item; scoring plugs in here (slice 8). */
export type ItemCompletedHook = (ctx: {
  runId: string;
  runItemId: string;
  input: JsonValue;
  expected: JsonValue | null;
  output: JsonValue;
  scorers: ScorerSpec[];
  signal: AbortSignal;
}) => Promise<void>;

export const runChannel = (runId: string) => `run:${runId}`;

export interface RunAggregate {
  completedItems: number;
  failedItems: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
}

/** Live counters derived from run_items; the runs row is only refreshed when a run finishes. */
export async function aggregateRun(db: Db, runId: string): Promise<RunAggregate> {
  const [row] = await db
    .select({
      completedItems: sql<number>`sum(case when ${runItems.status} = 'completed' then 1 else 0 end)`,
      failedItems: sql<number>`sum(case when ${runItems.status} = 'failed' then 1 else 0 end)`,
      inputTokens: sql<number>`coalesce(sum(${runItems.inputTokens}), 0)`,
      outputTokens: sql<number>`coalesce(sum(${runItems.outputTokens}), 0)`,
      costUsd: sql<number | null>`sum(${runItems.costUsd})`,
    })
    .from(runItems)
    .where(eq(runItems.runId, runId));
  return {
    completedItems: Number(row?.completedItems ?? 0),
    failedItems: Number(row?.failedItems ?? 0),
    inputTokens: Number(row?.inputTokens ?? 0),
    outputTokens: Number(row?.outputTokens ?? 0),
    costUsd: row?.costUsd === null || row?.costUsd === undefined ? null : Number(row.costUsd),
  };
}

/**
 * Executes runs: for every pending run item, render messages, call the model with retries,
 * persist the result and emit progress. Item failures are isolated; cancellation is cooperative.
 */
export class RunEngine {
  private readonly maxAttempts: number;
  private readonly backoffMs: number;
  private readonly defaultTimeoutMs: number;
  private itemCompletedHook: ItemCompletedHook | null = null;

  constructor(
    private readonly db: Db,
    private readonly config: Config,
    private readonly models: ModelRegistry,
    private readonly modelFactory: ChatModelFactory,
    readonly jobs: JobRunner,
    opts: RunEngineOptions = {},
  ) {
    this.maxAttempts = opts.maxAttempts ?? 3;
    this.backoffMs = opts.backoffMs ?? 500;
    this.defaultTimeoutMs = opts.defaultTimeoutMs ?? 300_000;
  }

  onItemCompleted(hook: ItemCompletedHook | null): void {
    this.itemCompletedHook = hook;
  }

  /** Start (or resume) executing a run in the background. Returns once the run is scheduled. */
  start(runId: string): void {
    if (this.jobs.isActive(runId)) return;
    void this.jobs.start(runId, (signal) => this.execute(runId, signal));
  }

  cancel(runId: string): boolean {
    return this.jobs.cancel(runId);
  }

  /** Wait for a run's background task to finish (tests, graceful shutdown). */
  wait(runId: string): Promise<void> {
    return this.jobs.wait(runId);
  }

  /**
   * Called on boot: items left `running` by a crash go back to `pending`; runs left `running`
   * are resumed when AUTO_RESUME is on, otherwise marked `interrupted`.
   */
  async recover(): Promise<{ resumed: string[]; interrupted: string[] }> {
    const active = await this.db
      .select({ id: runs.id })
      .from(runs)
      .where(eq(runs.status, "running"));
    const ids = active.map((r) => r.id);
    if (ids.length === 0) return { resumed: [], interrupted: [] };
    await this.db
      .update(runItems)
      .set({ status: "pending", startedAt: null })
      .where(and(inArray(runItems.runId, ids), eq(runItems.status, "running")));
    if (this.config.AUTO_RESUME) {
      for (const id of ids) this.start(id);
      return { resumed: ids, interrupted: [] };
    }
    await this.db
      .update(runs)
      .set({ status: "interrupted", error: "Server restarted while running" })
      .where(inArray(runs.id, ids));
    return { resumed: [], interrupted: ids };
  }

  // -- execution -------------------------------------------------------------------------------

  private async execute(runId: string, signal: AbortSignal): Promise<void> {
    try {
      await this.executeInner(runId, signal);
    } catch (err) {
      console.error(`[run ${runId}] unexpected failure:`, err);
      await this.finish(runId, "failed", `Unexpected failure: ${(err as Error).message}`).catch(
        () => undefined,
      );
    }
  }

  private async executeInner(runId: string, signal: AbortSignal): Promise<void> {
    const run = await this.db.query.runs.findFirst({ where: eq(runs.id, runId) });
    if (!run) return;
    const config = run.configSnapshot as unknown as TaskConfig;
    const scorers = run.scorers as unknown as ScorerSpec[];
    const now = nowIso();
    await this.db
      .update(runs)
      .set({ status: "running", startedAt: run.startedAt ?? now, finishedAt: null, error: null })
      .where(eq(runs.id, runId));
    this.emit(runId, { type: "run", runId, status: "running", error: null });

    let model: ChatModel;
    try {
      const info = this.models.resolve(config.model);
      model = await this.modelFactory.create(info.id, config.params);
    } catch (err) {
      await this.finish(runId, "failed", `Model setup failed: ${(err as Error).message}`);
      return;
    }
    const pricing = this.models.get(config.model)?.pricing ?? null;

    const pending = await this.db
      .select({ id: runItems.id })
      .from(runItems)
      .where(
        and(
          eq(runItems.runId, runId),
          inArray(runItems.status, ["pending", "cancelled", "failed"]),
        ),
      );
    if (pending.length > 0) {
      // Cancelled and failed (e.g. timed out) items are retried on resume; completed ones are kept.
      await this.db
        .update(runItems)
        .set({ status: "pending", error: null })
        .where(and(eq(runItems.runId, runId), inArray(runItems.status, ["cancelled", "failed"])));
    }

    const limit = pLimit(run.concurrency);
    let costExceeded = false;
    await Promise.all(
      pending.map((p) =>
        limit(async () => {
          if (signal.aborted || costExceeded) return;
          await this.executeItem(runId, p.id, model, config, scorers, pricing, signal);
          if (run.maxCostUsd !== null) {
            const agg = await aggregateRun(this.db, runId);
            if ((agg.costUsd ?? 0) > run.maxCostUsd) {
              costExceeded = true;
              this.jobs.cancel(runId);
            }
          }
        }),
      ),
    );

    if (costExceeded) {
      await this.finish(runId, "failed", `Estimated cost exceeded max_cost_usd=${run.maxCostUsd}`);
    } else if (signal.aborted) {
      await this.finish(runId, "cancelled", null);
    } else {
      await this.finish(runId, "completed", null);
    }
  }

  private async executeItem(
    runId: string,
    runItemId: string,
    model: ChatModel,
    config: TaskConfig,
    scorers: ScorerSpec[],
    pricing: ReturnType<ModelRegistry["get"]> extends infer T
      ? T extends { pricing: infer P }
        ? P
        : null
      : null,
    signal: AbortSignal,
  ): Promise<void> {
    const row = await this.db
      .select({ item: runItems, rev: itemRevisions })
      .from(runItems)
      .innerJoin(itemRevisions, eq(itemRevisions.id, runItems.revisionId))
      .where(eq(runItems.id, runItemId))
      .then((r) => r[0]);
    if (!row) return;
    const { messages, warnings } = buildMessages(config, row.rev.input);
    const startedAt = nowIso();
    await this.db
      .update(runItems)
      .set({ status: "running", startedAt, renderedMessages: messages as unknown as JsonValue })
      .where(eq(runItems.id, runItemId));

    const timeoutMs = config.params.timeoutMs ?? this.defaultTimeoutMs;
    let attempt = 0;
    let lastError: unknown;
    while (attempt < this.maxAttempts && !signal.aborted) {
      attempt++;
      const t0 = Date.now();
      try {
        const res = config.outputSchema
          ? await model.invokeStructured(messages, config.outputSchema, { signal, timeoutMs })
          : await model.invoke(messages, { signal, timeoutMs });
        const latencyMs = Date.now() - t0;
        const cost = res.usage ? estimateCost(pricing, res.usage) : null;
        const raw: JsonObject = { ...res.raw };
        if (warnings.length) raw.warnings = warnings;
        await this.db
          .update(runItems)
          .set({
            status: "completed",
            attempt,
            output: (res.output ?? null) as JsonValue,
            rawResponse: raw,
            inputTokens: res.usage?.inputTokens ?? null,
            outputTokens: res.usage?.outputTokens ?? null,
            costUsd: cost,
            latencyMs,
            error: null,
            finishedAt: nowIso(),
          })
          .where(eq(runItems.id, runItemId));
        if (this.itemCompletedHook && scorers.length > 0) {
          try {
            await this.itemCompletedHook({
              runId,
              runItemId,
              input: row.rev.input,
              expected: row.rev.expected ?? null,
              output: (res.output ?? null) as JsonValue,
              scorers,
              signal,
            });
          } catch (err) {
            console.error(`[run ${runId}] scoring hook failed for ${runItemId}:`, err);
          }
        }
        await this.emitItem(runId, runItemId, row.item.itemId, "completed");
        return;
      } catch (err) {
        lastError = err;
        // Only the run's own signal means "cancelled". A provider timeout also surfaces as an
        // abort-style error but is a failure of this item, reported as such and not retried
        // (a retry would just wait another timeoutMs on an overloaded model).
        if (signal.aborted) break;
        if (isTimeout(err)) {
          lastError = new Error(
            `Timed out after ${timeoutMs} ms waiting for ${config.model}. Lower the run concurrency (1 for local models) or raise params.timeoutMs.`,
          );
          break;
        }
        if (!isRetryable(err) || attempt >= this.maxAttempts) break;
        try {
          await sleep(this.backoffMs * 2 ** (attempt - 1), signal);
        } catch {
          break;
        }
      }
    }

    if (signal.aborted) {
      await this.db
        .update(runItems)
        .set({ status: "cancelled", attempt, finishedAt: nowIso() })
        .where(eq(runItems.id, runItemId));
      await this.emitItem(runId, runItemId, row.item.itemId, "cancelled");
      return;
    }
    const message = lastError instanceof Error ? lastError.message : String(lastError);
    await this.db
      .update(runItems)
      .set({ status: "failed", attempt, error: message, finishedAt: nowIso() })
      .where(eq(runItems.id, runItemId));
    await this.emitItem(runId, runItemId, row.item.itemId, "failed");
  }

  private async finish(
    runId: string,
    status: "completed" | "failed" | "cancelled",
    error: string | null,
  ) {
    const agg = await aggregateRun(this.db, runId);
    await this.db
      .update(runs)
      .set({ status, error, finishedAt: nowIso(), ...agg })
      .where(eq(runs.id, runId));
    this.emit(runId, { type: "run", runId, status, error });
  }

  private async emitItem(
    runId: string,
    runItemId: string,
    itemId: string,
    status: "completed" | "failed" | "cancelled",
  ) {
    const agg = await aggregateRun(this.db, runId);
    const [row] = await this.db.select({ t: runs.totalItems }).from(runs).where(eq(runs.id, runId));
    this.emit(runId, {
      type: "item",
      runId,
      runItemId,
      itemId,
      status,
      completedItems: agg.completedItems,
      failedItems: agg.failedItems,
      totalItems: row?.t ?? 0,
    });
  }

  private emit(runId: string, event: RunEvent) {
    this.jobs.emit(runChannel(runId), event);
  }
}
