import { beforeEach, describe, expect, it } from "vitest";
import { createTestContext } from "@llmeval/core/test-utils";
import { createApp, type App } from "../app.js";

const jsonReq = (method: string, body: unknown) => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

describe("version routes", () => {
  let app: App;
  let datasetId: string;
  beforeEach(async () => {
    const { services, config } = await createTestContext();
    app = createApp({ services, config });
    datasetId = (await services.datasets.create({ name: "ds" })).id;
    await services.items.add(datasetId, [{ input: "a", expected: "1" }, { input: "b" }]);
  });

  it("publishes, lists, diffs and exports versions", async () => {
    const pub = await app.request(
      `/api/datasets/${datasetId}/versions`,
      jsonReq("POST", { label: "v1" }),
    );
    expect(pub.status).toBe(201);
    const { version, warnings } = (await pub.json()) as {
      version: { number: number };
      warnings: string[];
    };
    expect(version.number).toBe(1);
    expect(warnings).toEqual(["1 item(s) have no ground truth"]);

    const again = await app.request(`/api/datasets/${datasetId}/versions`, jsonReq("POST", {}));
    expect(again.status).toBe(409);

    const list = (await (
      await app.request(`/api/datasets/${datasetId}/versions`)
    ).json()) as unknown[];
    expect(list).toHaveLength(1);

    const items = await app.request(`/api/datasets/${datasetId}/versions/1/items?limit=1`);
    const page = (await items.json()) as { items: Array<{ input: string }>; nextCursor: string };
    expect(page.items[0]!.input).toBe("a");
    expect(page.nextCursor).not.toBeNull();

    const diff = await app.request(`/api/datasets/${datasetId}/versions/diff?from=1`);
    expect(diff.status).toBe(200);
    expect(((await diff.json()) as { unchanged: number }).unchanged).toBe(2);

    const exp = await app.request(`/api/datasets/${datasetId}/versions/1/export`);
    expect(exp.headers.get("content-disposition")).toMatch(/\.jsonl"$/);
    expect((await exp.text()).split("\n")).toHaveLength(2);

    expect((await app.request(`/api/datasets/${datasetId}/versions/7`)).status).toBe(404);
  });
});
