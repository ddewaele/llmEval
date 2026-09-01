import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Services } from "@llmeval/core";

const text = (t: string) => ({
  messages: [{ role: "user" as const, content: { type: "text" as const, text: t } }],
});

/** Reusable workflows for an LLM client (Claude Code) driving llmEval. */
export function registerPrompts(server: McpServer, services: Services) {
  server.registerPrompt(
    "build_eval",
    {
      title: "Build an evaluation for a task",
      description:
        "Turn a task description (and optionally a sample file) into a dataset with items, ground truths, a first run and scorers.",
      argsSchema: {
        task: z
          .string()
          .describe(
            "What the application under test must do, e.g. 'extract SAP product codes from emails'",
          ),
        samplePath: z
          .string()
          .optional()
          .describe("Path to a CSV/XLSX/JSON file with sample inputs and expected outputs"),
        model: z
          .string()
          .optional()
          .describe("provider:model to run against; default DEFAULT_MODEL"),
      },
    },
    ({ task, samplePath, model }) =>
      text(
        [
          `Build an LLM evaluation in llmEval for this task: ${task}`,
          "",
          "Steps (use the llmeval MCP tools):",
          "1. list_models to confirm which providers are configured.",
          "2. create_dataset with a clear name, description and, if inputs are structured, an inputSchema.",
          samplePath
            ? `3. import_items with dryRun=true from path "${samplePath}" to inspect columns, then choose a mapping (input columns, expected column, expectedSplit for lists) and import for real.`
            : "3. add_items with 5-10 realistic hand-written items, then generate_items to reach ~30 diverse items (use the hand-written ones as seedItemIds).",
          "4. If items lack ground truths, generate_ground_truths with precise instructions, then list_items(filter='unreviewed') and review_items or update_item for anything wrong.",
          "5. publish_version with notes.",
          `6. start_run against ${model ?? "the default model"} with a systemPrompt, a userTemplate referencing the input fields, an outputSchema if the answer is structured, and scorers: pick set_overlap for list answers, json_equal for structured answers, exact_match/contains for short text, plus llm_judge with a rubric for nuanced correctness.`,
          "7. Poll get_run until completed, then summarise aggregates and the worst items from list_run_items(scorerKey=...).",
          "Report the dataset id, version, run id and headline scores at the end.",
        ].join("\n"),
      ),
  );

  server.registerPrompt(
    "triage_run",
    {
      title: "Triage a run's failures",
      description: "Analyse why items failed in a run and propose concrete prompt or data fixes.",
      argsSchema: { runId: z.string().describe("Run id") },
    },
    async ({ runId }) => {
      const run = await services.runs.get(runId);
      return text(
        [
          `Triage run ${runId} (${run.name ?? "unnamed"}, model ${run.config.model}, status ${run.status}).`,
          `Aggregates: ${JSON.stringify(run.aggregates.scorers)}.`,
          "",
          "1. Read resource llmeval://runs/" +
            runId +
            "/failures (or list_run_items with scorerKey) to see failing items with outputs and judge rationales.",
          "2. Group failures into root causes (prompt ambiguity, missing instruction, format problems, wrong or ambiguous ground truth, model capability).",
          "3. For ground-truth problems, fix the items with update_item and note that a new version is needed.",
          "4. For prompt problems, propose a revised systemPrompt/userTemplate and start a new run with it on the same version; then compare_runs(a=this run, b=new run, onlyRegressions=true) to confirm no regressions.",
          "Finish with a short table: root cause, affected items, fix, expected impact.",
        ].join("\n"),
      );
    },
  );

  server.registerPrompt(
    "write_rubric",
    {
      title: "Write an llm_judge rubric",
      description:
        "Draft a grading rubric for the llm_judge scorer from a dataset's items and purpose.",
      argsSchema: { datasetId: z.string().describe("Dataset id") },
    },
    async ({ datasetId }) => {
      const dataset = await services.datasets.get(datasetId);
      return text(
        [
          `Write an llm_judge rubric for dataset "${dataset.name}" (${datasetId}).${dataset.description ? ` Purpose: ${dataset.description}` : ""}`,
          "",
          "1. list_items(datasetId, limit=10) to see typical inputs and expected answers.",
          "2. Identify what makes an answer correct (must-have facts, allowed variations) and what must be penalised (hallucinated entries, missing entries, wrong format).",
          "3. Write a rubric of 4-8 imperative bullet points, unambiguous, referring to the expected answer as the reference.",
          "4. Propose a passThreshold and show the exact scorer spec: {key: 'judge', type: 'llm_judge', config: {rubric: '...', passThreshold: 0.7}}.",
        ].join("\n"),
      );
    },
  );
}
