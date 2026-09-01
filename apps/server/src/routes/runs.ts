import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { streamSSE } from "hono/streaming";
import {
  ErrorResponseSchema,
  IdSchema,
  ListRunItemsQuerySchema,
  ListRunsQuerySchema,
  RunItemSchema,
  RunSchema,
  StartRunSchema,
  pageSchema,
} from "@llmeval/shared";
import type { AppEnv } from "../env.js";

const IdParams = z.object({ id: IdSchema });
const json = <T extends z.ZodTypeAny>(schema: T, description: string) => ({
  description,
  content: { "application/json": { schema } },
});
const notFound = json(ErrorResponseSchema, "Not found");
const TERMINAL = new Set(["completed", "failed", "cancelled", "interrupted"]);

export const runRoutes = new OpenAPIHono<AppEnv>();

runRoutes.openapi(
  createRoute({
    method: "post",
    path: "/runs",
    tags: ["runs"],
    summary: "Start a run of a dataset version against a model (executes in the background)",
    request: { body: json(StartRunSchema, "Run configuration") },
    responses: {
      202: json(RunSchema, "Run accepted and started"),
      400: json(ErrorResponseSchema, "Invalid configuration"),
      404: notFound,
      409: json(ErrorResponseSchema, "Model not configured or version empty"),
    },
  }),
  async (c) => c.json(await c.var.services.runs.start(c.req.valid("json")), 202),
);

runRoutes.openapi(
  createRoute({
    method: "get",
    path: "/runs",
    tags: ["runs"],
    summary: "List runs, newest first",
    request: { query: ListRunsQuerySchema },
    responses: { 200: json(pageSchema(RunSchema), "Page of runs") },
  }),
  async (c) => c.json(await c.var.services.runs.list(c.req.valid("query")), 200),
);

runRoutes.openapi(
  createRoute({
    method: "get",
    path: "/runs/{id}",
    tags: ["runs"],
    summary: "Get a run with progress, token usage and cost",
    request: { params: IdParams },
    responses: { 200: json(RunSchema, "Run"), 404: notFound },
  }),
  async (c) => c.json(await c.var.services.runs.get(c.req.valid("param").id), 200),
);

runRoutes.openapi(
  createRoute({
    method: "get",
    path: "/runs/{id}/items",
    tags: ["runs"],
    summary: "List a run's per-item results",
    request: { params: IdParams, query: ListRunItemsQuerySchema },
    responses: { 200: json(pageSchema(RunItemSchema), "Page of run items"), 404: notFound },
  }),
  async (c) =>
    c.json(await c.var.services.runs.listItems(c.req.valid("param").id, c.req.valid("query")), 200),
);

runRoutes.openapi(
  createRoute({
    method: "get",
    path: "/run-items/{id}",
    tags: ["runs"],
    summary: "Get one run item with rendered messages, output and raw response",
    request: { params: IdParams },
    responses: { 200: json(RunItemSchema, "Run item"), 404: notFound },
  }),
  async (c) => c.json(await c.var.services.runs.getItem(c.req.valid("param").id), 200),
);

runRoutes.openapi(
  createRoute({
    method: "post",
    path: "/runs/{id}/cancel",
    tags: ["runs"],
    summary: "Cancel a running run (in-flight items become cancelled, pending items stay pending)",
    request: { params: IdParams },
    responses: {
      200: json(RunSchema, "Run"),
      404: notFound,
      409: json(ErrorResponseSchema, "Not running"),
    },
  }),
  async (c) => c.json(await c.var.services.runs.cancel(c.req.valid("param").id), 200),
);

runRoutes.openapi(
  createRoute({
    method: "post",
    path: "/runs/{id}/resume",
    tags: ["runs"],
    summary: "Resume a cancelled, interrupted or failed run",
    request: { params: IdParams },
    responses: {
      200: json(RunSchema, "Run"),
      404: notFound,
      409: json(ErrorResponseSchema, "Not resumable"),
    },
  }),
  async (c) => c.json(await c.var.services.runs.resume(c.req.valid("param").id), 200),
);

/** Live progress as Server-Sent Events: a snapshot first, then item/run events until terminal. */
runRoutes.get("/runs/:id/events", async (c) => {
  const runs = c.var.services.runs;
  const run = await runs.get(c.req.param("id"));
  return streamSSE(c, async (stream) => {
    await stream.writeSSE({ event: "snapshot", data: JSON.stringify({ type: "snapshot", run }) });
    if (TERMINAL.has(run.status)) return;
    await new Promise<void>((resolve) => {
      const finish = () => {
        unsubscribe();
        resolve();
      };
      const unsubscribe = runs.subscribe(run.id, (event) => {
        void stream
          .writeSSE({ event: event.type, data: JSON.stringify(event) })
          .then(() => {
            if (event.type === "run" && TERMINAL.has(event.status)) finish();
          })
          .catch(finish);
      });
      stream.onAbort(finish);
    });
  });
});
