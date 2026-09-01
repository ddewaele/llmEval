import { eq } from "drizzle-orm";
import type { RunAggregates, ScorerSpec } from "@llmeval/shared";
import type { Db } from "../db/client.js";
import { runItems, scores } from "../db/schema.js";

export async function computeAggregates(
  db: Db,
  runId: string,
  specs: ScorerSpec[],
): Promise<RunAggregates> {
  const scoreRows = await db
    .select({
      key: scores.scorerKey,
      type: scores.scorerType,
      score: scores.score,
      passed: scores.passed,
      error: scores.error,
    })
    .from(scores)
    .innerJoin(runItems, eq(runItems.id, scores.runItemId))
    .where(eq(runItems.runId, runId));
  const byKey = new Map<
    string,
    {
      type: string;
      scored: number;
      errors: number;
      sum: number;
      passed: number;
      passReported: number;
    }
  >();
  for (const spec of specs)
    byKey.set(spec.key, {
      type: spec.type,
      scored: 0,
      errors: 0,
      sum: 0,
      passed: 0,
      passReported: 0,
    });
  for (const r of scoreRows) {
    const agg = byKey.get(r.key) ?? {
      type: r.type,
      scored: 0,
      errors: 0,
      sum: 0,
      passed: 0,
      passReported: 0,
    };
    byKey.set(r.key, agg);
    if (r.error !== null || r.score === null) {
      agg.errors++;
      continue;
    }
    agg.scored++;
    agg.sum += r.score;
    if (r.passed !== null) {
      agg.passReported++;
      if (r.passed) agg.passed++;
    }
  }
  const latencies = (
    await db.select({ ms: runItems.latencyMs }).from(runItems).where(eq(runItems.runId, runId))
  )
    .map((r) => r.ms)
    .filter((v): v is number => v !== null)
    .sort((a, b) => a - b);
  return {
    scorers: [...byKey.entries()].map(([key, a]) => ({
      key,
      type: a.type,
      scoredCount: a.scored,
      errorCount: a.errors,
      meanScore: a.scored ? round(a.sum / a.scored) : null,
      passRate: a.passReported ? round(a.passed / a.passReported) : null,
      passedCount: a.passed,
    })),
    latency: {
      meanMs: latencies.length
        ? Math.round(latencies.reduce((s, v) => s + v, 0) / latencies.length)
        : null,
      p50Ms: percentile(latencies, 0.5),
      p95Ms: percentile(latencies, 0.95),
    },
  };
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1);
  return sorted[Math.max(0, idx)]!;
}

const round = (n: number) => Math.round(n * 10_000) / 10_000;
