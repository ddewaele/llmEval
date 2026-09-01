import { and, eq, inArray } from "drizzle-orm";
import pLimit from "p-limit";
import { AppError, type Job, type JsonValue, type Score, type ScorerSpec } from "@llmeval/shared";
import type { Db } from "../db/client.js";
import { itemRevisions, runItems, runs, scores } from "../db/schema.js";
import type { JobRunner } from "../runs/job-runner.js";
import { newId } from "../util/ids.js";
import { nowIso } from "../util/time.js";
import type { JobService } from "../services/jobs.js";
import type { ScorerRegistry } from "./registry.js";
import type { ScoreContext, ScoreResult } from "./types.js";

type ScoreRow = typeof scores.$inferSelect;

export function toScore(row: ScoreRow): Score {
  return {
    id: row.id,
    runItemId: row.runItemId,
    scorerKey: row.scorerKey,
    scorerType: row.scorerType,
    score: row.score ?? null,
    passed: row.passed ?? null,
    rationale: row.rationale ?? null,
    details: row.details ?? null,
    judgeModel: row.judgeModel ?? null,
    judgeTokens: row.judgeTokens ?? null,
    judgeCostUsd: row.judgeCostUsd ?? null,
    error: row.error ?? null,
    createdAt: row.createdAt,
  };
}

export class ScoringService {
  constructor(
    private readonly db: Db,
    private readonly registry: ScorerRegistry,
    private readonly jobs: JobRunner,
    private readonly jobService: JobService,
  ) {}

  /** Score one run item with every scorer spec; each result (or error) is upserted by key. */
  async scoreItem(
    runItemId: string,
    ctx: Omit<ScoreContext<unknown>, "config">,
    specs: ScorerSpec[],
  ): Promise<Score[]> {
    const out: Score[] = [];
    for (const spec of specs) {
      const row = await this.scoreOne(runItemId, ctx, spec);
      out.push(toScore(row));
    }
    return out;
  }

  private async scoreOne(
    runItemId: string,
    ctx: Omit<ScoreContext<unknown>, "config">,
    spec: ScorerSpec,
  ): Promise<ScoreRow> {
    let result: ScoreResult | null = null;
    let error: string | null = null;
    try {
      const scorer = this.registry.get(spec.type);
      const config = scorer.configSchema.parse(spec.config);
      result = await scorer.score({ ...ctx, config });
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
    const row: ScoreRow = {
      id: newId(),
      runItemId,
      scorerKey: spec.key,
      scorerType: spec.type,
      scorerConfig: spec.config,
      score: result ? clamp(result.score) : null,
      passed: result?.passed ?? null,
      rationale: result?.rationale ?? null,
      details: (result?.details ?? null) as JsonValue | null,
      judgeModel: result?.judge?.model ?? null,
      judgeTokens: result?.judge?.tokens ?? null,
      judgeCostUsd: result?.judge?.costUsd ?? null,
      error,
      createdAt: nowIso(),
    };
    await this.db
      .delete(scores)
      .where(and(eq(scores.runItemId, runItemId), eq(scores.scorerKey, spec.key)));
    await this.db.insert(scores).values(row);
    return row;
  }

  /**
   * Add (or replace) a scorer on an existing run without re-executing it. Runs as a background
   * job over the run's completed items and appends the scorer to the run's scorer list.
   */
  async scoreRun(
    runId: string,
    spec: ScorerSpec,
    opts: { overwrite?: boolean } = {},
  ): Promise<Job> {
    const run = await this.db.query.runs.findFirst({ where: eq(runs.id, runId) });
    if (!run) throw AppError.notFound("Run", runId);
    const [validated] = this.registry.validate([spec]);
    const existing = run.scorers as unknown as ScorerSpec[];
    if (existing.some((s) => s.key === spec.key) && !opts.overwrite) {
      throw new AppError(
        "CONFLICT",
        `Run already has scorer "${spec.key}"; pass overwrite=true to replace it`,
      );
    }
    const nextSpecs = [...existing.filter((s) => s.key !== spec.key), validated!];
    await this.db
      .update(runs)
      .set({ scorers: nextSpecs as unknown as typeof run.scorers })
      .where(eq(runs.id, runId));

    const job = await this.jobService.create("rescore", run.datasetId, {
      runId,
      scorer: validated!,
    });
    void this.jobs.start(job.id, async (signal) => {
      await this.jobService.markRunning(job.id);
      try {
        const targets = await this.db
          .select({ ri: runItems, rev: itemRevisions })
          .from(runItems)
          .innerJoin(itemRevisions, eq(itemRevisions.id, runItems.revisionId))
          .where(and(eq(runItems.runId, runId), inArray(runItems.status, ["completed"])));
        let done = 0;
        const limit = pLimit(4);
        await Promise.all(
          targets.map((t) =>
            limit(async () => {
              if (signal.aborted) return;
              await this.scoreOne(
                t.ri.id,
                {
                  input: t.rev.input,
                  expected: t.rev.expected ?? null,
                  output: t.ri.output ?? null,
                  signal,
                },
                validated!,
              );
              done++;
              if (done % 5 === 0 || done === targets.length) {
                await this.jobService.progress(job.id, { done, total: targets.length });
              }
            }),
          ),
        );
        if (signal.aborted)
          await this.jobService.finish(job.id, "cancelled", { done, total: targets.length });
        else await this.jobService.finish(job.id, "completed", { done, total: targets.length });
      } catch (err) {
        await this.jobService.fail(job.id, (err as Error).message);
      }
    });
    return this.jobService.get(job.id);
  }

  async scoresForRunItems(runItemIds: string[]): Promise<Map<string, Score[]>> {
    const map = new Map<string, Score[]>();
    if (runItemIds.length === 0) return map;
    const rows = await this.db.select().from(scores).where(inArray(scores.runItemId, runItemIds));
    for (const r of rows) {
      const list = map.get(r.runItemId) ?? [];
      list.push(toScore(r));
      map.set(r.runItemId, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.scorerKey.localeCompare(b.scorerKey));
    return map;
  }
}

const clamp = (n: number) => Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0));
