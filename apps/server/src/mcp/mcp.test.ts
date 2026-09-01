import { beforeEach, describe, expect, it } from "vitest";
import { createTestContext } from "@llmeval/core/test-utils";
import { createApp, type App } from "../app.js";

type JsonRpcResult = { result?: Record<string, unknown>; error?: { message: string } };

describe("MCP endpoint (stateless streamable HTTP)", () => {
  let app: App;
  let nextId = 1;

  beforeEach(async () => {
    const { services, config } = await createTestContext();
    app = createApp({ services, config });
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

    const models = await callTool("list_models", {});
    expect((models.data as Array<{ id: string }>).map((m) => m.id)).toContain(
      "anthropic:claude-opus-5",
    );
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
});
