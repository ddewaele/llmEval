import { beforeEach, describe, expect, it } from "vitest";
import type { Services } from "@llmeval/core";
import { createTestContext } from "@llmeval/core/test-utils";
import { createApp, type App } from "../app.js";

type JsonRpcResult = { result?: Record<string, unknown>; error?: { message: string } };

describe("MCP endpoint (stateless streamable HTTP)", () => {
  let app: App;
  let services: Services;
  let nextId = 1;

  beforeEach(async () => {
    ({ services } = await createTestContext());
    app = createApp({ services, config: services.config });
  });

  async function rpc(method: string, params: Record<string, unknown> = {}): Promise<JsonRpcResult> {
    const res = await app.request("/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
    });
    expect(res.status).toBe(200);
    return (await res.json()) as JsonRpcResult;
  }

  async function callTool(name: string, args: Record<string, unknown>) {
    const r = await rpc("tools/call", { name, arguments: args });
    const result = r.result as { isError?: boolean; content: Array<{ text: string }> };
    const text = result.content[0]!.text;
    return {
      isError: result.isError ?? false,
      text,
      data: result.isError ? undefined : (JSON.parse(text) as unknown),
    };
  }

  it("initializes and lists tools with descriptions and JSON schemas", async () => {
    const init = await rpc("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "0" },
    });
    expect((init.result as { serverInfo: { name: string } }).serverInfo.name).toBe("llmeval");

    const tools = (await rpc("tools/list")).result as {
      tools: Array<{ name: string; description: string; inputSchema: { properties: object } }>;
    };
    const names = tools.tools.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "list_datasets",
        "create_dataset",
        "add_items",
        "list_items",
        "list_models",
      ]),
    );
    const addItems = tools.tools.find((t) => t.name === "add_items")!;
    expect(addItems.description).toMatch(/draft/);
    expect(Object.keys(addItems.inputSchema.properties)).toEqual(["datasetId", "items"]);
  });

  it("drives the dataset/item lifecycle through tool calls", async () => {
    const created = await callTool("create_dataset", { name: "sap-codes", tags: ["sap"] });
    expect(created.isError).toBe(false);
    const ds = created.data as { id: string };

    const added = await callTool("add_items", {
      datasetId: ds.id,
      items: [
        {
          input: { subject: "Order", body: "Need 5x ABC-123" },
          expected: { productCodes: ["ABC-123"] },
        },
        { input: "x".repeat(500) },
      ],
    });
    expect((added.data as { added: number }).added).toBe(2);

    const listed = await callTool("list_items", { datasetId: ds.id, limit: 10 });
    const page = listed.data as { items: Array<{ id: string; input: unknown }>; nextCursor: null };
    expect(page.items).toHaveLength(2);
    expect(page.items[1]!.input).toMatch(/… \[300 more chars\]$/);

    const missing = await callTool("list_items", { datasetId: ds.id, filter: "missing_expected" });
    expect((missing.data as { items: unknown[] }).items).toHaveLength(1);

    const summary = await callTool("get_dataset", { id: ds.id });
    expect((summary.data as { draftItemCount: number }).draftItemCount).toBe(2);

    const published = await callTool("publish_version", { datasetId: ds.id, notes: "initial" });
    expect((published.data as { version: { number: number } }).version.number).toBe(1);
    await callTool("update_item", {
      id: page.items[0]!.id,
      expected: { productCodes: [] },
    });
    const diff = await callTool("diff_versions", { datasetId: ds.id, from: 1 });
    expect((diff.data as { changed: unknown[] }).changed).toHaveLength(1);
    const frozen = await callTool("list_items", { datasetId: ds.id, versionNumber: 1 });
    expect((frozen.data as { items: unknown[] }).items).toHaveLength(2);
    const versions = await callTool("list_versions", { datasetId: ds.id });
    expect((versions.data as Array<{ notes: string }>)[0]!.notes).toBe("initial");

    const started = await callTool("start_run", {
      datasetId: ds.id,
      userTemplate: "{{body}}",
      name: "mcp run",
      scorers: [{ key: "exact", type: "exact_match" }],
    });
    expect(started.isError).toBe(false);
    const run = started.data as { id: string; versionNumber: number; triggeredBy: string };
    expect(run.versionNumber).toBe(2);
    expect(run.triggeredBy).toBe("mcp");
    await services.runs.wait(run.id);
    const got = await callTool("get_run", { id: run.id });
    expect((got.data as { status: string; completedItems: number }).status).toBe("completed");
    const results = await callTool("list_run_items", { runId: run.id, status: "completed" });
    expect((results.data as { items: Array<{ scores: unknown[] }> }).items[0]!.scores).toHaveLength(
      1,
    );
    expect((got.data as { aggregates: { scorers: unknown[] } }).aggregates.scorers).toHaveLength(1);
    const rescore = await callTool("score_run", {
      runId: run.id,
      scorer: { key: "has", type: "contains", config: { needle: "echo" } },
    });
    const job = rescore.data as { id: string; kind: string };
    expect(job.kind).toBe("rescore");
    await services.jobs$.wait(job.id);
    expect(((await callTool("get_job", { id: job.id })).data as { status: string }).status).toBe(
      "completed",
    );
    expect(((await callTool("list_scorers", {})).data as unknown[]).length).toBeGreaterThanOrEqual(
      7,
    );

    const second = await callTool("start_run", { datasetId: ds.id, userTemplate: "{{body}}" });

    await services.runs.wait((second.data as { id: string }).id);

    const cmp = await callTool("compare_runs", {
      a: run.id,
      b: (second.data as { id: string }).id,
    });

    expect((cmp.data as { summary: { compared: number } }).summary.compared).toBe(2);

    const gen = await callTool("generate_ground_truths", {
      datasetId: ds.id,
      instructions: "Extract codes.",
    });

    expect((gen.data as { kind: string }).kind).toBe("generate_ground_truths");

    await services.jobs$.wait((gen.data as { id: string }).id);

    expect(
      (
        (await callTool("get_job", { id: (gen.data as { id: string }).id })).data as {
          status: string;
        }
      ).status,
    ).toBe("completed");

    const synth = await callTool("generate_items", {
      datasetId: ds.id,
      description: "More mails",
      count: 1,
    });

    expect((synth.data as { kind: string }).kind).toBe("generate_items");

    await services.jobs$.wait((synth.data as { id: string }).id);

    const models = await callTool("list_models", {});
    const catalog = models.data as {
      models: Array<{ id: string }>;
      defaults: { generation: { effective: string | null } };
    };
    expect(catalog.models.map((m) => m.id)).toContain("anthropic:claude-opus-5");
    expect(catalog.defaults.generation.effective).toBe("anthropic:claude-opus-5");
  });

  it("returns isError results for domain errors and validation problems", async () => {
    const notFound = await callTool("get_dataset", { id: "missing" });
    expect(notFound.isError).toBe(true);
    expect(notFound.text).toBe("NOT_FOUND: Dataset missing not found");

    const r = await rpc("tools/call", { name: "create_dataset", arguments: { name: "" } });
    const result = r.result as { isError: boolean; content: Array<{ text: string }> };
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toMatch(/name|Invalid/i);
  });

  it("exposes resources and prompts", async () => {
    const created = await callTool("create_dataset", { name: "res" });
    const ds = created.data as { id: string };
    await callTool("add_items", { datasetId: ds.id, items: [{ input: "q", expected: "a" }] });
    await callTool("publish_version", { datasetId: ds.id });
    const started = await callTool("start_run", {
      datasetId: ds.id,
      scorers: [{ key: "exact", type: "exact_match" }],
    });
    const run = started.data as { id: string };
    await services.runs.wait(run.id);

    const templates = (await rpc("resources/templates/list")).result as {
      resourceTemplates: Array<{ uriTemplate: string }>;
    };
    expect(templates.resourceTemplates.map((t) => t.uriTemplate)).toEqual(
      expect.arrayContaining(["llmeval://datasets/{id}", "llmeval://runs/{id}/failures"]),
    );
    const list = (await rpc("resources/list")).result as { resources: Array<{ uri: string }> };
    expect(list.resources.map((r) => r.uri)).toContain("llmeval://datasets");

    const summary = (await rpc("resources/read", { uri: `llmeval://datasets/${ds.id}` }))
      .result as {
      contents: Array<{ text: string }>;
    };
    expect(JSON.parse(summary.contents[0]!.text)).toMatchObject({
      dataset: { id: ds.id },
      versions: [{ number: 1 }],
    });
    const jsonl = (
      await rpc("resources/read", { uri: `llmeval://datasets/${ds.id}/versions/1/items` })
    ).result as {
      contents: Array<{ text: string; mimeType: string }>;
    };
    expect(jsonl.contents[0]!.mimeType).toBe("application/jsonl");
    expect(JSON.parse(jsonl.contents[0]!.text)).toMatchObject({ input: "q" });
    const failures = (await rpc("resources/read", { uri: `llmeval://runs/${run.id}/failures` }))
      .result as {
      contents: Array<{ text: string }>;
    };
    expect(JSON.parse(failures.contents[0]!.text)).toMatchObject({ failing: 1 });

    const prompts = (await rpc("prompts/list")).result as { prompts: Array<{ name: string }> };
    expect(prompts.prompts.map((p) => p.name).sort()).toEqual([
      "build_eval",
      "triage_run",
      "write_rubric",
    ]);
    const triage = (await rpc("prompts/get", { name: "triage_run", arguments: { runId: run.id } }))
      .result as {
      messages: Array<{ content: { text: string } }>;
    };
    expect(triage.messages[0]!.content.text).toMatch(new RegExp(`Triage run ${run.id}`));
    const build = (
      await rpc("prompts/get", {
        name: "build_eval",
        arguments: { task: "extract codes", samplePath: "/tmp/x.xlsx" },
      })
    ).result as {
      messages: Array<{ content: { text: string } }>;
    };
    expect(build.messages[0]!.content.text).toMatch(/import_items with dryRun=true/);
  });
});
