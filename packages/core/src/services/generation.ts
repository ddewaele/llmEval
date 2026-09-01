import { and, eq, inArray, isNull } from "drizzle-orm";
import pLimit from "p-limit";
import {
  AppError,
  type GenerateGroundTruths,
  type GenerateItems,
  type GenerationResult,
  type ItemGenerationResult,
  type Job,
  type JsonObject,
  type JsonValue,
  type NewItem,
  type RenderedMessage,
} from "@llmeval/shared";
import type { Config } from "../config.js";
import type { Db } from "../db/client.js";
import { datasets, itemRevisions, items } from "../db/schema.js";
import type { ChatModelFactory } from "../llm/client.js";
import type { ModelRegistry } from "../llm/models.js";
import type { JobRunner } from "../runs/job-runner.js";
import { inputDedupKey } from "./import.js";
import type { ItemService } from "./items.js";
import type { JobService } from "./jobs.js";

const GT_SYSTEM =
  "You write the reference answer (ground truth) for one item of an LLM evaluation dataset. " +
  "Answer the item's input as correctly and completely as an expert would, following the task instructions. " +
  "Be precise and deterministic; do not add commentary outside the requested fields.";

export class GenerationService {
  constructor(
    private readonly db: Db,
    private readonly config: Config,
    private readonly models: ModelRegistry,
    private readonly factory: ChatModelFactory,
    private readonly jobs: JobRunner,
    private readonly jobService: JobService,
    private readonly itemService: ItemService,
  ) {}

  /** Generate ground truths for draft items lacking one (or for the given items) as a background job. */
  async generateGroundTruths(req: GenerateGroundTruths): Promise<Job> {
    const ds = await this.db.query.datasets.findFirst({
      where: eq(datasets.id, req.datasetId),
      columns: { id: true },
    });
    if (!ds) throw AppError.notFound("Dataset", req.datasetId);
    const modelId = req.model ?? this.config.GENERATION_MODEL;
    const info = this.models.resolve(modelId);

    const conds = [eq(items.datasetId, req.datasetId), isNull(items.deletedAt)];
    if (req.itemIds) conds.push(inArray(items.id, req.itemIds));
    const rows = await this.db
      .select({ id: items.id, input: itemRevisions.input, expected: itemRevisions.expected })
      .from(items)
      .innerJoin(itemRevisions, eq(itemRevisions.id, items.headRevisionId))
      .where(and(...conds));
    const targets = rows.filter((r) => r.expected === null || (req.itemIds && req.overwrite));
    const skipped = rows.length - targets.length;

    const job = await this.jobService.create("generate_ground_truths", req.datasetId, {
      model: info.id,
      itemCount: targets.length,
      instructions: req.instructions ?? null,
      overwrite: req.overwrite,
    });
    void this.jobs.start(job.id, async (signal) => {
      await this.jobService.markRunning(job.id);
      const result: GenerationResult = { generated: 0, failed: 0, skipped, errors: [] };
      try {
        const model = await this.factory.create(info.id, { temperature: 0 });
        const schema = wrapSchema(req.outputSchema);
        const limit = pLimit(req.concurrency);
        let done = 0;
        await Promise.all(
          targets.map((t) =>
            limit(async () => {
              if (signal.aborted) return;
              try {
                const res = await model.invokeStructured(
                  messagesFor(req.instructions, t.input),
                  schema,
                  {
                    signal,
                    timeoutMs: 120_000,
                  },
                );
                const out = res.output as { expected?: JsonValue; rationale?: string } | null;
                if (!out || out.expected === undefined)
                  throw new Error("Generator returned no `expected` field");
                await this.itemService.setGeneratedExpected(t.id, out.expected, {
                  model: info.id,
                  rationale: out.rationale ?? null,
                });
                result.generated++;
              } catch (err) {
                if (signal.aborted) return;
                result.failed++;
                result.errors.push({ itemId: t.id, message: (err as Error).message });
              } finally {
                done++;
                if (done % 5 === 0 || done === targets.length) {
                  await this.jobService.progress(job.id, {
                    done,
                    total: targets.length,
                    failed: result.failed,
                  });
                }
              }
            }),
          ),
        );
        const progress = { done, total: targets.length, failed: result.failed };
        if (signal.aborted)
          await this.jobService.finish(
            job.id,
            "cancelled",
            progress,
            result as unknown as JsonValue,
          );
        else
          await this.jobService.finish(
            job.id,
            "completed",
            progress,
            result as unknown as JsonValue,
          );
      } catch (err) {
        await this.jobService.fail(job.id, (err as Error).message);
      }
    });
    return this.jobService.get(job.id);
  }
}

