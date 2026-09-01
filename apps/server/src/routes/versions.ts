import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import {
  DatasetVersionSchema,
  DiffQuerySchema,
  ErrorResponseSchema,
  IdSchema,
  PaginationQuerySchema,
  PublishResultSchema,
  PublishVersionSchema,
  VersionDiffSchema,
  VersionItemSchema,
  pageSchema,
} from "@llmeval/shared";
import type { AppEnv } from "../env.js";

const IdParams = z.object({ id: IdSchema });
const VersionParams = z.object({ id: IdSchema, number: z.coerce.number().int().positive() });
const json = <T extends z.ZodTypeAny>(schema: T, description: string) => ({
  description,
  content: { "application/json": { schema } },
});
const notFound = json(ErrorResponseSchema, "Not found");

export const versionRoutes = new OpenAPIHono<AppEnv>();

versionRoutes.openapi(
  createRoute({
    method: "get",
    path: "/datasets/{id}/versions",
    tags: ["versions"],
    summary: "List published versions, newest first",
    request: { params: IdParams },
    responses: { 200: json(z.array(DatasetVersionSchema), "Versions"), 404: notFound },
  }),
  async (c) => c.json(await c.var.services.versions.list(c.req.valid("param").id), 200),
);

versionRoutes.openapi(
  createRoute({
    method: "post",
    path: "/datasets/{id}/versions",
    tags: ["versions"],
    summary: "Publish the draft as a new immutable version",
    request: { params: IdParams, body: json(PublishVersionSchema, "Label and notes") },
    responses: {
      201: json(PublishResultSchema, "Published version with warnings"),
      404: notFound,
      409: json(ErrorResponseSchema, "Draft identical to the latest version"),
    },
  }),
  async (c) =>
    c.json(
      await c.var.services.versions.publish(c.req.valid("param").id, c.req.valid("json")),
      201,
    ),
);

// Registered before /{number} so the static segment wins.
versionRoutes.openapi(
  createRoute({
    method: "get",
    path: "/datasets/{id}/versions/diff",
    tags: ["versions"],
    summary: "Diff two versions (or a version against the draft): added, removed, changed items",
    request: { params: IdParams, query: DiffQuerySchema },
    responses: { 200: json(VersionDiffSchema, "Diff"), 404: notFound },
  }),
  async (c) => {
    const { from, to } = c.req.valid("query");
    return c.json(await c.var.services.versions.diff(c.req.valid("param").id, from, to), 200);
  },
);

versionRoutes.openapi(
  createRoute({
    method: "get",
    path: "/datasets/{id}/versions/{number}",
    tags: ["versions"],
    summary: "Get a version",
    request: { params: VersionParams },
    responses: { 200: json(DatasetVersionSchema, "Version"), 404: notFound },
  }),
  async (c) => {
    const { id, number } = c.req.valid("param");
    return c.json(await c.var.services.versions.get(id, number), 200);
  },
);

versionRoutes.openapi(
  createRoute({
    method: "get",
    path: "/datasets/{id}/versions/{number}/items",
    tags: ["versions"],
    summary: "List the items frozen in a version",
    request: { params: VersionParams, query: PaginationQuerySchema },
    responses: { 200: json(pageSchema(VersionItemSchema), "Page of version items"), 404: notFound },
  }),
  async (c) => {
    const { id, number } = c.req.valid("param");
    return c.json(await c.var.services.versions.listItems(id, number, c.req.valid("query")), 200);
  },
);

versionRoutes.openapi(
  createRoute({
    method: "get",
    path: "/datasets/{id}/versions/{number}/export",
    tags: ["versions"],
    summary: "Export a version as JSON Lines",
    request: { params: VersionParams },
    responses: {
      200: { description: "JSON Lines text", content: { "text/plain": { schema: z.string() } } },
      404: notFound,
    },
  }),
  async (c) => {
    const { id, number } = c.req.valid("param");
    const body = await c.var.services.versions.exportJsonl(id, number);
    return c.text(body, 200, {
      "content-disposition": `attachment; filename="dataset-${id}-v${number}.jsonl"`,
    });
  },
);
