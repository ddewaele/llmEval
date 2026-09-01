import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import {
  ErrorResponseSchema,
  IdSchema,
  JobSchema,
  ScoreRunSchema,
  ScorerInfoSchema,
} from "@llmeval/shared";
import type { AppEnv } from "../env.js";

const IdParams = z.object({ id: IdSchema });
const json = <T extends z.ZodTypeAny>(schema: T, description: string) => ({
  description,
  content: { "application/json": { schema } },
});
const notFound = json(ErrorResponseSchema, "Not found");

export const scoringRoutes = new OpenAPIHono<AppEnv>();

scoringRoutes.openapi(
  createRoute({
    method: "get",
    path: "/scorers",
    tags: ["scoring"],
    summary: "List available scorer types with their config schemas",
    responses: { 200: json(z.array(ScorerInfoSchema), "Scorers") },
  }),
  (c) => c.json(c.var.services.scorers.list(), 200),
);

scoringRoutes.openapi(
  createRoute({
    method: "post",
    path: "/runs/{id}/scores",
    tags: ["scoring"],
    summary: "Add a scorer to an existing run and score its completed items (background job)",
    request: { params: IdParams, body: json(ScoreRunSchema, "Scorer spec") },
    responses: {
      202: json(JobSchema, "Rescore job"),
      404: notFound,
      409: json(ErrorResponseSchema, "Scorer key exists and overwrite not set"),
    },
  }),
  async (c) => {
    const { scorer, overwrite } = c.req.valid("json");
    return c.json(
      await c.var.services.scoring.scoreRun(c.req.valid("param").id, scorer, { overwrite }),
      202,
    );
  },
);

scoringRoutes.openapi(
  createRoute({
    method: "get",
    path: "/jobs/{id}",
    tags: ["jobs"],
    summary: "Get a background job (rescore, generation, import) with progress",
    request: { params: IdParams },
    responses: { 200: json(JobSchema, "Job"), 404: notFound },
  }),
  async (c) => c.json(await c.var.services.jobs$.get(c.req.valid("param").id), 200),
);

scoringRoutes.openapi(
  createRoute({
    method: "get",
    path: "/jobs",
    tags: ["jobs"],
    summary: "List recent background jobs",
    request: { query: z.object({ datasetId: IdSchema.optional() }) },
    responses: { 200: json(z.array(JobSchema), "Jobs") },
  }),
  async (c) => c.json(await c.var.services.jobs$.list(c.req.valid("query").datasetId), 200),
);

scoringRoutes.openapi(
  createRoute({
    method: "post",
    path: "/jobs/{id}/cancel",
    tags: ["jobs"],
    summary: "Cancel a running job",
    request: { params: IdParams },
    responses: {
      200: json(JobSchema, "Job"),
      404: notFound,
      409: json(ErrorResponseSchema, "Not running"),
    },
  }),
  async (c) => c.json(await c.var.services.jobs$.cancel(c.req.valid("param").id), 200),
);
