import { and, asc, desc, eq, gt, inArray, lt, lte, or } from "drizzle-orm";
import {
  AppError,
  type ListRunItemsQuery,
  type ListRunsQuery,
  type Page,
  type Run,
  type RunEvent,
  type RunItem,
  type ScorerSpec,
  type StartRun,
  type TaskConfig,
  TaskConfigSchema,
} from "@llmeval/shared";
import type { Config } from "../config.js";
import type { Db } from "../db/client.js";
import {
  datasetVersions,
  itemRevisions,
  runItems,
  runs,
  scores,
  versionItems,
} from "../db/schema.js";
import type { ModelRegistry } from "../llm/models.js";
import { aggregateRun, runChannel, type RunAggregate, type RunEngine } from "../runs/engine.js";
import { newId } from "../util/ids.js";
import { nowIso } from "../util/time.js";
import type { VersionService } from "./versions.js";
import { computeAggregates } from "../scoring/aggregates.js";
import type { ScorerRegistry } from "../scoring/registry.js";
import type { ScoringService } from "../scoring/service.js";
import type { RunAggregates, Score } from "@llmeval/shared";

type RunRow = typeof runs.$inferSelect;
type RunItemRow = typeof runItems.$inferSelect;

export class RunService {
  constructor(
    private readonly db: Db,
    private readonly config: Config,
    private readonly versions: VersionService,
    private readonly models: ModelRegistry,
    private readonly engine: RunEngine,
    private readonly scorers: ScorerRegistry,
    private readonly scoring: ScoringService,
  ) {}

  /** Create the run and its items, then start executing in the background. */
  async start(input: StartRun): Promise<Run> {
    const version = await this.resolveVersion(input.datasetId, input.versionNumber);
    const config: TaskConfig = TaskConfigSchema.parse({
      model: input.model ?? this.models.resolveDefault("default").id,
      params: input.params ?? {},
      systemPrompt: input.systemPrompt ?? null,
      userTemplate: input.userTemplate ?? null,
      outputSchema: input.outputSchema ?? null,
    });
    const modelInfo = this.models.resolve(config.model); // fail fast on unknown/unavailable models
    // Local models serve requests one at a time; parallel calls only slow each other down and
    // push every item toward the timeout, so default to 1 for Ollama.
    const defaultConcurrency = modelInfo.provider === "ollama" ? 1 : this.config.MAX_CONCURRENCY;
    const scorerSpecs = this.scorers.validate(input.scorers);
    const entries = await this.db
      .select({ itemId: versionItems.itemId, revisionId: versionItems.revisionId })
      .from(versionItems)
      .where(eq(versionItems.versionId, version.id))
      .orderBy(asc(versionItems.position));
    if (entries.length === 0) throw new AppError("INVALID_STATE", "Version has no items");

    const now = nowIso();
    const row: RunRow = {
      id: newId(),
      datasetId: input.datasetId,
      versionId: version.id,
      name: input.name ?? null,
      taskConfigId: null,
      configSnapshot: config as unknown as RunRow["configSnapshot"],
      scorers: scorerSpecs as unknown as RunRow["scorers"],
      status: "pending",
      concurrency: input.concurrency ?? defaultConcurrency,
      triggeredBy: input.triggeredBy,
      totalItems: entries.length,
      completedItems: 0,
      failedItems: 0,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: null,
      maxCostUsd: input.maxCostUsd ?? null,
      error: null,
      createdAt: now,
      startedAt: null,
      finishedAt: null,
    };
    await this.db.transaction(async (tx) => {
      await tx.insert(runs).values(row);
      for (let i = 0; i < entries.length; i += 200) {
        await tx.insert(runItems).values(
          entries.slice(i, i + 200).map((e) => ({
            id: newId(),
            runId: row.id,
            itemId: e.itemId,
            revisionId: e.revisionId,
            status: "pending" as const,
            attempt: 0,
          })),
        );
      }
    });
    this.engine.start(row.id);
    return this.get(row.id);
  }

  async get(id: string): Promise<Run> {
    const row = await this.requireRow(id);
    const version = await this.db.query.datasetVersions.findFirst({
      where: eq(datasetVersions.id, row.versionId),
      columns: { number: true },
    });
    return toRun(
      row,
      version?.number ?? 0,
      await this.liveAggregate(row),
      await this.aggregatesFor(row),
    );
  }

