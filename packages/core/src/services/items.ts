import { and, asc, eq, gt, inArray, isNotNull, isNull, like, max, or, sql } from "drizzle-orm";
import {
  AppError,
  ItemMetadataSchema,
  type Item,
  type ItemMetadata,
  type JsonValue,
  type ListItemsQuery,
  type NewItem,
  type Page,
  type UpdateItem,
} from "@llmeval/shared";
import type { Db } from "../db/client.js";
import { datasets, itemRevisions, items } from "../db/schema.js";
import { contentHash } from "../util/hash.js";
import { newId } from "../util/ids.js";
import { nowIso } from "../util/time.js";

type ItemRow = typeof items.$inferSelect;
type RevisionRow = typeof itemRevisions.$inferSelect;

export function toItem(row: ItemRow, rev: RevisionRow): Item {
  return {
    id: row.id,
    datasetId: row.datasetId,
    revisionId: rev.id,
    position: row.position,
    input: rev.input,
    expected: rev.expected ?? null,
    metadata: rev.metadata,
    expectedSource: row.expectedSource ?? null,
    expectedModel: row.expectedModel ?? null,
    expectedRationale: row.expectedRationale ?? null,
    expectedReviewedAt: row.expectedReviewedAt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function encodeCursor(position: number, id: string): string {
  return `${position}:${id}`;
}
function decodeCursor(cursor: string): { position: number; id: string } {
  const idx = cursor.indexOf(":");
  const position = Number(cursor.slice(0, idx));
  const id = cursor.slice(idx + 1);
  if (idx < 0 || Number.isNaN(position) || !id) throw new AppError("VALIDATION", "Invalid cursor");
  return { position, id };
}

export class ItemService {
  constructor(private readonly db: Db) {}

  /** Bulk add items to the dataset's draft. Positions continue after the current maximum. */
  async add(datasetId: string, newItems: NewItem[]): Promise<Item[]> {
    await this.requireDataset(datasetId);
    if (newItems.length === 0) return [];
    const now = nowIso();
    const maxPos =
      (
        await this.db
          .select({ maxPos: max(items.position) })
          .from(items)
          .where(eq(items.datasetId, datasetId))
      )[0]?.maxPos ?? 0;
    let position = maxPos + 1;

    const itemRows: ItemRow[] = [];
    const revRows: RevisionRow[] = [];
    for (const n of newItems) {
      const metadata = ItemMetadataSchema.parse(n.metadata ?? {});
      const expected = n.expected ?? null;
      const itemId = newId();
      const rev: RevisionRow = {
        id: newId(),
        itemId,
        datasetId,
        contentHash: contentHash({ input: n.input, expected, metadata: metadata as JsonValue }),
        input: n.input,
        expected,
        metadata,
        createdAt: now,
      };
      itemRows.push({
        id: itemId,
        datasetId,
        headRevisionId: rev.id,
        position: position++,
        deletedAt: null,
        expectedSource: expected === null ? null : (n.expectedSource ?? "human"),
        expectedModel: null,
        expectedRationale: null,
        expectedReviewedAt:
          expected === null ? null : n.expectedSource === "generated" ? null : now,
        createdAt: now,
        updatedAt: now,
      });
      revRows.push(rev);
    }
    await this.db.transaction(async (tx) => {
      // Insert items first without head pointer to satisfy FK ordering, then revisions, then heads.
      for (const chunk of chunks(itemRows, 200)) {
        await tx.insert(items).values(chunk.map((r) => ({ ...r, headRevisionId: null })));
      }
      for (const chunk of chunks(revRows, 200)) await tx.insert(itemRevisions).values(chunk);
      for (const r of itemRows) {
        await tx.update(items).set({ headRevisionId: r.headRevisionId }).where(eq(items.id, r.id));
      }
      await tx.update(datasets).set({ updatedAt: now }).where(eq(datasets.id, datasetId));
    });
    return itemRows.map((r, i) => toItem(r, revRows[i]!));
  }

  async get(id: string): Promise<Item> {
    const row = await this.requireRow(id);
    const rev = await this.requireRevision(row.headRevisionId!);
    return toItem(row, rev);
  }

  async list(datasetId: string, query: ListItemsQuery): Promise<Page<Item>> {
    await this.requireDataset(datasetId);
    const conds = [eq(items.datasetId, datasetId), isNull(items.deletedAt)];
    if (query.filter === "missing_expected") conds.push(isNull(itemRevisions.expected));
    if (query.filter === "unreviewed") {
      conds.push(isNotNull(itemRevisions.expected), isNull(items.expectedReviewedAt));
    }
    if (query.filter === "reviewed") conds.push(isNotNull(items.expectedReviewedAt));
    if (query.tag) {
      conds.push(
        sql`exists (select 1 from json_each(${itemRevisions.metadata}, '$.tags') where value = ${query.tag})`,
      );
    }
    if (query.search) conds.push(like(itemRevisions.input, `%${escapeLike(query.search)}%`));
    if (query.cursor) {
      const c = decodeCursor(query.cursor);
      conds.push(
        or(
          gt(items.position, c.position),
          and(eq(items.position, c.position), gt(items.id, c.id)),
        )!,
      );
    }
    const rows = await this.db
      .select({ item: items, rev: itemRevisions })
      .from(items)
      .innerJoin(itemRevisions, eq(itemRevisions.id, items.headRevisionId))
      .where(and(...conds))
      .orderBy(asc(items.position), asc(items.id))
      .limit(query.limit + 1);
    const hasMore = rows.length > query.limit;
    const page = rows.slice(0, query.limit).map((r) => toItem(r.item, r.rev));
    const last = page[page.length - 1];
    return {
      items: page,
      nextCursor: hasMore && last ? encodeCursor(last.position, last.id) : null,
    };
  }

  /**
   * Update draft content. Creates a new immutable revision (no-op when content is unchanged)
   * and moves the head pointer. Editing `expected` marks it as human-provided and reviewed.
   */
  async update(id: string, patch: UpdateItem): Promise<Item> {
    const row = await this.requireRow(id);
    const head = await this.requireRevision(row.headRevisionId!);
    const input = patch.input ?? head.input;
    const expected = patch.expected === undefined ? (head.expected ?? null) : patch.expected;
    const metadata: ItemMetadata = ItemMetadataSchema.parse({
      ...head.metadata,
      ...patch.metadata,
    });
    const hash = contentHash({ input, expected, metadata: metadata as JsonValue });
    const now = nowIso();
    const expectedChanged = patch.expected !== undefined && hash !== head.contentHash;

    let revisionId = head.id;
    if (hash !== head.contentHash) {
      const existing = await this.db.query.itemRevisions.findFirst({
        where: and(eq(itemRevisions.itemId, id), eq(itemRevisions.contentHash, hash)),
      });
      if (existing) {
        revisionId = existing.id;
      } else {
        revisionId = newId();
        await this.db.insert(itemRevisions).values({
          id: revisionId,
          itemId: id,
          datasetId: row.datasetId,
          contentHash: hash,
          input,
          expected,
          metadata,
          createdAt: now,
        });
      }
    }
    const values: Partial<ItemRow> = { headRevisionId: revisionId, updatedAt: now };
    if (expectedChanged) {
      if (expected === null) {
        values.expectedSource = null;
        values.expectedModel = null;
        values.expectedRationale = null;
        values.expectedReviewedAt = null;
      } else {
        values.expectedSource = "human";
        values.expectedModel = null;
        values.expectedRationale = null;
        values.expectedReviewedAt = now;
      }
    }
    await this.db.update(items).set(values).where(eq(items.id, id));
    await this.db.update(datasets).set({ updatedAt: now }).where(eq(datasets.id, row.datasetId));
    return this.get(id);
  }

  /** Mark ground truths as reviewed (or clear the flag). Items without `expected` are skipped. */
  async review(ids: string[], approve: boolean): Promise<{ updated: number }> {
    if (ids.length === 0) return { updated: 0 };
    const rows = await this.db
      .select({ id: items.id })
      .from(items)
      .innerJoin(itemRevisions, eq(itemRevisions.id, items.headRevisionId))
      .where(
        and(inArray(items.id, ids), isNull(items.deletedAt), isNotNull(itemRevisions.expected)),
      );
    const targets = rows.map((r) => r.id);
    if (targets.length === 0) return { updated: 0 };
    const now = nowIso();
    await this.db
      .update(items)
      .set({ expectedReviewedAt: approve ? now : null, updatedAt: now })
      .where(inArray(items.id, targets));
    return { updated: targets.length };
  }

  /** Soft-delete from the draft. Published versions keep referencing the item. */
  async delete(ids: string[]): Promise<{ deleted: number }> {
    if (ids.length === 0) return { deleted: 0 };
    const now = nowIso();
    const res = await this.db
      .update(items)
      .set({ deletedAt: now, updatedAt: now })
      .where(and(inArray(items.id, ids), isNull(items.deletedAt)));
    return { deleted: Number(res.rowsAffected ?? 0) };
  }

  private async requireDataset(datasetId: string): Promise<void> {
    const ds = await this.db.query.datasets.findFirst({
      where: eq(datasets.id, datasetId),
      columns: { id: true },
    });
    if (!ds) throw AppError.notFound("Dataset", datasetId);
  }

  private async requireRow(id: string): Promise<ItemRow> {
    const row = await this.db.query.items.findFirst({
      where: and(eq(items.id, id), isNull(items.deletedAt)),
    });
    if (!row) throw AppError.notFound("Item", id);
    return row;
  }

  private async requireRevision(id: string): Promise<RevisionRow> {
    const rev = await this.db.query.itemRevisions.findFirst({ where: eq(itemRevisions.id, id) });
    if (!rev) throw new AppError("INTERNAL", `Revision ${id} missing`);
    return rev;
  }
}

function* chunks<T>(arr: T[], size: number): Generator<T[]> {
  for (let i = 0; i < arr.length; i += size) yield arr.slice(i, i + size);
}

function escapeLike(s: string): string {
  return s.replace(/[%_\\]/g, (m) => `\\${m}`);
}
