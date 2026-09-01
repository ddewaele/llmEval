import { desc, eq } from "drizzle-orm";
import { AppError, type Job, type JsonObject, type JsonValue } from "@llmeval/shared";
import type { Db } from "../db/client.js";
import { jobs, type JobKind, type JobStatus } from "../db/schema.js";
import type { JobRunner } from "../runs/job-runner.js";
import { newId } from "../util/ids.js";
import { nowIso } from "../util/time.js";

type JobRow = typeof jobs.$inferSelect;

function toJob(row: JobRow): Job {
  return {
    id: row.id,
    kind: row.kind,
    datasetId: row.datasetId ?? null,
    status: row.status,
    params: row.params,
    progress: row.progress,
    result: row.result ?? null,
    error: row.error ?? null,
    createdAt: row.createdAt,
    startedAt: row.startedAt ?? null,
    finishedAt: row.finishedAt ?? null,
  };
}

/** Persistence for background jobs (generation, rescoring, import). Execution lives elsewhere. */
export class JobService {
  constructor(
    private readonly db: Db,
    private readonly runner: JobRunner,
  ) {}

  async create(kind: JobKind, datasetId: string | null, params: JsonObject): Promise<Job> {
    const row: JobRow = {
      id: newId(),
      kind,
      datasetId,
      status: "pending",
      params,
      progress: {},
      result: null,
      error: null,
      createdAt: nowIso(),
      startedAt: null,
      finishedAt: null,
    };
    await this.db.insert(jobs).values(row);
    return toJob(row);
  }

  async get(id: string): Promise<Job> {
    const row = await this.db.query.jobs.findFirst({ where: eq(jobs.id, id) });
    if (!row) throw AppError.notFound("Job", id);
    return toJob(row);
  }

  async list(datasetId?: string, limit = 50): Promise<Job[]> {
    const rows = await this.db
      .select()
      .from(jobs)
      .where(datasetId ? eq(jobs.datasetId, datasetId) : undefined)
      .orderBy(desc(jobs.createdAt))
      .limit(limit);
    return rows.map(toJob);
  }

  async cancel(id: string): Promise<Job> {
    const job = await this.get(id);
    if (job.status !== "running" && job.status !== "pending") {
      throw new AppError("INVALID_STATE", `Job is ${job.status}`);
    }
    if (!this.runner.cancel(id)) await this.finish(id, "cancelled", job.progress);
    else await this.runner.wait(id);
    return this.get(id);
  }

  wait(id: string): Promise<void> {
    return this.runner.wait(id);
  }

  async markRunning(id: string): Promise<void> {
    await this.db
      .update(jobs)
      .set({ status: "running", startedAt: nowIso() })
      .where(eq(jobs.id, id));
  }

  async progress(id: string, progress: JsonObject): Promise<void> {
    await this.db.update(jobs).set({ progress }).where(eq(jobs.id, id));
  }

  async finish(
    id: string,
    status: JobStatus,
    progress: JsonObject,
    result: JsonValue | null = null,
  ): Promise<void> {
    await this.db
      .update(jobs)
      .set({ status, progress, result, finishedAt: nowIso() })
      .where(eq(jobs.id, id));
  }

  async fail(id: string, error: string): Promise<void> {
    await this.db
      .update(jobs)
      .set({ status: "failed", error, finishedAt: nowIso() })
      .where(eq(jobs.id, id));
  }

  /** Jobs left running by a crash are marked interrupted (they are not resumable yet). */
  async recover(): Promise<string[]> {
    const rows = await this.db.select({ id: jobs.id }).from(jobs).where(eq(jobs.status, "running"));
    if (rows.length) {
      await this.db
        .update(jobs)
        .set({
          status: "interrupted",
          error: "Server restarted while running",
          finishedAt: nowIso(),
        })
        .where(eq(jobs.status, "running"));
    }
    return rows.map((r) => r.id);
  }
}
