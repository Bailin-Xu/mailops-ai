import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createMcpHttpServer } from "@/services/mcp/server";
import { applicationRepository } from "@/services/mcp/application-repository";
import type { PrismaClient } from "@/generated/prisma/client";
import { uiCommand,persistUiPreview } from "./ui-service";
import { previewSchema } from "./ui-contract";
import { z } from "zod";
export async function executeUiRun(id:string,action:"START"|"RESUME"|"CANCEL"|"STATUS",origin:string,db:PrismaClient){
 const run=await db.agentAdmission.findUniqueOrThrow({where:{id}});
 const secret=randomBytes(32).toString("hex");
 let server:ReturnType<typeof createMcpHttpServer>|undefined;
 let mcpUrl="http://127.0.0.1:8103/mcp";
 try{
  if(action!=="CANCEL"&&action!=="STATUS"){
   const source=await applicationRepository(db,id);
   server=createMcpHttpServer(source.repository,{runId:id,threadId:source.threadId,expiresAt:Date.now()+180000},secret);
   await new Promise<void>(resolve=>server!.listen(0,"127.0.0.1",resolve));
   mcpUrl=`http://127.0.0.1:${(server.address() as {port:number}).port}/mcp`;
  }
  // Resolve the local interpreter at runtime; Next must not bundle the virtualenv.
  const interpreter=["services","agent",".venv","bin","python"].join("/");
  const child=spawn(interpreter,["services/agent/ui_command.py"],{stdio:["pipe","pipe","pipe"],env:{
   NODE_ENV:process.env.NODE_ENV,PATH:process.env.PATH,LANG:process.env.LANG,PYTHONUNBUFFERED:"1",AGENT_CHECKPOINT_DATABASE_URL:process.env.AGENT_CHECKPOINT_DATABASE_URL,
   AGENT_BRIDGE_URL:`${origin}/api/agent/commands`,AGENT_BRIDGE_TOKEN:process.env.AGENT_BRIDGE_TOKEN,
   AGENT_MCP_URL:mcpUrl,MCP_CAPABILITY:secret,LANGSMITH_TRACING:"false",LANGCHAIN_TRACING_V2:"false",
  }});
  child.stdin.end(JSON.stringify({...uiCommand(run,action==="STATUS"?"RESUME":action),readOnly:action==="STATUS"}));let output="";child.stdout.on("data",chunk=>{output+=chunk;if(output.length>100000)child.kill("SIGKILL");});child.stderr.resume();
  const timer=setTimeout(()=>child.kill("SIGKILL"),150000);let code:number|null;
  try{code=await new Promise<number|null>((resolve,reject)=>{child.once("error",reject);child.once("exit",resolve);});}finally{clearTimeout(timer);}
  if(code!==0)throw new Error("Agent service unavailable");
  const parsed=z.strictObject({status:z.string(),preview:previewSchema.nullable()}).parse(JSON.parse(output));
  if(parsed.preview)await persistUiPreview(id,parsed.preview,db);
 }finally{if(server)await new Promise<void>(resolve=>server!.close(()=>resolve()));}
}
