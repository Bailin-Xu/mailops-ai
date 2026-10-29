import { z } from "zod";
import { snapshotRepository } from "./snapshot-repository";
import { createMcpHttpServer } from "./server";
async function main() {
  const config = z.object({
    AGENT_FIXTURE_DATABASE_URL:z.string(), MCP_CASE_ID:z.string().min(1),
    MCP_RUN_ID:z.string().uuid(), MCP_CAPABILITY:z.string().min(32),
    MCP_PORT:z.coerce.number().int().min(1024).max(65535).default(8103),
  }).parse(process.env);
  const fixture=await snapshotRepository(config.AGENT_FIXTURE_DATABASE_URL,config.MCP_CASE_ID);
  const server=createMcpHttpServer(fixture.repository,{runId:config.MCP_RUN_ID,threadId:fixture.threadId,expiresAt:Date.now()+300000},config.MCP_CAPABILITY);
  server.on("error",()=>{void fixture.close();console.error("MCP listener unavailable");process.exitCode=1;});
  server.listen(config.MCP_PORT,"127.0.0.1",()=>console.log("Synthetic read-only MCP listener ready"));
  async function stop(){await new Promise<void>(resolve=>server.close(()=>resolve()));await fixture.close();}
  process.once("SIGTERM",()=>{void stop();});process.once("SIGINT",()=>{void stop();});
}
void main().catch(()=>{console.error("MCP startup rejected: explicit synthetic target and capability required");process.exitCode=1;});
