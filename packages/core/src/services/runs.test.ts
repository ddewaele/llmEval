import { beforeEach, describe, expect, it } from "vitest";
import {
  ListRunItemsQuerySchema,
  ListRunsQuerySchema,
  StartRunSchema,
  type RunEvent,
} from "@llmeval/shared";
import { eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { runItems, runs as runsTable } from "../db/schema.js";
import { createTestContext, FakeModelFactory } from "../test-utils.js";
import type { Services } from "./index.js";

const start = (s: Services, extra: Record<string, unknown>) =>
  s.runs.start(StartRunSchema.parse(extra));

describe("RunService + RunEngine", () => {
  let s: Services;
  let db: Db;
  let factory: FakeModelFactory;
  let datasetId: string;

  beforeEach(async () => {
    factory = new FakeModelFactory();
    ({ services: s, db } = await createTestContext({}, { modelFactory: factory }));
    datasetId = (await s.datasets.create({ name: "ds" })).id;
    await s.items.add(datasetId, [
      { input: { body: "Need ABC-1" }, expected: ["ABC-1"] },
      { input: { body: "Need XYZ-9" }, expected: ["XYZ-9"] },
      { input: "plain question", expected: "answer" },
    ]);
  });

  it("auto-publishes, executes every item, captures usage and cost, emits events", async () => {
    const events: RunEvent[] = [];
    const run = await start(s, {
      datasetId,
      model: "anthropic:claude-opus-5",
      systemPrompt: "Extract codes.",
      userTemplate: "Mail: {{body}}",
      concurrency: 2,
      triggeredBy: "mcp",
    });
    const unsubscribe = s.runs.subscribe(run.id, (e) => events.push(e));
    expect(run.versionNumber).toBe(1);
    expect((await s.versions.list(datasetId))[0]!.label).toBe("auto");
    await s.runs.wait(run.id);
    unsubscribe();

    const done = await s.runs.get(run.id);
    expect(done.status).toBe("completed");
    expect(done.completedItems).toBe(3);
    expect(done.failedItems).toBe(0);
    expect(done.inputTokens).toBe(30);
    expect(done.outputTokens).toBe(15);
    // 30 * $5/M + 15 * $25/M
    expect(done.costUsd).toBeCloseTo(0.000525, 9);
    expect(done.startedAt).not.toBeNull();
    expect(done.finishedAt).not.toBeNull();
    expect(events.some((e) => e.type === "run" && e.status === "completed")).toBe(true);
    expect(events.filter((e) => e.type === "item")).toHaveLength(3);

    const items = await s.runs.listItems(run.id, ListRunItemsQuerySchema.parse({}));
    expect(items.items.map((i) => i.output)).toEqual([
      "echo: Mail: Need ABC-1",
      "echo: Mail: Need XYZ-9",
      "echo: Mail: ",
    ]);
    expect(items.items[0]!.renderedMessages).toEqual([
      { role: "system", content: "Extract codes." },
      { role: "user", content: "Mail: Need ABC-1" },
    ]);
    expect(items.items[2]!.rawResponse).toMatchObject({ warnings: ["userTemplate: missing body"] });
    expect(items.items[0]!.latencyMs).toBeGreaterThanOrEqual(0);
    expect(items.items[0]!.expected).toEqual(["ABC-1"]);
    expect(factory.calls).toHaveLength(3);

    // Second run on unchanged draft reuses v1
    const run2 = await start(s, { datasetId });
    await s.runs.wait(run2.id);
    expect(run2.versionNumber).toBe(1);
    expect((await s.runs.list(ListRunsQuerySchema.parse({ datasetId }))).items).toHaveLength(2);
  });

  it("uses structured output when an outputSchema is set", async () => {
    factory.replyFor = () => ({
      output: { productCodes: ["ABC-1"] },
      inputTokens: 1,
      outputTokens: 1,
    });
    const run = await start(s, {
      datasetId,
      outputSchema: { type: "object", properties: { productCodes: { type: "array" } } },
    });
    await s.runs.wait(run.id);
    expect(factory.calls[0]!.schema).toEqual({
      type: "object",
      properties: { productCodes: { type: "array" } },
    });
    const [first] = (await s.runs.listItems(run.id, ListRunItemsQuerySchema.parse({}))).items;
    expect(first!.output).toEqual({ productCodes: ["ABC-1"] });
  });

  it("retries transient errors, isolates permanent failures and records attempts", async () => {
    let transient = 0;
    factory.replyFor = (call) => {
      const text = JSON.stringify(call.messages);
      if (text.includes("ABC-1") && transient++ < 2) {
        return { error: Object.assign(new Error("rate limited"), { status: 429 }) };
      }
      if (text.includes("XYZ-9"))
        return { error: Object.assign(new Error("bad request"), { status: 400 }) };
      return { output: "ok", inputTokens: 1, outputTokens: 1 };
    };
    const run = await start(s, { datasetId, userTemplate: "{{body}}" });
    await s.runs.wait(run.id);
    const done = await s.runs.get(run.id);
    expect(done.status).toBe("completed");
    expect(done.completedItems).toBe(2);
    expect(done.failedItems).toBe(1);
    const items = (await s.runs.listItems(run.id, ListRunItemsQuerySchema.parse({}))).items;
    expect(items[0]!.attempt).toBe(3);
    expect(items[0]!.status).toBe("completed");
    expect(items[1]!.status).toBe("failed");
    expect(items[1]!.error).toBe("bad request");
    expect(items[1]!.attempt).toBe(1);
    const failedOnly = await s.runs.listItems(
      run.id,
      ListRunItemsQuerySchema.parse({ status: "failed" }),
    );
    expect(failedOnly.items).toHaveLength(1);
  });

  it("cancels in-flight work and resumes the remaining items", async () => {
    let hangs = 0;
    factory.replyFor = () => (hangs++ < 1 ? { hang: true } : { output: "late", inputTokens: 1 });
    const run = await start(s, { datasetId, concurrency: 1 });
    await new Promise((r) => setTimeout(r, 30));
    const cancelled = await s.runs.cancel(run.id);
    expect(cancelled.status).toBe("cancelled");
    const after = (await s.runs.listItems(run.id, ListRunItemsQuerySchema.parse({}))).items;
    expect(after.map((i) => i.status).sort()).toEqual(["cancelled", "pending", "pending"]);

    await expect(s.runs.cancel(run.id)).rejects.toMatchObject({ code: "INVALID_STATE" });
    const resumed = await s.runs.resume(run.id);
    expect(["pending", "running"]).toContain(resumed.status);
    await s.runs.wait(run.id);
    const done = await s.runs.get(run.id);
    expect(done.status).toBe("completed");
    expect(done.completedItems).toBe(3);
  });

  it("fails the run when the cost cap is exceeded", async () => {
    factory.replyFor = () => ({ output: "x", inputTokens: 1_000_000, outputTokens: 0 });
    const run = await start(s, { datasetId, concurrency: 1, maxCostUsd: 1 });
    await s.runs.wait(run.id);
    const done = await s.runs.get(run.id);
    expect(done.status).toBe("failed");
    expect(done.error).toMatch(/cost exceeded/);
    expect(done.completedItems).toBeLessThan(3);
  });

  it("recovers runs left running by a crash", async () => {
    const run = await start(s, { datasetId });
    await s.runs.wait(run.id);
    // Simulate a crash mid-run: one item still "running", one back to "pending".
    await db
      .update(runsTable)
      .set({ status: "running", completedItems: 1 })
      .where(eq(runsTable.id, run.id));
    const ids = (
      await db.select({ id: runItems.id }).from(runItems).where(eq(runItems.runId, run.id))
    ).map((r) => r.id);
    await db.update(runItems).set({ status: "running" }).where(eq(runItems.id, ids[0]!));
    await db.update(runItems).set({ status: "pending" }).where(eq(runItems.id, ids[1]!));

    const res = await s.runs.recover();
    expect(res.resumed).toEqual([run.id]);
    await s.runs.wait(run.id);
    const done = await s.runs.get(run.id);
    expect(done.status).toBe("completed");
    expect(done.completedItems).toBe(3);
    expect(factory.calls).toHaveLength(5);
  });

  it("validates model, version and scorer keys up front", async () => {
    await expect(start(s, { datasetId, model: "openai:gpt-5" })).rejects.toMatchObject({
      code: "INVALID_STATE",
    });
    await expect(start(s, { datasetId, versionNumber: 4 })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      start(s, {
        datasetId,
        scorers: [
          { key: "a", type: "exact_match" },
          { key: "a", type: "contains" },
        ],
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });
});