  async list(query: ListRunsQuery): Promise<Page<Run>> {
    const conds = [];
    if (query.datasetId) conds.push(eq(runs.datasetId, query.datasetId));
    if (query.status) conds.push(eq(runs.status, query.status));
    if (query.cursor) {
      const [createdAt, id] = splitCursor(query.cursor);
      conds.push(
        or(lt(runs.createdAt, createdAt), and(eq(runs.createdAt, createdAt), lt(runs.id, id)))!,
      );
    }
    const rows = await this.db
      .select({ run: runs, versionNumber: datasetVersions.number })
      .from(runs)
      .innerJoin(datasetVersions, eq(datasetVersions.id, runs.versionId))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(runs.createdAt), desc(runs.id))
      .limit(query.limit + 1);
    const page = await Promise.all(
      rows
        .slice(0, query.limit)
        .map(async (r) =>
          toRun(
            r.run,
            r.versionNumber,
            await this.liveAggregate(r.run),
            await this.aggregatesFor(r.run),
          ),
        ),
    );
    const last = page[page.length - 1];
    return {
      items: page,
      nextCursor: rows.length > query.limit && last ? `${last.createdAt}|${last.id}` : null,
    };
  }

  async listItems(runId: string, query: ListRunItemsQuery): Promise<Page<RunItem>> {
    await this.requireRow(runId);
    const conds = [eq(runItems.runId, runId)];
    if (query.status) conds.push(eq(runItems.status, query.status));
    if (query.scorerKey) {
      const failing = this.db
        .select({ id: scores.runItemId })
        .from(scores)
        .where(
          and(
            eq(scores.scorerKey, query.scorerKey),
            query.maxScore !== undefined
              ? lte(scores.score, query.maxScore)
              : eq(scores.passed, false),
          ),
        );
      conds.push(inArray(runItems.id, failing));
    }
    if (query.cursor) {
      const [posStr, id] = splitCursor(query.cursor);
      const pos = Number(posStr);
      conds.push(
        or(
          gt(versionItems.position, pos),
          and(eq(versionItems.position, pos), gt(runItems.id, id)),
        )!,
      );
    }
    const rows = await this.db
      .select({ ri: runItems, rev: itemRevisions, position: versionItems.position })
      .from(runItems)
      .innerJoin(runs, eq(runs.id, runItems.runId))
      .innerJoin(itemRevisions, eq(itemRevisions.id, runItems.revisionId))
      .innerJoin(
        versionItems,
        and(eq(versionItems.versionId, runs.versionId), eq(versionItems.itemId, runItems.itemId)),
      )
      .where(and(...conds))
      .orderBy(asc(versionItems.position), asc(runItems.id))
      .limit(query.limit + 1);
    const slice = rows.slice(0, query.limit);
    const scoreMap = await this.scoring.scoresForRunItems(slice.map((r) => r.ri.id));
    const page = slice.map((r) => toRunItem(r.ri, r.rev, r.position, scoreMap.get(r.ri.id) ?? []));
    const last = page[page.length - 1];
    return {
      items: page,
      nextCursor: rows.length > query.limit && last ? `${last.position}|${last.id}` : null,
    };
  }

  async getItem(runItemId: string): Promise<RunItem> {
    const row = await this.db
      .select({ ri: runItems, rev: itemRevisions, position: versionItems.position })
      .from(runItems)
      .innerJoin(runs, eq(runs.id, runItems.runId))
      .innerJoin(itemRevisions, eq(itemRevisions.id, runItems.revisionId))
      .innerJoin(
        versionItems,
        and(eq(versionItems.versionId, runs.versionId), eq(versionItems.itemId, runItems.itemId)),
      )
      .where(eq(runItems.id, runItemId))
      .then((r) => r[0]);
    if (!row) throw AppError.notFound("Run item", runItemId);
    const scoreMap = await this.scoring.scoresForRunItems([runItemId]);
    return toRunItem(row.ri, row.rev, row.position, scoreMap.get(runItemId) ?? []);
  }

  async cancel(id: string): Promise<Run> {
    const row = await this.requireRow(id);
    if (row.status !== "running" && row.status !== "pending") {
      throw new AppError(
        "INVALID_STATE",
        `Run is ${row.status}; only running runs can be cancelled`,
      );
    }
    if (!this.engine.cancel(id)) {
      // Not active in this process (e.g. after a restart without auto-resume): mark directly.
      const agg = await aggregateRun(this.db, id);
      await this.db
        .update(runs)
        .set({ status: "cancelled", finishedAt: nowIso(), ...agg })
        .where(eq(runs.id, id));
    } else {
      await this.engine.wait(id);
    }
    return this.get(id);
  }

  /** Re-enqueue pending and cancelled items of a cancelled/interrupted/failed run. */
  async resume(id: string): Promise<Run> {
    const row = await this.requireRow(id);
    if (!["cancelled", "interrupted", "failed"].includes(row.status)) {
      throw new AppError(
        "INVALID_STATE",
        `Run is ${row.status}; only cancelled, interrupted or failed runs can be resumed`,
      );
    }
    await this.db
      .update(runs)
      .set({ status: "pending", error: null, finishedAt: null })
      .where(eq(runs.id, id));
    this.engine.start(id);
    return this.get(id);
  }

  /** Wait until the run's background task finishes. Used by tests and graceful shutdown. */
  wait(id: string): Promise<void> {
    return this.engine.wait(id);
  }

  subscribe(id: string, listener: (event: RunEvent) => void): () => void {
    return this.engine.jobs.subscribe(runChannel(id), listener as (p: unknown) => void);
  }

  recover() {
    return this.engine.recover();
  }

  // -- internals -------------------------------------------------------------------------------

  private async resolveVersion(datasetId: string, versionNumber?: number) {
    if (versionNumber !== undefined) {
      const v = await this.versions.get(datasetId, versionNumber);
      return { id: v.id, number: v.number };
    }
    if (await this.versions.hasUnpublishedChanges(datasetId)) {
      const { version } = await this.versions.publish(datasetId, {
        label: "auto",
        notes: "Published automatically when a run was started with unpublished draft changes",
      });
      return { id: version.id, number: version.number };
    }
    const latest = await this.versions.latest(datasetId);
    if (!latest) throw new AppError("INVALID_STATE", "Dataset has no items to run");
    return { id: latest.id, number: latest.number };
  }

  private aggregatesFor(row: RunRow): Promise<RunAggregates> {
    return computeAggregates(this.db, row.id, row.scorers as unknown as ScorerSpec[]);
  }

  /** Terminal runs carry persisted aggregates; active ones are computed from run_items. */
  private async liveAggregate(row: RunRow): Promise<RunAggregate> {
    if (row.status === "running" || row.status === "pending") return aggregateRun(this.db, row.id);
    return {
      completedItems: row.completedItems,
      failedItems: row.failedItems,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      costUsd: row.costUsd ?? null,
    };
  }

  private async requireRow(id: string): Promise<RunRow> {
    const row = await this.db.query.runs.findFirst({ where: eq(runs.id, id) });
    if (!row) throw AppError.notFound("Run", id);
    return row;
  }
}

