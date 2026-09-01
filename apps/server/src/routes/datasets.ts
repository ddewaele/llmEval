import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import {
  BoolLikeSchema,
  CreateDatasetSchema,
  DatasetSchema,
  DatasetSummarySchema,
  ErrorResponseSchema,
  IdSchema,
  ListDatasetsQuerySchema,
  UpdateDatasetSchema,
} from "@llmeval/shared";
import type { AppEnv } from "../env.js";

const IdParams = z.object({ id: IdSchema });
const json = <T extends z.ZodTypeAny>(schema: T, description: string) => ({
  description,
  content: { "application/json": { schema } },
});
const notFound = json(ErrorResponseSchema, "Not found");

export const datasetRoutes = new OpenAPIHono<AppEnv>();

datasetRoutes.openapi(
  createRoute({
    method: "get",
    path: "/datasets",
    tags: ["datasets"],
    summary: "List datasets",
    request: { query: ListDatasetsQuerySchema },
    responses: { 200: json(z.array(DatasetSummarySchema), "Datasets with summary counts") },
  }),
  async (c) => c.json(await c.var.services.datasets.list(c.req.valid("query")), 200),
);

datasetRoutes.openapi(
  createRoute({
    method: "post",
    path: "/datasets",
    tags: ["datasets"],
    summary: "Create a dataset",
    request: { body: json(CreateDatasetSchema, "Dataset to create") },
    responses: { 201: json(DatasetSchema, "Created dataset") },
  }),
  async (c) => c.json(await c.var.services.datasets.create(c.req.valid("json")), 201),
);

datasetRoutes.openapi(
  createRoute({
    method: "get",
    path: "/datasets/{id}",
    tags: ["datasets"],
    summary: "Get a dataset with summary counts",
    request: { params: IdParams },
    responses: { 200: json(DatasetSummarySchema, "Dataset"), 404: notFound },
  }),
  async (c) => c.json(await c.var.services.datasets.get(c.req.valid("param").id), 200),
);

datasetRoutes.openapi(
  createRoute({
    method: "patch",
    path: "/datasets/{id}",
    tags: ["datasets"],
    summary: "Update dataset name, description, tags or input schema",
    request: { params: IdParams, body: json(UpdateDatasetSchema, "Fields to change") },
    responses: { 200: json(DatasetSchema, "Updated dataset"), 404: notFound },
  }),
  async (c) =>
    c.json(await c.var.services.datasets.update(c.req.valid("param").id, c.req.valid("json")), 200),
);

datasetRoutes.openapi(
  createRoute({
    method: "post",
    path: "/datasets/{id}/archive",
    tags: ["datasets"],
    summary: "Archive or unarchive a dataset",
    request: {
      params: IdParams,
      body: json(z.object({ archived: z.boolean().default(true) }), "Archive flag"),
    },
    responses: { 200: json(DatasetSchema, "Dataset"), 404: notFound },
  }),
  async (c) =>
    c.json(
      await c.var.services.datasets.archive(c.req.valid("param").id, c.req.valid("json").archived),
      200,
    ),
);

datasetRoutes.openapi(
  createRoute({
    method: "delete",
    path: "/datasets/{id}",
    tags: ["datasets"],
    summary: "Delete a dataset and its items; blocked while runs exist unless force=true",
    request: { params: IdParams, query: z.object({ force: BoolLikeSchema.default(false) }) },
    responses: {
      204: { description: "Deleted" },
      404: notFound,
      409: json(ErrorResponseSchema, "Runs exist and force was not set"),
    },
  }),
  async (c) => {
    await c.var.services.datasets.delete(c.req.valid("param").id, c.req.valid("query"));
    return c.body(null, 204);
  },
);
