import { applicationRepository } from "./application-repository";
import { PrismaClient } from "../../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { z } from "zod";
import { snapshotRepository } from "./snapshot-repository";
import { createMcpHttpServer } from "./server";
async function main() {
  const config = z.object({
    AGENT_FIXTURE_DATABASE_URL:z.string().optional(), MCP_CASE_ID:z.string().min(1).optional(),
    MCP_RUN_ID:z.string().uuid(), MCP_CAPABILITY:z.string().min(32),
    MCP_PORT:z.coerce.number().int().min(1024).max(65535).default(8103),
  }).parse(process.env);
  const fixture=await (async()=>{
    if(process.env.MCP_SOURCE!=="application")return snapshotRepository(config.AGENT_FIXTURE_DATABASE_URL??"",config.MCP_CASE_ID??"");
    if(process.env.AGENT_RUNTIME_ENABLED!=="true"||!process.env.DATABASE_URL)throw new Error("Application adapter is disabled");
    const db=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL,statement_timeout:1000,query_timeout:1500,connectionTimeoutMillis:1000})});
    return {...await applicationRepository(db,config.MCP_RUN_ID),close:()=>db.$disconnect()};
  })();
  const server=createMcpHttpServer(fixture.repository,{runId:config.MCP_RUN_ID,threadId:fixture.threadId,expiresAt:Date.now()+300000},config.MCP_CAPABILITY);
  server.on("error",()=>{void fixture.close();console.error("MCP listener unavailable");process.exitCode=1;});
  server.listen(config.MCP_PORT,"127.0.0.1",()=>console.log("Synthetic read-only MCP listener ready"));
  async function stop(){await new Promise<void>(resolve=>server.close(()=>resolve()));await fixture.close();}
  process.once("SIGTERM",()=>{void stop();});process.once("SIGINT",()=>{void stop();});
}
void main().catch(()=>{console.error("MCP startup rejected: explicit synthetic target and capability required");process.exitCode=1;});
