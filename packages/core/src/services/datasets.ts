import { and, count, eq, inArray, isNull, max, sql } from "drizzle-orm";
import {
  AppError,
  type CreateDataset,
  type Dataset,
  type DatasetSummary,
  type UpdateDataset,
} from "@llmeval/shared";
import type { Db } from "../db/client.js";
import {
  datasetVersions,
  datasets,
  itemRevisions,
  items,
  jobs,
  runItems,
  runs,
  scores,
  taskConfigs,
  versionItems,
} from "../db/schema.js";
import { newId } from "../util/ids.js";
import { nowIso } from "../util/time.js";

type DatasetRow = typeof datasets.$inferSelect;

function toDataset(row: DatasetRow): Dataset {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    tags: row.tags ?? [],
    inputSchema: row.inputSchema ?? null,
    generationBrief: row.generationBrief ?? null,
    archivedAt: row.archivedAt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class DatasetService {
  constructor(private readonly db: Db) {}

  async create(input: CreateDataset): Promise<Dataset> {
    const now = nowIso();
    const row: DatasetRow = {
      id: newId(),
      name: input.name,
      description: input.description ?? null,
      tags: input.tags ?? [],
      inputSchema: input.inputSchema ?? null,
      generationBrief: input.generationBrief ?? null,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    await this.db.insert(datasets).values(row);
    return toDataset(row);
  }

  async list(opts: { includeArchived?: boolean } = {}): Promise<DatasetSummary[]> {
    const rows = await this.db
      .select()
      .from(datasets)
      .where(opts.includeArchived ? undefined : isNull(datasets.archivedAt))
      .orderBy(datasets.createdAt);
    return Promise.all(rows.map((r) => this.summarise(r)));
  }

  async get(id: string): Promise<DatasetSummary> {
    return this.summarise(await this.requireRow(id));
  }

  async update(id: string, patch: UpdateDataset): Promise<Dataset> {
    await this.requireRow(id);
    const values: Partial<DatasetRow> = { updatedAt: nowIso() };
    if (patch.name !== undefined) values.name = patch.name;
    if (patch.description !== undefined) values.description = patch.description;
    if (patch.tags !== undefined) values.tags = patch.tags;
    if (patch.inputSchema !== undefined) values.inputSchema = patch.inputSchema;
    if (patch.generationBrief !== undefined) values.generationBrief = patch.generationBrief;
    await this.db.update(datasets).set(values).where(eq(datasets.id, id));
    return toDataset(await this.requireRow(id));
  }

  async archive(id: string, archived = true): Promise<Dataset> {
    await this.requireRow(id);
    await this.db
      .update(datasets)
      .set({ archivedAt: archived ? nowIso() : null, updatedAt: nowIso() })
      .where(eq(datasets.id, id));
    return toDataset(await this.requireRow(id));
  }

  /** Deletes a dataset and everything under it. Refused while runs exist unless `force`. */
  async delete(id: string, opts: { force?: boolean } = {}): Promise<void> {
    await this.requireRow(id);
    const runCount =
      (await this.db.select({ runCount: count() }).from(runs).where(eq(runs.datasetId, id)))[0]
        ?.runCount ?? 0;
    if (runCount > 0 && !opts.force) {
      throw new AppError(
        "INVALID_STATE",
        `Dataset ${id} has ${runCount} run(s); pass force=true to delete it and its runs`,
      );
    }
    // Explicit cascade: SQLite FK enforcement is connection-scoped and not guaranteed here.
    await this.db.transaction(async (tx) => {
      const runIds = (
        await tx.select({ id: runs.id }).from(runs).where(eq(runs.datasetId, id))
      ).map((r) => r.id);
      if (runIds.length) {
        const runItemIds = (
          await tx.select({ id: runItems.id }).from(runItems).where(inArray(runItems.runId, runIds))
        ).map((r) => r.id);
        if (runItemIds.length) await tx.delete(scores).where(inArray(scores.runItemId, runItemIds));
        await tx.delete(runItems).where(inArray(runItems.runId, runIds));
        await tx.delete(runs).where(inArray(runs.id, runIds));
      }
      const versionIds = (
        await tx
          .select({ id: datasetVersions.id })
          .from(datasetVersions)
          .where(eq(datasetVersions.datasetId, id))
      ).map((v) => v.id);
      if (versionIds.length)
        await tx.delete(versionItems).where(inArray(versionItems.versionId, versionIds));
      await tx.delete(datasetVersions).where(eq(datasetVersions.datasetId, id));
      await tx.delete(itemRevisions).where(eq(itemRevisions.datasetId, id));
      await tx.delete(items).where(eq(items.datasetId, id));
      await tx.delete(jobs).where(eq(jobs.datasetId, id));
      await tx.update(taskConfigs).set({ datasetId: null }).where(eq(taskConfigs.datasetId, id));
      await tx.delete(datasets).where(eq(datasets.id, id));
    });
  }

  private async requireRow(id: string): Promise<DatasetRow> {
    const row = await this.db.query.datasets.findFirst({ where: eq(datasets.id, id) });
    if (!row) throw AppError.notFound("Dataset", id);
    return row;
  }

  private async summarise(row: DatasetRow): Promise<DatasetSummary> {
    const [draft] = await this.db
      .select({
        draftItemCount: count(),
        unreviewed: sql<number>`sum(case when ${items.expectedSource} = 'generated' and ${items.expectedReviewedAt} is null then 1 else 0 end)`,
      })
      .from(items)
      .where(and(eq(items.datasetId, row.id), isNull(items.deletedAt)));
    const [versions] = await this.db
      .select({ latest: max(datasetVersions.number), total: count() })
      .from(datasetVersions)
      .where(eq(datasetVersions.datasetId, row.id));
    return {
      ...toDataset(row),
      draftItemCount: draft?.draftItemCount ?? 0,
      unreviewedGroundTruths: Number(draft?.unreviewed ?? 0),
      latestVersion: versions?.latest ?? null,
      versionCount: versions?.total ?? 0,
    };
  }
}
