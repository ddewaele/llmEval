import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { BoolLikeSchema, ModelCatalogSchema } from "@llmeval/shared";
import type { AppEnv } from "../env.js";

export const modelRoutes = new OpenAPIHono<AppEnv>();

modelRoutes.openapi(
  createRoute({
    method: "get",
    path: "/models",
    tags: ["models"],
    summary:
      "Known models with pricing and availability, effective defaults per purpose, Ollama status",
    request: { query: z.object({ refresh: BoolLikeSchema.default(false) }) },
    responses: {
      200: {
        description: "Model catalog",
        content: { "application/json": { schema: ModelCatalogSchema } },
      },
    },
  }),
  async (c) => {
    if (c.req.valid("query").refresh) await c.var.services.models.discoverOllama();
    return c.json(c.var.services.models.catalog(), 200);
  },
);
