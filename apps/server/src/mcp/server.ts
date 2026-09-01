import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { Services } from "@llmeval/core";
import { registerDatasetTools, registerItemTools, registerModelTools } from "./tools.js";

export const MCP_SERVER_INFO = { name: "llmeval", version: "0.1.0" } as const;

export function createMcpServer(services: Services): McpServer {
  const server = new McpServer(MCP_SERVER_INFO, {
    instructions:
      "llmEval manages LLM evaluation datasets. Typical flow: create_dataset → add_items/import_items → " +
      "(generate_ground_truths, review_items) → publish_version → start_run → get_run/list_run_items → compare_runs. " +
      "Ids are ULIDs; list_* tools truncate long strings, get_* tools return full content.",
  });
  registerDatasetTools(server, services);
  registerItemTools(server, services);
  registerModelTools(server, services);
  return server;
}

/**
 * Stateless Streamable HTTP handler: one server + transport per request. Cheap because tool
 * registration is in-memory, and it keeps the endpoint free of session bookkeeping.
 */
export async function handleMcpRequest(services: Services, request: Request): Promise<Response> {
  const server = createMcpServer(services);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    return await transport.handleRequest(request);
  } finally {
    // Close asynchronously once the response has been produced.
    void transport.close().catch(() => undefined);
  }
}
