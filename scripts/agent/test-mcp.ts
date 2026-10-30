import { randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { snapshotRepository } from "../../services/mcp/snapshot-repository";
import { createMcpHttpServer } from "../../services/mcp/server";
async function main() {
  const fixture = await snapshotRepository(process.env.AGENT_FIXTURE_DATABASE_URL ?? "", "tuning-delivery-00-fr");
  const secret = randomBytes(32).toString("hex");
  const runId = randomUUID();
  const server = createMcpHttpServer(fixture.repository, { runId, threadId: fixture.threadId, expiresAt: Date.now()+60000 }, secret);
  try {
    await new Promise<void>(resolve => server.listen(0,"127.0.0.1",resolve));
    const port = (server.address() as {port:number}).port;
    const child = spawn("services/agent/.venv/bin/python", [process.argv.includes("--agent") ? "services/agent/test_agent_integration.py" : "services/agent/test_mcp_integration.py"], { stdio: "inherit", env: {
      ...process.env, A1_MCP_URL: `http://127.0.0.1:${port}/mcp`, A1_CAPABILITY:secret, A1_RUN_ID:runId,A1_THREAD_ID:fixture.threadId,
    } });
    const code = await new Promise<number | null>((resolve,reject) => { child.once("error",reject); child.once("exit",resolve); });
    if (code !== 0) throw new Error("Python MCP integration failed");
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); await fixture.close(); }
}
void main().catch(() => { console.error("MCP integration failed; check isolated fixtures and dependencies");process.exitCode=1; });
