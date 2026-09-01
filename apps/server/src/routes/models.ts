import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { AvailableModelSchema } from "@llmeval/shared";
import type { AppEnv } from "../env.js";

export const modelRoutes = new OpenAPIHono<AppEnv>();

modelRoutes.openapi(
  createRoute({
    method: "get",
    path: "/models",
    tags: ["models"],
    summary: "List known models with pricing and provider availability",
    responses: {
      200: {
        description: "Models",
        content: { "application/json": { schema: z.array(AvailableModelSchema) } },
      },
    },
  }),
  (c) => c.json(c.var.services.models.list(), 200),
);
