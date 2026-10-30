import { randomUUID,createHash } from "node:crypto";
import { readFileSync,mkdirSync,writeFileSync,renameSync } from "node:fs";
import { spawn } from "node:child_process";
import { isDeepStrictEqual } from "node:util";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";
import data from "../../contracts/agent/dataset.json";
import { MockAIProvider } from "../../lib/ai/mock-provider";
import { knowledgeSchema } from "../../lib/evaluation/benchmark/schemas";
import { createManifest,evaluateCase } from "../../lib/evaluation/benchmark/runner";
import { snapshotRetriever } from "../../lib/evaluation/benchmark/retrieval";
import { agentTarget } from "./target";
import { snapshotRepository } from "../../services/mcp/snapshot-repository";
import { createMcpHttpServer } from "../../services/mcp/server";
import { sourceContextHash } from "../../lib/workflow/context";
import { blindPack,score,hash,type EvaluationResult } from "../../lib/evaluation/agent/review";
async function main(){
 if(process.argv.slice(2).length||process.env.A4_LIVE==='true')throw new Error("This command is mock-only");
 const raw=readFileSync('contracts/agent/dataset.json');const datasetHash=createHash('sha256').update(raw).digest('hex');
 if(datasetHash!==readFileSync('contracts/agent/dataset.sha256','utf8').trim())throw new Error('Frozen corpus changed');
 const url=agentTarget(process.env.AGENT_FIXTURE_DATABASE_URL);
 const db=new PrismaClient({adapter:new PrismaPg({connectionString:url})});
 const runId=randomUUID(),dir=`data/agent-runs/${runId}`;mkdirSync(dir,{recursive:true});
 const provider=new MockAIProvider();const results:EvaluationResult[]=[];
 const implementationHash=createHash('sha256').update(['lib/evaluation/benchmark/runner.ts','lib/evaluation/benchmark/retrieval.ts','lib/processing/service.ts','lib/knowledge/search.ts','lib/ai/mock-provider.ts','services/agent/models.py','services/agent/workflow.py','services/agent/evaluation_worker.py','services/mcp/snapshot-repository.ts','services/agent/requirements.lock','package-lock.json'].map(p=>readFileSync(p,'utf8')).join('\n')).digest('hex');
 const save=(name:string,value:unknown)=>{const path=`${dir}/${name}.json`;writeFileSync(path+".tmp",JSON.stringify(value,null,2),{mode:0o600});renameSync(path+".tmp",path);};
 try{
  const frozen=await db.$queryRawUnsafe<Array<{payload:unknown}>>("SELECT payload FROM agent_a0_fixtures.snapshot WHERE id='agent-synthetic-v1'");
  if(!isDeepStrictEqual(frozen[0]?.payload,data))throw new Error('Database snapshot differs from frozen corpus');
  const pg=(await db.$queryRawUnsafe<Array<{version:string}>>('SHOW server_version'))[0];
  const postgresVersion=Object.values(pg)[0];
  const knowledge=data.knowledge.map(k=>knowledgeSchema.parse({...k,canonicalQuestion:k.title,category:'KNOWN_QUESTION',version:1,approvedAt:'2026-10-29T00:00:00.000Z',language:k.language as 'en'|'fr',status:k.status as 'ACTIVE'|'INACTIVE'}));
  const cases=data.cases.filter(c=>c.split==='holdout');
  const manifest={runId,mode:'MOCK_REHEARSAL',datasetHash,implementationHash,postgresVersion,split:'holdout',repetitions:2,corpusScope:'all frozen knowledge, active-only at retrieval',rubricVersion:'agent-human-v1',humanReviewComplete:false,
   baseline:{model:provider.model,classificationPromptVersion:provider.classificationPromptVersion,draftPromptVersion:provider.draftPromptVersion,implementation:'existing TS evaluateCase/baseline-v1'},
   agent:{model:'mock-agent-v1',graphVersion:'agent-graph-v1',policyVersion:'agent-policy-v1',promptVersion:'agent-prompt-v1'},
   adapterNote:'Legacy baseline input format is adapted; original dataset hash above remains authoritative. Mock providers differ; no model-quality comparison is claimed.'};
  save('manifest',manifest);
  const baseline=createManifest({dataset:{version:'synthetic-bilingual-v1',split:'holdout',cases:cases.map(c=>({id:c.id,cohort:c.scenario,subject:c.subject,cleanBody:c.body,expectedRoute:c.expectedRoute as 'KNOWN_KNOWLEDGE'|'HUMAN_ANSWER_QUEUE',expectedLanguage:c.language as 'en'|'fr',relevantSourceIds:c.relevantSourceIds,supportedClaims:c.supportedClaims}))},knowledge,provider:{id:provider.id,model:provider.model,classificationPromptVersion:provider.classificationPromptVersion,draftPromptVersion:provider.draftPromptVersion},config:{retrieval:'baseline-v1',k:8,minRoutingAccuracy:1,maxMissedEscalationRate:0},implementationHash,postgresVersion});
  save('baseline-manifest',baseline);
  for(let repetition=0;repetition<2;repetition++)for(const item of cases)for(const system of (repetition%2?['agent','baseline']:['baseline','agent']) as Array<'baseline'|'agent'>){
   const traceId=randomUUID();const started=performance.now();let result:EvaluationResult;
   if(system==='baseline'){
    const evaluated=await evaluateCase(baseline,item.id,provider,snapshotRetriever(db));
    save(`${item.id}-${repetition}-baseline-trace`,{traceId,status:evaluated.status,error:evaluated.error,calls:evaluated.calls,retrievedIds:evaluated.retrievedIds});
    const known=evaluated.calls.every(c=>c.inputTokens!==null&&c.outputTokens!==null);
    result={caseId:item.id,system,repetition,status:evaluated.status,route:evaluated.route,body:(evaluated.draft as {body?:string}|undefined)?.body??null,
      sourceIds:evaluated.selectedRevisionId?[knowledge.find(k=>k.revisionId===evaluated.selectedRevisionId)!.id]:[],firstRetrievedIds:evaluated.retrievedIds,allRetrievedIds:evaluated.retrievedIds,
      latencyMs:performance.now()-started,inputTokens:known?evaluated.calls.reduce((s,c)=>s+c.inputTokens!,0):null,outputTokens:known?evaluated.calls.reduce((s,c)=>s+c.outputTokens!,0):null,traceId,error:evaluated.error};
   }else{
    const fixture=await snapshotRepository(url,item.id,'corpus');const capability=randomUUID()+randomUUID();const caseRunId=randomUUID();
    const server=createMcpHttpServer(fixture.repository,{runId:caseRunId,threadId:fixture.threadId,expiresAt:Date.now()+180000},capability);
    try{
     await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
     const body={contractVersion:'agent-v1',action:'START',runId:caseRunId,commandId:randomUUID(),expectedRunRevision:0,fence:1,context:{threadId:fixture.threadId,contextHash:sourceContextHash({id:fixture.threadId,subject:item.subject,messages:[{id:fixture.threadId,sentAt:null,cleanBody:item.body,normalizedBody:item.body}]}),classificationRevision:0,draft:null},graphVersion:'agent-graph-v1',policyVersion:'agent-policy-v1',promptVersion:'agent-prompt-v1',traceId};
     const child=spawn('services/agent/.venv/bin/python',['services/agent/evaluation_worker.py'],{env:{...process.env,A4_LIVE:'false',A1_MCP_URL:`http://127.0.0.1:${(server.address() as {port:number}).port}/mcp`,A1_CAPABILITY:capability},stdio:['pipe','pipe','pipe']});
     child.stdin.end(JSON.stringify(body));let output='';child.stdout.on('data',chunk=>{output+=chunk;});child.stderr.resume();
     const timeout=setTimeout(()=>child.kill('SIGKILL'),150000);
     const code=await new Promise<number|null>((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});clearTimeout(timeout);
     if(code!==0)throw new Error('Agent evaluation worker failed');
     const worker=JSON.parse(output);const r=worker.result;const searches=(r.observations??[]).filter((o:{name:string})=>o.name==='Search');
     const ids=(searches as Array<{result:{sources:Array<{entryId:string}>}}>).map(o=>o.result.sources.map(s=>s.entryId));
     result={caseId:item.id,system,repetition,status:r.code==='OK'?'COMPLETED':'EXECUTION_FAILED',route:r.proposal?.outcome==='DRAFT'?'KNOWN_KNOWLEDGE':r.proposal?'HUMAN_ANSWER_QUEUE':null,body:r.proposal?.body??null,sourceIds:r.proposal?.source?[r.proposal.source.entryId]:[],firstRetrievedIds:ids[0]??[],allRetrievedIds:[...new Set(ids.flat())],latencyMs:performance.now()-started,inputTokens:null,outputTokens:null,traceId,error:r.code==='OK'?null:r.code};
     save(`${item.id}-${repetition}-agent-trace`,worker.events);
    }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));await fixture.close();}
   }
   results.push(result);save('results',results);
  }
  const review=blindPack(results);save('review-pack',review);save('review-original',review);save('scorecard',score(results,[]));save('manifest',{...manifest,resultsHash:hash(results),reviewHash:hash(review)});save('status',{executionComplete:true,records:results.length,live:false,humanReviewComplete:false,qualityPassed:null});
  console.log(`Mock comparison completed: ${results.length} records. Human scores remain blank. Artifacts: ${dir}`);
 }finally{await db.$disconnect();}
}
void main().catch(()=>{console.error('Mock comparison incomplete; verify fixture database and local Python environment. Completed records remain saved.');process.exitCode=2;});
