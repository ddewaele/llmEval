import { and, eq, inArray } from "drizzle-orm";
import {
  AppError,
  type ComparedItem,
  type CompareRunsQuery,
  type RunComparison,
} from "@llmeval/shared";
import type { Db } from "../db/client.js";
import { itemRevisions, runItems, scores, versionItems } from "../db/schema.js";
import type { RunService } from "./runs.js";

type Side = NonNullable<ComparedItem["a"]>;

export class CompareService {
  constructor(
    private readonly db: Db,
    private readonly runService: RunService,
  ) {}

  async compare(query: CompareRunsQuery): Promise<RunComparison> {
    if (query.a === query.b) throw new AppError("VALIDATION", "Pick two different runs");
    const [a, b] = await Promise.all([this.runService.get(query.a), this.runService.get(query.b)]);
    if (a.datasetId !== b.datasetId) {
      throw new AppError("VALIDATION", "Runs belong to different datasets and cannot be compared");
    }
    const [sidesA, sidesB] = await Promise.all([this.sides(a.id), this.sides(b.id)]);

    const itemIds = new Set([...sidesA.keys(), ...sidesB.keys()]);
    const meta = await this.itemMeta([...itemIds], b.versionId, a.versionId);
    const keys = query.scorerKey ? [query.scorerKey] : scorerKeys(a, b);

    const items: ComparedItem[] = [];
    let regressions = 0;
    let improvements = 0;
    let onlyInA = 0;
    let onlyInB = 0;
    for (const itemId of itemIds) {
      const sa = sidesA.get(itemId) ?? null;
      const sb = sidesB.get(itemId) ?? null;
      if (!sa) onlyInB++;
      if (!sb) onlyInA++;
      const m = meta.get(itemId);
      const deltas: Record<string, number | null> = {};
      let regression = false;
      let improvement = false;
      for (const key of keys) {
        const va = sa?.scores[key] ?? null;
        const vb = sb?.scores[key] ?? null;
        deltas[key] = va === null || vb === null ? null : round(vb - va);
        const pa = sa?.passed[key] ?? null;
        const pb = sb?.passed[key] ?? null;
        if ((deltas[key] !== null && deltas[key]! < 0) || (pa === true && pb === false))
          regression = true;
        if ((deltas[key] !== null && deltas[key]! > 0) || (pa === false && pb === true))
          improvement = true;
      }
      if (sa && sb && sa.status === "completed" && sb.status !== "completed") regression = true;
      if (regression) regressions++;
      if (improvement) improvements++;
      if (query.onlyRegressions && !regression) continue;
      items.push({
        itemId,
        position: m?.position ?? 0,
        input: m?.input ?? null,
        expected: m?.expected ?? null,
        a: sa,
        b: sb,
        deltas,
        regression,
        improvement,
      });
    }
    items.sort((x, y) => x.position - y.position);

    const aggA = new Map(a.aggregates.scorers.map((s) => [s.key, s]));
    const aggB = new Map(b.aggregates.scorers.map((s) => [s.key, s]));
    const aggregateDeltas = keys.map((key) => {
      const x = aggA.get(key);
      const y = aggB.get(key);
      return {
        key,
        meanScoreA: x?.meanScore ?? null,
        meanScoreB: y?.meanScore ?? null,
        meanScoreDelta: diff(x?.meanScore, y?.meanScore),
        passRateA: x?.passRate ?? null,
        passRateB: y?.passRate ?? null,
        passRateDelta: diff(x?.passRate, y?.passRate),
      };
    });

    return {
      a,
      b,
      sameVersion: a.versionId === b.versionId,
      aggregateDeltas,
      latencyDeltaMs: diff(a.aggregates.latency.meanMs, b.aggregates.latency.meanMs),
      costDeltaUsd: diff(a.costUsd, b.costUsd),
      summary: { compared: itemIds.size, regressions, improvements, onlyInA, onlyInB },
      items: items.slice(0, query.limit),
      truncated: items.length > query.limit,
    };
  }

  private async sides(runId: string): Promise<Map<string, Side>> {
    const rows = await this.db
      .select({
        id: runItems.id,
        itemId: runItems.itemId,
        status: runItems.status,
        output: runItems.output,
        error: runItems.error,
        latencyMs: runItems.latencyMs,
      })
      .from(runItems)
      .where(eq(runItems.runId, runId));
    const map = new Map<string, Side>();
    for (const r of rows) {
      map.set(r.itemId, {
        runItemId: r.id,
        status: r.status,
        output: r.output ?? null,
        error: r.error ?? null,
        latencyMs: r.latencyMs ?? null,
        scores: {},
        passed: {},
      });
    }
    if (rows.length) {
      const scoreRows = await this.db
        .select({
          runItemId: scores.runItemId,
          key: scores.scorerKey,
          score: scores.score,
          passed: scores.passed,
        })
        .from(scores)
        .where(
          inArray(
            scores.runItemId,
            rows.map((r) => r.id),
          ),
        );
      const byRunItem = new Map(rows.map((r) => [r.id, r.itemId]));
      for (const s of scoreRows) {
        const side = map.get(byRunItem.get(s.runItemId)!);
        if (!side) continue;
        side.scores[s.key] = s.score ?? null;
        side.passed[s.key] = s.passed ?? null;
      }
    }
    return map;
  }

  /** Input/expected/position per item, preferring run b's version, falling back to a's. */
  private async itemMeta(itemIds: string[], preferVersion: string, fallbackVersion: string) {
    const meta = new Map<
      string,
      { position: number; input: ComparedItem["input"]; expected: ComparedItem["expected"] }
    >();
    if (itemIds.length === 0) return meta;
    for (const versionId of [fallbackVersion, preferVersion]) {
      const rows = await this.db
        .select({
          itemId: versionItems.itemId,
          position: versionItems.position,
          rev: itemRevisions,
        })
        .from(versionItems)
        .innerJoin(itemRevisions, eq(itemRevisions.id, versionItems.revisionId))
        .where(and(eq(versionItems.versionId, versionId), inArray(versionItems.itemId, itemIds)));
      for (const r of rows) {
        meta.set(r.itemId, {
          position: r.position,
          input: r.rev.input,
          expected: r.rev.expected ?? null,
        });
      }
    }
    return meta;
  }
}

function scorerKeys(
  a: { scorers: Array<{ key: string }> },
  b: { scorers: Array<{ key: string }> },
): string[] {
  const keys = new Set<string>();
  for (const s of a.scorers) keys.add(s.key);
  for (const s of b.scorers) keys.add(s.key);
  return [...keys];
}

const round = (n: number) => Math.round(n * 10_000) / 10_000;
const diff = (x: number | null | undefined, y: number | null | undefined) =>
  x === null || x === undefined || y === null || y === undefined ? null : round(y - x);
