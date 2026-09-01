import { and, asc, desc, eq, gt, isNull, or } from "drizzle-orm";
import {
  AppError,
  type DatasetVersion,
  type Page,
  type PaginationQuery,
  type PublishResult,
  type PublishVersion,
  type VersionDiff,
  type VersionItem,
  type VersionRef,
} from "@llmeval/shared";
import type { Db } from "../db/client.js";
import { datasetVersions, datasets, itemRevisions, items, versionItems } from "../db/schema.js";
import { sha256 } from "../util/hash.js";
import { newId } from "../util/ids.js";
import { nowIso } from "../util/time.js";

type VersionRow = typeof datasetVersions.$inferSelect;

function toVersion(row: VersionRow): DatasetVersion {
  return {
    id: row.id,
    datasetId: row.datasetId,
    number: row.number,
    label: row.label ?? null,
    notes: row.notes ?? null,
    itemCount: row.itemCount,
    snapshotHash: row.snapshotHash,
    createdAt: row.createdAt,
  };
}

/** Snapshot = ordered list of (item, revision) pairs; identical content ⇒ identical hash. */
function snapshotHash(entries: Array<{ itemId: string; revisionId: string }>): string {
  return sha256(
    entries
      .map((e) => `${e.itemId}:${e.revisionId}`)
      .sort()
      .join("\n"),
  );
}

export class VersionService {
  constructor(private readonly db: Db) {}

  /** Freeze the current draft as the next version. Refused when nothing changed or the draft is empty. */
  async publish(datasetId: string, input: PublishVersion = {}): Promise<PublishResult> {
    await this.requireDataset(datasetId);
    const draft = await this.draftSnapshot(datasetId);
    if (draft.length === 0) {
      throw new AppError("VALIDATION", "Cannot publish an empty draft; add items first");
    }
    const hash = snapshotHash(draft);
    const latest = await this.latest(datasetId);
    if (latest && latest.snapshotHash === hash) {
      throw new AppError(
        "CONFLICT",
        `Draft is identical to version ${latest.number}; nothing to publish`,
      );
    }
    const now = nowIso();
    const row: VersionRow = {
      id: newId(),
      datasetId,
      number: (latest?.number ?? 0) + 1,
      label: input.label ?? null,
      notes: input.notes ?? null,
      itemCount: draft.length,
      snapshotHash: hash,
      createdAt: now,
    };
    await this.db.transaction(async (tx) => {
      await tx.insert(datasetVersions).values(row);
      for (let i = 0; i < draft.length; i += 200) {
        await tx.insert(versionItems).values(
          draft.slice(i, i + 200).map((e) => ({
            versionId: row.id,
            itemId: e.itemId,
            revisionId: e.revisionId,
            position: e.position,
            expectedReviewed: e.expectedReviewed,
          })),
        );
      }
      await tx.update(datasets).set({ updatedAt: now }).where(eq(datasets.id, datasetId));
    });
    const warnings: string[] = [];
    const unreviewed = draft.filter((e) => e.expected !== null && !e.expectedReviewed).length;
    if (unreviewed > 0) {
      warnings.push(`${unreviewed} item(s) have generated ground truths that were not reviewed`);
    }
    const missing = draft.filter((e) => e.expected === null).length;
    if (missing > 0) warnings.push(`${missing} item(s) have no ground truth`);
    return { version: toVersion(row), warnings };
  }

  async list(datasetId: string): Promise<DatasetVersion[]> {
    await this.requireDataset(datasetId);
    const rows = await this.db
      .select()
      .from(datasetVersions)
      .where(eq(datasetVersions.datasetId, datasetId))
      .orderBy(desc(datasetVersions.number));
    return rows.map(toVersion);
  }

  async get(datasetId: string, number: number): Promise<DatasetVersion> {
    return toVersion(await this.requireVersion(datasetId, number));
  }

  async latest(datasetId: string): Promise<DatasetVersion | null> {
    const row = await this.db.query.datasetVersions.findFirst({
      where: eq(datasetVersions.datasetId, datasetId),
      orderBy: desc(datasetVersions.number),
    });
    return row ? toVersion(row) : null;
  }

  /** True when the draft differs from the latest version (or no version exists yet). */
  async hasUnpublishedChanges(datasetId: string): Promise<boolean> {
    const latest = await this.latest(datasetId);
    if (!latest) return true;
    const draft = await this.draftSnapshot(datasetId);
    return snapshotHash(draft) !== latest.snapshotHash;
  }

