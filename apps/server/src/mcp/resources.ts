import { ResourceTemplate, type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ListRunItemsQuerySchema } from "@llmeval/shared";
import type { Services } from "@llmeval/core";
import { truncateStrings } from "./format.js";

const json = (v: unknown) => JSON.stringify(v, null, 2);

/** Read-only documents an LLM can pull into context without calling tools. */
export function registerResources(server: McpServer, services: Services) {
  server.registerResource(
    "datasets",
    "llmeval://datasets",
    {
      title: "All datasets",
      description:
        "Summary of every dataset: ids, names, item counts, latest version, unreviewed ground truths.",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [
        { uri: uri.href, mimeType: "application/json", text: json(await services.datasets.list()) },
      ],
    }),
  );

  server.registerResource(
    "dataset",
    new ResourceTemplate("llmeval://datasets/{id}", { list: undefined }),
    {
      title: "Dataset summary",
      description: "One dataset with counts, its versions and its most recent runs.",
      mimeType: "application/json",
    },
    async (uri, { id }) => {
      const datasetId = String(id);
      const [dataset, versions, runs] = await Promise.all([
        services.datasets.get(datasetId),
        services.versions.list(datasetId),
        services.runs.list({ datasetId, limit: 10 }),
      ]);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: json({ dataset, versions, recentRuns: runs.items.map(runSummary) }),
          },
        ],
      };
    },
  );

  server.registerResource(
    "version-items",
    new ResourceTemplate("llmeval://datasets/{id}/versions/{number}/items", { list: undefined }),
    {
      title: "Version items (JSONL)",
      description:
        "Every item frozen in a dataset version, one JSON object per line: {id, input, expected, metadata}.",
      mimeType: "application/jsonl",
    },
    async (uri, { id, number }) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/jsonl",
          text: await services.versions.exportJsonl(String(id), Number(number)),
        },
      ],
    }),
  );

  server.registerResource(
    "run-summary",
    new ResourceTemplate("llmeval://runs/{id}/summary", { list: undefined }),
    {
      title: "Run summary",
      description: "A run's config snapshot, status, token usage, cost and per-scorer aggregates.",
      mimeType: "application/json",
    },
    async (uri, { id }) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: json(await services.runs.get(String(id))),
        },
      ],
    }),
  );

  server.registerResource(
    "run-failures",
    new ResourceTemplate("llmeval://runs/{id}/failures", { list: undefined }),
    {
      title: "Run failures",
      description:
        "Items of a run that errored or failed at least one scorer, with input, expected, output, scores and rationales (strings truncated).",
      mimeType: "application/json",
    },
    async (uri, { id }) => {
      const runId = String(id);
      const run = await services.runs.get(runId);
      const errored = await services.runs.listItems(
        runId,
        ListRunItemsQuerySchema.parse({ status: "failed", limit: 200 }),
      );
      const failing = new Map(errored.items.map((i) => [i.id, i]));
      for (const scorer of run.scorers) {
        const page = await services.runs.listItems(
          runId,
          ListRunItemsQuerySchema.parse({ scorerKey: scorer.key, limit: 200 }),
        );
        for (const item of page.items) failing.set(item.id, item);
      }
      const items = [...failing.values()]
        .sort((a, b) => a.position - b.position)
        .map((i) => ({
          position: i.position,
          itemId: i.itemId,
          input: i.input,
          expected: i.expected,
          output: i.output,
          error: i.error,
          scores: i.scores.map((s) => ({
            key: s.scorerKey,
            score: s.score,
            passed: s.passed,
            rationale: s.rationale,
            details: s.details,
          })),
        }));
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: json(
              truncateStrings({ run: runSummary(run), failing: items.length, items }, 500),
            ),
          },
        ],
      };
    },
  );
}

function runSummary(r: Awaited<ReturnType<Services["runs"]["get"]>>) {
  return {
    id: r.id,
    name: r.name,
    status: r.status,
    versionNumber: r.versionNumber,
    model: r.config.model,
    totalItems: r.totalItems,
    completedItems: r.completedItems,
    failedItems: r.failedItems,
    costUsd: r.costUsd,
    scorers: r.aggregates.scorers,
    createdAt: r.createdAt,
  };
}