const ITEMS_SYSTEM =
  "You generate test items for an LLM evaluation dataset. Produce realistic, diverse, non-duplicate items " +
  "that cover the described task including edge cases. Follow the input schema exactly. " +
  "Never repeat an existing or seed item; vary wording, entities, lengths and difficulty.";

export class ItemGenerator {
  constructor(
    private readonly db: Db,
    private readonly config: Config,
    private readonly models: ModelRegistry,
    private readonly factory: ChatModelFactory,
    private readonly jobs: JobRunner,
    private readonly jobService: JobService,
    private readonly itemService: ItemService,
  ) {}

  /** Generate synthetic items into the draft as a background job; duplicates (by normalised input) are dropped. */
  async generateItems(req: GenerateItems): Promise<Job> {
    const ds = await this.db.query.datasets.findFirst({ where: eq(datasets.id, req.datasetId) });
    if (!ds) throw AppError.notFound("Dataset", req.datasetId);
    const modelId = req.model ?? this.config.GENERATION_MODEL;
    const info = this.models.resolve(modelId);
    const inputSchema = req.inputSchema ?? ds.inputSchema ?? undefined;

    const existing = await this.db
      .select({ id: items.id, input: itemRevisions.input, expected: itemRevisions.expected })
      .from(items)
      .innerJoin(itemRevisions, eq(itemRevisions.id, items.headRevisionId))
      .where(and(eq(items.datasetId, req.datasetId), isNull(items.deletedAt)));
    const seeds = req.seedItemIds
      ? existing.filter((e) => req.seedItemIds!.includes(e.id))
      : existing.slice(0, 5);
    const seen = new Set(existing.map((e) => inputDedupKey(e.input)));

    const job = await this.jobService.create("generate_items", req.datasetId, {
      model: info.id,
      count: req.count,
      description: req.description,
    });
    void this.jobs.start(job.id, async (signal) => {
      await this.jobService.markRunning(job.id);
      const result: ItemGenerationResult = {
        generated: 0,
        duplicatesDropped: 0,
        rounds: 0,
        failedRounds: 0,
        errors: [],
        itemIds: [],
      };
      const progress = () => ({
        done: result.generated,
        total: req.count,
        duplicatesDropped: result.duplicatesDropped,
        rounds: result.rounds,
      });
      try {
        const model = await this.factory.create(info.id, { temperature: 0.9 });
        const schema = itemsSchema(inputSchema, req.withExpected, req.expectedSchema);
        let uselessRounds = 0;
        const recent: JsonValue[] = [];
        while (
          result.generated < req.count &&
          uselessRounds < 3 &&
          result.failedRounds < 3 &&
          !signal.aborted
        ) {
          result.rounds++;
          const want = Math.min(req.batchSize, req.count - result.generated);
          try {
            const res = await model.invokeStructured(
              itemsPrompt(
                req.description,
                want,
                seeds,
                [...existing.slice(0, 20).map((e) => e.input), ...recent].slice(-30),
                inputSchema,
                req.withExpected,
              ),
              schema,
              { signal, timeoutMs: 180_000 },
            );
            const out = res.output as {
              items?: Array<{ input: JsonValue; expected?: JsonValue; rationale?: string }>;
            } | null;
            const candidates = (out?.items ?? []).filter(
              (c) => c && c.input !== undefined && c.input !== null && c.input !== "",
            );
            const fresh: NewItem[] = [];
            for (const c of candidates) {
              const key = inputDedupKey(c.input);
              if (seen.has(key)) {
                result.duplicatesDropped++;
                continue;
              }
              seen.add(key);
              recent.push(c.input);
              const hasExpected =
                req.withExpected && c.expected !== undefined && c.expected !== null;
              fresh.push({
                input: c.input,
                ...(hasExpected
                  ? {
                      expected: c.expected as JsonValue,
                      expectedSource: "generated" as const,
                      expectedRationale: c.rationale,
                    }
                  : {}),
                metadata: { source: "synthetic", tags: req.tags ?? [], jobId: job.id },
              });
              if (result.generated + fresh.length >= req.count) break;
            }
            if (fresh.length === 0) uselessRounds++;
            else {
              uselessRounds = 0;
              const created = await this.itemService.add(req.datasetId, fresh, {
                expectedModel: info.id,
              });
              result.generated += created.length;
              result.itemIds.push(...created.map((i) => i.id));
            }
          } catch (err) {
            if (signal.aborted) break;
            result.failedRounds++;
            result.errors.push((err as Error).message);
          }
          await this.jobService.progress(job.id, progress());
        }
        const status = signal.aborted
          ? "cancelled"
          : result.generated === 0 && result.failedRounds === result.rounds
            ? "failed"
            : "completed";
        if (status === "failed")
          await this.jobService.fail(
            job.id,
            result.errors[result.errors.length - 1] ?? "generation failed",
          );
        else
          await this.jobService.finish(job.id, status, progress(), result as unknown as JsonValue);
      } catch (err) {
        await this.jobService.fail(job.id, (err as Error).message);
      }
    });
    return this.jobService.get(job.id);
  }
}

