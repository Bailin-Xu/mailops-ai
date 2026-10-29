import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createTools, ToolFailure, referenceSchema, searchSchema, threadOutput, searchOutput, revisionOutput, type ToolRepository, type Grant } from "./tools";
export function createMcpHttpServer(repository: ToolRepository, grant: Grant, secret: string, timeoutMs = 2000) {
  if (secret.length < 32) throw new Error("Service capability must have at least 32 characters");
  const tools = createTools(repository,grant,timeoutMs);
  const http = createServer(async (req,res) => {
    const deny = (status: number) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "REQUEST_REJECTED" })); };
    const token = (req.headers.authorization ?? "").replace(/^Bearer /, "");
    if (req.headers.host !== `127.0.0.1:${(http.address() as { port: number }).port}` || req.headers.origin) return deny(403);
    if (Buffer.byteLength(token) !== Buffer.byteLength(secret) || !timingSafeEqual(Buffer.from(token),Buffer.from(secret)) || Date.now() >= grant.expiresAt) return deny(401);
    if (req.url !== "/mcp") return deny(404);
    if (req.method !== "POST") return deny(405);
    // Stateless transport; run-scoped references live outside protocol sessions.
    const server = new McpServer({ name: "mailops-read-tools", version: "1.0.0" });
    function register(name: string, schema: typeof referenceSchema | typeof searchSchema, output: typeof threadOutput | typeof searchOutput | typeof revisionOutput, handler: (args: unknown) => Promise<unknown>) {
      server.registerTool(name, { inputSchema: schema, outputSchema: output, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false } }, async (args: unknown) => {
        try {
          const result = await handler(args);
          return { content: [{ type: "text" as const, text: JSON.stringify(result) }], structuredContent: result as Record<string, unknown> };
        } catch (error) { return { isError: true, content: [{ type: "text" as const, text: JSON.stringify({ code: error instanceof ToolFailure ? error.code : "INVALID_OR_UNAVAILABLE" }) }] }; }
      });
    }
    register("get_thread_context",referenceSchema,threadOutput,tools.getThread);
    register("search_approved_knowledge",searchSchema,searchOutput,tools.search);
    register("get_knowledge_revision",referenceSchema,revisionOutput,tools.getRevision);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => { void transport.close(); void server.close(); });
    try {
      let size = 0;
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        size += chunk.length;
        chunks.push(Buffer.from(chunk));
        if (size > 32768) { deny(413); return; }
      }
      await server.connect(transport); await transport.handleRequest(req,res,JSON.parse(Buffer.concat(chunks).toString("utf8")));
    }
    catch { if (!res.headersSent) deny(400); }
  });
  http.requestTimeout = 5000;
  http.headersTimeout = 5000;
  return http;
}
