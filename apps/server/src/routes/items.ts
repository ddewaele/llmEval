import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import {
  AddItemsSchema,
  DeleteItemsSchema,
  ErrorResponseSchema,
  IdSchema,
  ImportRequestSchema,
  ImportResultSchema,
  ItemSchema,
  ListItemsQuerySchema,
  ReviewItemsSchema,
  UpdateItemSchema,
  pageSchema,
} from "@llmeval/shared";
import type { AppEnv } from "../env.js";

const IdParams = z.object({ id: IdSchema });
const json = <T extends z.ZodTypeAny>(schema: T, description: string) => ({
  description,
  content: { "application/json": { schema } },
});
const notFound = json(ErrorResponseSchema, "Not found");

export const itemRoutes = new OpenAPIHono<AppEnv>();

itemRoutes.openapi(
  createRoute({
    method: "get",
    path: "/datasets/{id}/items",
    tags: ["items"],
    summary: "List draft items of a dataset (cursor paginated, filterable)",
    request: { params: IdParams, query: ListItemsQuerySchema },
    responses: { 200: json(pageSchema(ItemSchema), "Page of items"), 404: notFound },
  }),
  async (c) =>
    c.json(await c.var.services.items.list(c.req.valid("param").id, c.req.valid("query")), 200),
);

itemRoutes.openapi(
  createRoute({
    method: "post",
    path: "/datasets/{id}/items",
    tags: ["items"],
    summary: "Add items to the dataset draft",
    request: { params: IdParams, body: json(AddItemsSchema, "Items to add") },
    responses: {
      201: json(z.object({ items: z.array(ItemSchema) }), "Created items"),
      404: notFound,
    },
  }),
  async (c) => {
    const items = await c.var.services.items.add(
      c.req.valid("param").id,
      c.req.valid("json").items,
    );
    return c.json({ items }, 201);
  },
);

itemRoutes.openapi(
  createRoute({
    method: "post",
    path: "/datasets/{id}/import",
    tags: ["items"],
    summary: "Import items from JSON, JSONL, CSV or XLSX into the draft (dryRun to preview)",
    request: { params: IdParams, body: json(ImportRequestSchema, "Import request") },
    responses: {
      200: json(ImportResultSchema, "Import result"),
      400: json(ErrorResponseSchema, "Unparseable content"),
      404: notFound,
    },
  }),
  async (c) =>
    c.json(await c.var.services.imports.import(c.req.valid("param").id, c.req.valid("json")), 200),
);

itemRoutes.openapi(
  createRoute({
    method: "get",
    path: "/items/{id}",
    tags: ["items"],
    summary: "Get a draft item",
    request: { params: IdParams },
    responses: { 200: json(ItemSchema, "Item"), 404: notFound },
  }),
  async (c) => c.json(await c.var.services.items.get(c.req.valid("param").id), 200),
);

itemRoutes.openapi(
  createRoute({
    method: "patch",
    path: "/items/{id}",
    tags: ["items"],
    summary: "Update a draft item; creates a new revision",
    request: { params: IdParams, body: json(UpdateItemSchema, "Fields to change") },
    responses: { 200: json(ItemSchema, "Updated item"), 404: notFound },
  }),
  async (c) =>
    c.json(await c.var.services.items.update(c.req.valid("param").id, c.req.valid("json")), 200),
);

itemRoutes.openapi(
  createRoute({
    method: "delete",
    path: "/items/{id}",
    tags: ["items"],
    summary: "Remove one item from the draft (soft delete)",
    request: { params: IdParams },
    responses: { 204: { description: "Deleted" } },
  }),
  async (c) => {
    await c.var.services.items.delete([c.req.valid("param").id]);
    return c.body(null, 204);
  },
);

itemRoutes.openapi(
  createRoute({
    method: "post",
    path: "/items/delete",
    tags: ["items"],
    summary: "Remove many items from the draft (soft delete)",
    request: { body: json(DeleteItemsSchema, "Item ids") },
    responses: { 200: json(z.object({ deleted: z.number().int() }), "Count deleted") },
  }),
  async (c) => c.json(await c.var.services.items.delete(c.req.valid("json").ids), 200),
);

itemRoutes.openapi(
  createRoute({
    method: "post",
    path: "/items/review",
    tags: ["items"],
    summary: "Mark ground truths reviewed or clear the reviewed flag",
    request: { body: json(ReviewItemsSchema, "Item ids and approve flag") },
    responses: { 200: json(z.object({ updated: z.number().int() }), "Count updated") },
  }),
  async (c) => {
    const { ids, approve } = c.req.valid("json");
    return c.json(await c.var.services.items.review(ids, approve), 200);
  },
);
