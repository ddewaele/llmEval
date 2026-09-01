import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { OpenAPIHono } from "@hono/zod-openapi";
import { serveStatic } from "@hono/node-server/serve-static";
import { bearerAuth } from "hono/bearer-auth";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import type { Config, Services } from "@llmeval/core";
import type { AppEnv } from "./env.js";
import { errorBody, handleError } from "./errors.js";
import { datasetRoutes } from "./routes/datasets.js";
import { handleMcpRequest } from "./mcp/server.js";
import { itemRoutes } from "./routes/items.js";
import { modelRoutes } from "./routes/models.js";
import { runRoutes } from "./routes/runs.js";
import { scoringRoutes } from "./routes/scoring.js";
import { versionRoutes } from "./routes/versions.js";

export interface AppDeps {
  services: Services;
  config: Config;
  /** Request logging (off in tests). */
  log?: boolean;
  /** Directory with the built web app (apps/web/dist); served with an SPA fallback when present. */
  staticDir?: string;
}

export function createApp(deps: AppDeps) {
  const app = new OpenAPIHono<AppEnv>({
    defaultHook: (result, c) => {
      if (!result.success) {
        return c.json(errorBody("VALIDATION", "Invalid request", result.error.issues), 400);
      }
    },
  });

  if (deps.log) app.use(logger());
  app.use("*", async (c, next) => {
    c.set("services", deps.services);
    c.set("config", deps.config);
    await next();
  });
  app.use("/api/*", cors());
  app.onError(handleError);
  app.notFound((c) =>
    c.json(errorBody("NOT_FOUND", `No route for ${c.req.method} ${c.req.path}`), 404),
  );

  app.get("/api/health", (c) => c.json({ ok: true }));

  if (deps.config.MCP_BEARER_TOKEN) {
    const auth = bearerAuth({ token: deps.config.MCP_BEARER_TOKEN });
    app.use("/api/datasets/*", auth);
    app.use("/api/datasets", auth);
    app.use("/api/items/*", auth);
    app.use("/api/items", auth);
    app.use("/api/runs/*", auth);
    app.use("/api/runs", auth);
    app.use("/api/run-items/*", auth);
    app.use("/api/jobs/*", auth);
    app.use("/api/jobs", auth);
    app.use("/api/scorers", auth);
    app.use("/api/models", auth);
    app.use("/mcp", auth);
    app.openAPIRegistry.registerComponent("securitySchemes", "bearer", {
      type: "http",
      scheme: "bearer",
    });
  }

  app.route("/api", datasetRoutes);
  app.route("/api", itemRoutes);
  app.route("/api", versionRoutes);
  app.route("/api", runRoutes);
  app.route("/api", scoringRoutes);
  app.route("/api", modelRoutes);

  app.all("/mcp", (c) => handleMcpRequest(deps.services, c.req.raw));

  app.doc31("/openapi.json", {
    openapi: "3.1.0",
    info: {
      title: "llmEval API",
      version: "0.1.0",
      description:
        "Datasets, items, versions, runs and scores for LLM evaluation. The MCP server at /mcp exposes the same operations as tools.",
    },
    ...(deps.config.MCP_BEARER_TOKEN ? { security: [{ bearer: [] }] } : {}),
  });

  if (deps.staticDir && existsSync(join(deps.staticDir, "index.html"))) {
    const index = readFileSync(join(deps.staticDir, "index.html"), "utf8");
    app.use("/*", serveStatic({ root: deps.staticDir }));
    app.get("/*", (c) => {
      const p = c.req.path;
      if (p.startsWith("/api/") || p === "/api" || p === "/mcp" || p === "/openapi.json")
        return c.notFound();
      return c.html(index);
    });
  }

  return app;
}

export type App = ReturnType<typeof createApp>;
