import { beforeEach, describe, expect, it } from "vitest";
import { createTestContext } from "@llmeval/core/test-utils";
import { createApp, type App } from "../app.js";

const jsonReq = (method: string, body: unknown) => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

describe("run routes", () => {
  let app: App;
  let datasetId: string;
  let wait: (id: string) => Promise<void>;
  beforeEach(async () => {
    const { services, config } = await createTestContext();
    app = createApp({ services, config });
    wait = (id) => services.runs.wait(id);
    datasetId = (await services.datasets.create({ name: "ds" })).id;
    await services.items.add(datasetId, [{ input: "a", expected: "A" }, { input: "b" }]);
  });

  it("starts a run, streams events, lists items", async () => {
    const res = await app.request(
      "/api/runs",
      jsonReq("POST", { datasetId, userTemplate: "Q: {{input}}" }),
    );
    expect(res.status).toBe(202);
    const run = (await res.json()) as { id: string; status: string; totalItems: number };
    expect(run.totalItems).toBe(2);
    await wait(run.id);

    const got = (await (await app.request(`/api/runs/${run.id}`)).json()) as { status: string };
    expect(got.status).toBe("completed");

    const items = (await (await app.request(`/api/runs/${run.id}/items`)).json()) as {
      items: Array<{ id: string; output: string }>;
    };
    expect(items.items.map((i) => i.output)).toEqual(["echo: Q: a", "echo: Q: b"]);

    const one = await app.request(`/api/run-items/${items.items[0]!.id}`);
    expect(one.status).toBe(200);

    const sse = await app.request(`/api/runs/${run.id}/events`);
    expect(sse.headers.get("content-type")).toMatch(/text\/event-stream/);
    const text = await sse.text();
    expect(text).toMatch(/event: snapshot/);
    expect(text).toMatch(/"status":"completed"/);

    const list = (await (await app.request(`/api/runs?datasetId=${datasetId}`)).json()) as {
      items: unknown[];
    };
    expect(list.items).toHaveLength(1);

    const cancel = await app.request(`/api/runs/${run.id}/cancel`, { method: "POST" });
    expect(cancel.status).toBe(409);
  });

  it("rejects unknown models with a structured error", async () => {
    const res = await app.request("/api/runs", jsonReq("POST", { datasetId, model: "nope:model" }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("VALIDATION");
  });
});