function splitCursor(cursor: string): [string, string] {
  const idx = cursor.lastIndexOf("|");
  if (idx < 0) throw new AppError("VALIDATION", "Invalid cursor");
  return [cursor.slice(0, idx), cursor.slice(idx + 1)];
}

function toRun(
  row: RunRow,
  versionNumber: number,
  agg: RunAggregate,
  aggregates: RunAggregates,
): Run {
  return {
    id: row.id,
    datasetId: row.datasetId,
    versionId: row.versionId,
    versionNumber,
    name: row.name ?? null,
    config: row.configSnapshot as unknown as TaskConfig,
    scorers: row.scorers as unknown as ScorerSpec[],
    status: row.status,
    concurrency: row.concurrency,
    triggeredBy: row.triggeredBy,
    totalItems: row.totalItems,
    completedItems: agg.completedItems,
    failedItems: agg.failedItems,
    inputTokens: agg.inputTokens,
    outputTokens: agg.outputTokens,
    costUsd: agg.costUsd,
    maxCostUsd: row.maxCostUsd ?? null,
    error: row.error ?? null,
    createdAt: row.createdAt,
    startedAt: row.startedAt ?? null,
    finishedAt: row.finishedAt ?? null,
    aggregates,
  };
}

function toRunItem(
  ri: RunItemRow,
  rev: typeof itemRevisions.$inferSelect,
  position: number,
  scores: Score[],
): RunItem {
  return {
    id: ri.id,
    runId: ri.runId,
    itemId: ri.itemId,
    revisionId: ri.revisionId,
    position,
    status: ri.status,
    attempt: ri.attempt,
    input: rev.input,
    expected: rev.expected ?? null,
    renderedMessages: (ri.renderedMessages as RunItem["renderedMessages"]) ?? null,
    output: ri.output ?? null,
    rawResponse: ri.rawResponse ?? null,
    inputTokens: ri.inputTokens ?? null,
    outputTokens: ri.outputTokens ?? null,
    costUsd: ri.costUsd ?? null,
    latencyMs: ri.latencyMs ?? null,
    error: ri.error ?? null,
    startedAt: ri.startedAt ?? null,
    finishedAt: ri.finishedAt ?? null,
    scores,
  };
}