function itemsSchema(
  inputSchema: JsonObject | undefined,
  withExpected: boolean,
  expectedSchema: JsonObject | undefined,
): JsonObject {
  const item: JsonObject = {
    type: "object",
    properties: {
      input: inputSchema ?? { type: "string", description: "The test input" },
      ...(withExpected
        ? {
            expected: expectedSchema ?? {
              type: "string",
              description: "The correct answer for this input",
            },
            rationale: {
              type: "string",
              description: "Why this is the correct answer (one sentence)",
            },
          }
        : {}),
    },
    required: withExpected ? ["input", "expected"] : ["input"],
    additionalProperties: false,
  };
  return {
    type: "object",
    properties: { items: { type: "array", items: item } },
    required: ["items"],
    additionalProperties: false,
  };
}

function itemsPrompt(
  description: string,
  count: number,
  seeds: Array<{ input: JsonValue; expected: JsonValue | null }>,
  avoid: JsonValue[],
  inputSchema: JsonObject | undefined,
  withExpected: boolean,
): RenderedMessage[] {
  const fmt = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v));
  const parts = [
    `## Dataset description\n${description}`,
    inputSchema ? `## Input schema\n${JSON.stringify(inputSchema)}` : null,
    seeds.length
      ? `## Example items\n${seeds.map((s) => `- input: ${fmt(s.input)}${s.expected !== null ? `\n  expected: ${fmt(s.expected)}` : ""}`).join("\n")}`
      : null,
    avoid.length
      ? `## Existing inputs (do not repeat or paraphrase)\n${avoid.map((a) => `- ${fmt(a).slice(0, 200)}`).join("\n")}`
      : null,
    `Generate ${count} new items${withExpected ? " with their expected answers" : ""}. Return JSON {items: [...]}.`,
  ].filter((p): p is string => p !== null);
  return [
    { role: "system", content: ITEMS_SYSTEM },
    { role: "user", content: parts.join("\n\n") },
  ];
}

function messagesFor(instructions: string | undefined, input: JsonValue): RenderedMessage[] {
  const parts = [
    instructions ? `## Task instructions\n${instructions}` : null,
    `## Item input\n${typeof input === "string" ? input : JSON.stringify(input, null, 2)}`,
    "Return JSON with `expected` (the reference answer) and a short `rationale`.",
  ].filter((p): p is string => p !== null);
  return [
    { role: "system", content: GT_SYSTEM },
    { role: "user", content: parts.join("\n\n") },
  ];
}

/** Wrap the caller's schema for `expected` so the model also returns a rationale. */
export function wrapSchema(expectedSchema: JsonObject | undefined): JsonObject {
  return {
    type: "object",
    properties: {
      expected: expectedSchema ?? { type: "string", description: "The reference answer" },
      rationale: {
        type: "string",
        description: "One or two sentences on why this is the correct answer",
      },
    },
    required: ["expected", "rationale"],
    additionalProperties: false,
  };
}