  async listItems(
    datasetId: string,
    number: number,
    query: PaginationQuery,
  ): Promise<Page<VersionItem>> {
    const version = await this.requireVersion(datasetId, number);
    const conds = [eq(versionItems.versionId, version.id)];
    if (query.cursor) {
      const [posStr, id] = query.cursor.split(":");
      const pos = Number(posStr);
      if (Number.isNaN(pos) || !id) throw new AppError("VALIDATION", "Invalid cursor");
      conds.push(
        or(
          gt(versionItems.position, pos),
          and(eq(versionItems.position, pos), gt(versionItems.itemId, id)),
        )!,
      );
    }
    const rows = await this.db
      .select({ vi: versionItems, rev: itemRevisions })
      .from(versionItems)
      .innerJoin(itemRevisions, eq(itemRevisions.id, versionItems.revisionId))
      .where(and(...conds))
      .orderBy(asc(versionItems.position), asc(versionItems.itemId))
      .limit(query.limit + 1);
    const page = rows.slice(0, query.limit).map((r) => toVersionItem(r.vi, r.rev));
    const last = page[page.length - 1];
    return {
      items: page,
      nextCursor: rows.length > query.limit && last ? `${last.position}:${last.itemId}` : null,
    };
  }

  /** All items of a version, in position order (used by runs and export). */
  async allItems(datasetId: string, number: number): Promise<VersionItem[]> {
    const version = await this.requireVersion(datasetId, number);
    return this.itemsOfVersion(version.id);
  }

  async diff(datasetId: string, from: VersionRef, to: VersionRef): Promise<VersionDiff> {
    await this.requireDataset(datasetId);
    const a = await this.snapshotFor(datasetId, from);
    const b = await this.snapshotFor(datasetId, to);
    const aById = new Map(a.map((e) => [e.itemId, e]));
    const bById = new Map(b.map((e) => [e.itemId, e]));
    const diff: VersionDiff = { from, to, added: [], removed: [], changed: [], unchanged: 0 };
    for (const e of b) {
      const prev = aById.get(e.itemId);
      if (!prev) diff.added.push(e);
      else if (prev.revisionId !== e.revisionId)
        diff.changed.push({ itemId: e.itemId, from: prev, to: e });
      else diff.unchanged++;
    }
    for (const e of a) if (!bById.has(e.itemId)) diff.removed.push(e);
    return diff;
  }

  /** JSON Lines export of a version: one {id, input, expected, metadata} per line. */
  async exportJsonl(datasetId: string, number: number): Promise<string> {
    const entries = await this.allItems(datasetId, number);
    return entries
      .map((e) =>
        JSON.stringify({
          id: e.itemId,
          input: e.input,
          expected: e.expected,
          metadata: e.metadata,
        }),
      )
      .join("\n");
  }

  // -- internals -------------------------------------------------------------------------------

  private async snapshotFor(datasetId: string, ref: VersionRef): Promise<VersionItem[]> {
    if (ref === "draft") return this.draftSnapshot(datasetId);
    const version = await this.requireVersion(datasetId, ref);
    return this.itemsOfVersion(version.id);
  }

  private async draftSnapshot(datasetId: string): Promise<VersionItem[]> {
    const rows = await this.db
      .select({ item: items, rev: itemRevisions })
      .from(items)
      .innerJoin(itemRevisions, eq(itemRevisions.id, items.headRevisionId))
      .where(and(eq(items.datasetId, datasetId), isNull(items.deletedAt)))
      .orderBy(asc(items.position), asc(items.id));
    return rows.map((r) => ({
      itemId: r.item.id,
      revisionId: r.rev.id,
      position: r.item.position,
      input: r.rev.input,
      expected: r.rev.expected ?? null,
      metadata: r.rev.metadata,
      expectedReviewed: r.item.expectedReviewedAt !== null,
    }));
  }

  private async itemsOfVersion(versionId: string): Promise<VersionItem[]> {
    const rows = await this.db
      .select({ vi: versionItems, rev: itemRevisions })
      .from(versionItems)
      .innerJoin(itemRevisions, eq(itemRevisions.id, versionItems.revisionId))
      .where(eq(versionItems.versionId, versionId))
      .orderBy(asc(versionItems.position), asc(versionItems.itemId));
    return rows.map((r) => toVersionItem(r.vi, r.rev));
  }

  private async requireDataset(datasetId: string): Promise<void> {
    const ds = await this.db.query.datasets.findFirst({
      where: eq(datasets.id, datasetId),
      columns: { id: true },
    });
    if (!ds) throw AppError.notFound("Dataset", datasetId);
  }

  private async requireVersion(datasetId: string, number: number): Promise<VersionRow> {
    const row = await this.db.query.datasetVersions.findFirst({
      where: and(eq(datasetVersions.datasetId, datasetId), eq(datasetVersions.number, number)),
    });
    if (!row) throw AppError.notFound("Version", `${datasetId}@v${number}`);
    return row;
  }
}

function toVersionItem(
  vi: typeof versionItems.$inferSelect,
  rev: typeof itemRevisions.$inferSelect,
): VersionItem {
  return {
    itemId: vi.itemId,
    revisionId: vi.revisionId,
    position: vi.position,
    input: rev.input,
    expected: rev.expected ?? null,
    metadata: rev.metadata,
    expectedReviewed: vi.expectedReviewed,
  };
}
