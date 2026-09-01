import { and, eq, inArray, isNull } from "drizzle-orm";
import pLimit from "p-limit";
import {
  AppError,
  type GenerateGroundTruths,
  type GenerationResult,
  type Job,
  type JsonObject,
  type JsonValue,
  type RenderedMessage,
} from "@llmeval/shared";
import type { Config } from "../config.js";
import type { Db } from "../db/client.js";
import { datasets, itemRevisions, items } from "../db/schema.js";
import type { ChatModelFactory } from "../llm/client.js";
import type { ModelRegistry } from "../llm/models.js";
import type { JobRunner } from "../runs/job-runner.js";
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
