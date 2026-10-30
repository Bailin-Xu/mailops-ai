import { createServer } from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { Client } from "pg";
import { syntheticFixtures } from "../../tests/support/review-fixtures";
import { saveCandidateReview } from "../../lib/knowledge/candidate-review";
import { runThreadClassification } from "../../lib/classification/service";
import { runAutomaticProcessing } from "../../lib/processing/service";
import { MockAIProvider } from "../../lib/ai/mock-provider";
import { applicationRepository } from "../../services/mcp/application-repository";
import { createMcpHttpServer } from "../../services/mcp/server";
import { admitAgentRun,claimAgentRun,controlAgentRun,cancelAgentRun,commitAgentProposal,StaleAgentContext } from "../../lib/agent/admission";
const checkpointUrl="postgresql://mailops_agent_checkpoint:mailops_agent_checkpoint_local@127.0.0.1:5436/mailops_agent_checkpoint";
async function main(){
 const fixture=syntheticFixtures();const db=fixture.db;const token=randomBytes(32).toString("hex");
 const checkpoint=new Client({connectionString:checkpointUrl});await checkpoint.connect();
 const ids:string[]=[];
 const bridge=createServer(async(req,res)=>{
  if(req.headers.authorization!==`Bearer ${token}`){res.writeHead(403);res.end();return;}
  try{let raw="";for await(const chunk of req){raw+=chunk;if(raw.length>50000)throw new Error();}
   const {op,data}=JSON.parse(raw);let result;
   switch(op){case"CLAIM":result=await claimAgentRun(data,db);break;case"CONTROL":result=await controlAgentRun(data,db);break;case"CANCEL":result=await cancelAgentRun(data,db);break;case"COMMIT":result=await commitAgentProposal(data,db);break;case"STATUS":result=await db.agentAdmission.findUniqueOrThrow({where:{id:data.runId},include:{receipts:{select:{commandId:true,result:true}}}});break;default:throw new Error();}
   res.writeHead(200,{"Content-Type":"application/json"});res.end(JSON.stringify(result));
  }catch(error){res.writeHead(409,{"Content-Type":"application/json"});res.end(JSON.stringify({code:error instanceof StaleAgentContext?"STALE":"CONFLICT"}));}
 });
 await new Promise<void>(resolve=>bridge.listen(0,"127.0.0.1",resolve));
 const bridgeUrl=`http://127.0.0.1:${(bridge.address() as {port:number}).port}/api/agent/commands`;
 try{
  for(const hook of ["none","tool","checkpoint","commit","loss","cancel","unavailable","rejectcommit","revised"].filter(name=>!process.env.A3_TEST_CASE||process.env.A3_TEST_CASE===name)){
   const item=await fixture.create({label:"Policy"});const c=await runThreadClassification(item.threadId,new MockAIProvider(),db);
   const runId=randomUUID();ids.push(runId);const admitted=await admitAgentRun({runId,classificationId:c.id},db);
   const repo=await applicationRepository(db,runId);const cap=randomBytes(32).toString("hex");
   let mcp=createMcpHttpServer(repo.repository,{runId,threadId:item.threadId,expiresAt:Date.now()+300000},cap);
   await new Promise<void>(resolve=>mcp.listen(0,"127.0.0.1",resolve));
   const env={...process.env,AGENT_CHECKPOINT_DATABASE_URL:checkpointUrl,AGENT_BRIDGE_URL:bridgeUrl,AGENT_BRIDGE_TOKEN:token,AGENT_MCP_URL:`http://127.0.0.1:${(mcp.address() as {port:number}).port}/mcp`,MCP_CAPABILITY:cap};
   function probe(action:string,revision:number,activeHook="none"){
    const command={contractVersion:"agent-v1",action,runId,commandId:randomUUID(),expectedRunRevision:revision,fence:1,context:admitted.context,graphVersion:"agent-graph-v1",policyVersion:"agent-policy-v1",promptVersion:"agent-prompt-v1",traceId:randomUUID()};
    const child=spawn("services/agent/.venv/bin/python",["services/agent/durable_probe.py"],{env:{...env,AGENT_CHECKPOINT_DATABASE_URL:activeHook==="unavailable"?checkpointUrl.replace("checkpoint_local","checkpoint_wrong"):checkpointUrl,A3_HOOK:activeHook},stdio:["pipe","pipe","pipe"]});child.stdin.end(JSON.stringify(command));
    let output="",errors="";let readyResolve!:()=>void;
    const ready=new Promise<void>(resolve=>{readyResolve=resolve;});
    child.stdout.on("data",chunk=>{output+=chunk;if(output.includes("READY:"))readyResolve();});child.stderr.on("data",chunk=>{errors+=chunk;});
    const exited=new Promise<number|null>((resolve,reject)=>{child.on("error",reject);child.on("exit",code=>{if(code!==0&&code!==null)reject(new Error(errors+output));else resolve(code);});});
    return {child,ready,exited,output:()=>output};
   }
   let lostControl=false;
   try{
    if(hook==="cancel"){
     const worker=probe("START",0,"tool");await Promise.race([worker.ready,worker.exited]);
     const running=await db.agentAdmission.findUniqueOrThrow({where:{id:runId}});
     const cancel=probe("CANCEL",running.revision);await cancel.exited;
     await worker.exited.then(()=>undefined,error=>{if(!String(error).includes("DURABLE_COMMAND_CONFLICT"))throw error;});
     if((await db.agentAdmission.findUniqueOrThrow({where:{id:runId}})).status!=="CANCELLED"||await db.draft.count({where:{classificationId:c.id}})!==0)throw new Error("Late cancelled worker mutated business data");
     console.log("Durable cancellation: cancelled active process cannot checkpoint or commit late results");continue;
    }
    if(hook==="unavailable"){
     const unavailable=probe("START",0,"unavailable");
     await unavailable.exited.then(()=>{throw new Error("Bad checkpoint connection accepted");},error=>{if(!String(error).includes("CHECKPOINT_OR_SERVICE_UNAVAILABLE"))throw error;});
     if((await db.agentAdmission.findUniqueOrThrow({where:{id:runId}})).status!=="READY")throw new Error("Unavailable checkpoint store touched business state");
    }
    if(hook==="tool"||hook==="checkpoint"){
     const killed=probe("START",0,hook);await Promise.race([killed.ready,killed.exited.then(()=>{throw new Error("No kill checkpoint reached");})]);
     if(hook==="tool"){
      const active=await db.agentAdmission.findUniqueOrThrow({where:{id:runId}});
      const competing=probe("RESUME",active.revision);
      await competing.exited.then(()=>{throw new Error("Concurrent executor accepted");},error=>{if(!String(error).includes("DURABLE_COMMAND_CONFLICT"))throw error;});
     }
     killed.child.kill("SIGKILL");await killed.exited;
     await checkpoint.query("UPDATE agent_runtime_a3 SET lease_until=now()-interval '1 second' WHERE run_id=$1",[runId]);
     await db.agentAdmission.update({where:{id:runId},data:{leaseUntil:new Date(0)}});
     const busy=await db.agentAdmission.findUniqueOrThrow({where:{id:runId}});const recovered=probe("RESUME",busy.revision);await recovered.exited;
     if(!recovered.output().includes("WAITING_FOR_HUMAN"))throw new Error("Recovery did not pause for review");
    }else{const first=probe("START",0);await first.exited;if(!first.output().includes("WAITING_FOR_HUMAN"))throw new Error("No human pause");}
    const paused=await db.agentAdmission.findUniqueOrThrow({where:{id:runId}});
    if(hook==="revised"){
     const candidate=await db.knowledgeCandidate.findUniqueOrThrow({where:{id:item.candidateId}});
     await saveCandidateReview({candidateId:item.candidateId,expectedRevision:candidate.revision,decision:"APPROVED",title:item.title,canonicalQuestion:item.question,answer:item.answer+" Updated by human.",category:"SHIPPING",language:"en",note:"Synthetic human review."},db);
     await new Promise<void>(resolve=>mcp.close(()=>resolve()));
     mcp=createMcpHttpServer(repo.repository,{runId,threadId:item.threadId,expiresAt:Date.now()+300000},cap);
     await new Promise<void>(resolve=>mcp.listen(0,"127.0.0.1",resolve));
     env.AGENT_MCP_URL=`http://127.0.0.1:${(mcp.address() as {port:number}).port}/mcp`;
     const stale=probe("RESUME",paused.revision);await stale.exited;
     if(!stale.output().includes("STALE")||await db.draft.count({where:{classificationId:c.id}})!==0)throw new Error("Knowledge change did not invalidate human-paused work: "+stale.output());
     if((await db.agentAdmission.findUniqueOrThrow({where:{id:runId}})).status!=="STALE")throw new Error("Business admission did not record staleness");
     console.log("Durable human pause: knowledge revision and MCP recreation invalidate old evidence");continue;
    }
    if(hook==="loss"){
     for(const table of ["checkpoint_writes","checkpoint_blobs","checkpoints"])await checkpoint.query(`DELETE FROM ${table} WHERE thread_id=$1`,[runId]);
     const lost=probe("RESUME",paused.revision);await lost.exited;
     if(!lost.output().includes("CHECKPOINT_UNAVAILABLE"))throw new Error("Lost checkpoints silently reran");
     if(await db.draft.count({where:{classificationId:c.id}})!==0)throw new Error("Lost graph committed a draft");
     await runAutomaticProcessing(c.id,new MockAIProvider(),db);
     if(await db.draft.count({where:{classificationId:c.id}})!==1)throw new Error("Baseline unavailable after checkpoint loss");
     console.log("Durable checkpoint loss: explicit failure; legacy workflow remains usable");continue;
    }
    const resumed=probe("RESUME",paused.revision,hook==="commit"?"commit":hook==="rejectcommit"?"rejectcommit":"none");
    if(hook==="commit"){
     await Promise.race([resumed.ready,resumed.exited.then(()=>{throw new Error("No committed response-loss point");})]);resumed.child.kill("SIGKILL");await resumed.exited;
     const stored=await db.agentAdmission.findUniqueOrThrow({where:{id:runId}});const retry=probe("RESUME",stored.revision);await retry.exited;
     if(!retry.output().includes("COMMITTED"))throw new Error("Receipt reconciliation failed");
     const priorBudget=(await checkpoint.query("SELECT models,tools FROM agent_runtime_a3 WHERE run_id=$1",[runId])).rows[0];
     if(priorBudget.models>6||priorBudget.tools>8)throw new Error("Persistent budget exceeded");
     for(const table of ["checkpoint_writes","checkpoint_blobs","checkpoints"])await checkpoint.query(`DELETE FROM ${table} WHERE thread_id=$1`,[runId]);
     await checkpoint.query("DELETE FROM agent_runtime_a3 WHERE run_id=$1",[runId]);lostControl=true;
     const lostCheckpoint=probe("RESUME",stored.revision);await lostCheckpoint.exited;
     if(!lostCheckpoint.output().includes("COMMITTED"))throw new Error("Business receipt was lost with checkpoint DB");

    }else if(hook==="rejectcommit"){
     await resumed.exited;if(!resumed.output().includes("COMMIT_UNKNOWN"))throw new Error("Commit failure was hidden");
     const before=(await checkpoint.query("SELECT models,tools FROM agent_runtime_a3 WHERE run_id=$1",[runId])).rows[0];
     await db.agentAdmission.update({where:{id:runId},data:{leaseUntil:new Date(0)}});
     const failed=await db.agentAdmission.findUniqueOrThrow({where:{id:runId}});const retried=probe("RESUME",failed.revision);await retried.exited;
     if(!retried.output().includes("COMMITTED"))throw new Error("Failed business submit could not safely retry: "+retried.output());
     const after=(await checkpoint.query("SELECT models,tools FROM agent_runtime_a3 WHERE run_id=$1",[runId])).rows[0];
     if(JSON.stringify(before)!==JSON.stringify(after))throw new Error("Commit retry repeated model/tool work");
    }else{await resumed.exited;if(!resumed.output().includes("COMMITTED"))throw new Error("Resume did not commit: "+resumed.output());}
    if(await db.draft.count({where:{classificationId:c.id}})!==1||await db.agentCommitReceipt.count({where:{runId}})!==1)throw new Error("Duplicate or missing business mutation");
    const budget=(await checkpoint.query("SELECT models,tools FROM agent_runtime_a3 WHERE run_id=$1",[runId])).rows[0];if(!lostControl&&(!budget||budget.models>6||budget.tools>8))throw new Error("Persistent budget exceeded");
    console.log(`Durable recovery ${hook}: passed; one draft/receipt, cumulative budgets intact`);
   }finally{await new Promise<void>(resolve=>mcp.close(()=>resolve()));}
  }
 }finally{
  for(const id of ids){for(const table of ["checkpoint_writes","checkpoint_blobs","checkpoints"]){await checkpoint.query(`DELETE FROM ${table} WHERE thread_id=$1`,[id]);}await checkpoint.query("DELETE FROM agent_runtime_a3 WHERE run_id=$1",[id]);}
  await checkpoint.end();await new Promise<void>(resolve=>bridge.close(()=>resolve()));await fixture.cleanup();
 }
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
