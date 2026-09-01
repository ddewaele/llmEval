/**
 * stdio ↔ Streamable HTTP bridge for MCP clients that only speak stdio.
 *
 *   claude mcp add llmeval -- pnpm --filter @llmeval/server exec tsx bin/mcp-stdio.ts
 *
 * Requires the API server to be running (LLMEVAL_URL, default http://localhost:3000). The
 * server process owns the database and background jobs, so runs started from a chat survive
 * the chat ending. Prefer `claude mcp add --transport http llmeval http://localhost:3000/mcp`.
 */
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const base = process.env.LLMEVAL_URL ?? "http://localhost:3000";
const token = process.env.MCP_BEARER_TOKEN;

const upstream = new StreamableHTTPClientTransport(new URL("/mcp", base), {
  requestInit: token ? { headers: { authorization: `Bearer ${token}` } } : undefined,
});
const stdio = new StdioServerTransport();

stdio.onmessage = (message) => {
  upstream.send(message).catch((err: unknown) => {
    console.error("[llmeval-mcp] upstream send failed:", err);
  });
};
upstream.onmessage = (message) => {
  stdio.send(message).catch((err: unknown) => {
    console.error("[llmeval-mcp] stdio send failed:", err);
  });
};
const shutdown = () => {
  void Promise.allSettled([upstream.close(), stdio.close()]).then(() => process.exit(0));
};
stdio.onclose = shutdown;
upstream.onerror = (err) => console.error("[llmeval-mcp] upstream error:", err.message);

await upstream.start();
await stdio.start();
