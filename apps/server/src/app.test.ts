import { beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "@llmeval/core";
import { createTestContext } from "@llmeval/core/test-utils";
import { createApp, type App } from "./app.js";

const jsonReq = (method: string, body: unknown) => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

describe("REST API", () => {
  let app: App;
  beforeEach(async () => {
    const { services } = await createTestContext();
    app = createApp({ services, config: loadConfig({}) });
  });

  it("serves health and a valid OpenAPI 3.1 document", async () => {
    expect(await (await app.request("/api/health")).json()).toEqual({ ok: true });
    const catalog = (await (await app.request("/api/models")).json()) as {
      models: Array<{ id: string }>;
      defaults: { default: { effective: string | null } };
      ollama: { reachable: boolean | null };
    };
    expect(catalog.models.map((m) => m.id)).toContain("anthropic:claude-opus-5");
    expect(catalog.defaults.default.effective).toBe("anthropic:claude-opus-5");
    expect(catalog.ollama.reachable).toBeNull();
    const res = await app.request("/openapi.json");
    expect(res.status).toBe(200);
    const doc = (await res.json()) as { openapi: string; paths: Record<string, unknown> };
    expect(doc.openapi).toBe("3.1.0");
    expect(Object.keys(doc.paths)).toEqual(
      expect.arrayContaining(["/api/datasets", "/api/datasets/{id}/items", "/api/items/{id}"]),
    );
  });

  it("runs the dataset and item lifecycle over HTTP", async () => {
    const created = await app.request(
      "/api/datasets",
      jsonReq("POST", { name: "ds", tags: ["a"] }),
    );
    expect(created.status).toBe(201);
    const ds = (await created.json()) as { id: string };

    const add = await app.request(
      `/api/datasets/${ds.id}/items`,
      jsonReq("POST", { items: [{ input: "q1", expected: "a1" }, { input: { q: "q2" } }] }),
    );
    expect(add.status).toBe(201);
    const { items } = (await add.json()) as { items: Array<{ id: string }> };
    expect(items).toHaveLength(2);

    const list = await app.request(`/api/datasets/${ds.id}/items?limit=1&filter=missing_expected`);
    const page = (await list.json()) as {
      items: Array<{ input: unknown }>;
      nextCursor: string | null;
    };
    expect(page.items[0]!.input).toEqual({ q: "q2" });
    expect(page.nextCursor).toBeNull();

    const patched = await app.request(
      `/api/items/${items[1]!.id}`,
      jsonReq("PATCH", { expected: "a2" }),
    );
    expect(patched.status).toBe(200);
    expect(((await patched.json()) as { expectedSource: string }).expectedSource).toBe("human");

    const summary = (await (await app.request(`/api/datasets/${ds.id}`)).json()) as {
      draftItemCount: number;
    };
    expect(summary.draftItemCount).toBe(2);

    const del = await app.request(`/api/items/${items[0]!.id}`, { method: "DELETE" });
    expect(del.status).toBe(204);

    const bulk = await app.request("/api/items/delete", jsonReq("POST", { ids: [items[1]!.id] }));
    expect(await bulk.json()).toEqual({ deleted: 1 });

    const gone = await app.request(`/api/datasets/${ds.id}`, { method: "DELETE" });
    expect(gone.status).toBe(204);
    expect((await app.request(`/api/datasets/${ds.id}`)).status).toBe(404);
  });

  it("imports CSV through the API", async () => {
    const ds = (await (
      await app.request("/api/datasets", jsonReq("POST", { name: "imp" }))
    ).json()) as {
      id: string;
    };
    const res = await app.request(
      `/api/datasets/${ds.id}/import`,
      jsonReq("POST", { format: "csv", content: "input,expected\nhello,world\n" }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { added: number; columns: string[] };
    expect(body.added).toBe(1);
    expect(body.columns).toEqual(["input", "expected"]);
    const bad = await app.request(
      `/api/datasets/${ds.id}/import`,
      jsonReq("POST", { format: "json", content: "{oops" }),
    );
    expect(bad.status).toBe(400);
  });

  it("returns structured validation and not-found errors", async () => {
    const bad = await app.request("/api/datasets", jsonReq("POST", { name: "" }));
    expect(bad.status).toBe(400);
    const body = (await bad.json()) as { error: { code: string; details: unknown[] } };
    expect(body.error.code).toBe("VALIDATION");
    expect(body.error.details.length).toBeGreaterThan(0);

    const missing = await app.request("/api/datasets/nope");
    expect(missing.status).toBe(404);
    expect(((await missing.json()) as { error: { code: string } }).error.code).toBe("NOT_FOUND");
  });

  it("enforces the bearer token when configured", async () => {
    const { services } = await createTestContext();
    const secured = createApp({ services, config: loadConfig({ MCP_BEARER_TOKEN: "s3cret" }) });
    expect((await secured.request("/api/datasets")).status).toBe(401);
    const ok = await secured.request("/api/datasets", {
      headers: { authorization: "Bearer s3cret" },
    });
    expect(ok.status).toBe(200);
    expect((await secured.request("/api/health")).status).toBe(200);
  });
});
