import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import { admitAgentRun,sourceHash } from "./admission";
import { previewSchema,type AgentUiView } from "./ui-contract";
import { inboundContextQuery,loadClassificationContext } from "@/lib/workflow/context";
import { runThreadClassification } from "@/lib/classification/service";
import { MockAIProvider } from "@/lib/ai/mock-provider";
export async function createUiRun(threadId:string,runId:string,db:PrismaClient){
 const thread=await db.emailThread.findUniqueOrThrow({where:{id:threadId},include:{classifications:{orderBy:[{createdAt:"desc"},{id:"desc"}],take:1},messages:inboundContextQuery}});
 if(thread.mergedIntoThreadId)throw new Error("STALE");
 let classification=thread.classifications[0];
 if(!classification)classification=await runThreadClassification(threadId,new MockAIProvider(),db);
 else {try{await loadClassificationContext(classification.id,db);}catch{classification=await runThreadClassification(threadId,new MockAIProvider(),db);}}
 await admitAgentRun({runId,classificationId:classification.id},db);
 return readUiRun(threadId,db,runId);
}
export async function readUiRun(threadId:string,db:PrismaClient,id?:string):Promise<AgentUiView|null>{
 const run=await db.agentAdmission.findFirst({where:{...(id?{id}:{}),classification:{threadId}},orderBy:[{createdAt:"desc"},{id:"desc"}],include:{receipts:true}});
 if(!run)return null;
 const parsed=previewSchema.safeParse(run.preview);let preview=parsed.success?parsed.data:null;
 const receipt=run.receipts[0]?.result as {draftId?:string}|undefined;
 if(!preview&&receipt?.draftId){const draft=await db.draft.findUnique({where:{id:receipt.draftId},include:{knowledgeSources:true}});if(draft?.knowledgeSources[0]?.knowledgeRevisionId){
  const s=draft.knowledgeSources[0];const r=await db.knowledgeRevision.findUniqueOrThrow({where:{id:s.knowledgeRevisionId!}});preview=previewSchema.parse({proposal:{contractVersion:"agent-v1",runId:run.id,commandId:run.receipts[0].commandId,fence:Math.max(1,run.fence),context:run.context,outcome:"DRAFT",subject:draft.subject,body:draft.body,language:draft.language,source:{entryId:s.knowledgeEntryId,revisionId:s.knowledgeRevisionId,contentHash:sourceHash({id:r.knowledgeEntryId,title:r.title,answer:r.answer,language:r.language},r.id)},reason:"SUPPORTED"},modelCalls:null,toolCalls:null,steps:[],code:"RECEIPT_RECOVERED"});
 }}
 const source=preview?.proposal?.source;
 const revision=source?await db.knowledgeRevision.findUnique({where:{id:source.revisionId},include:{knowledgeEntry:true}}):null;
 const evidence=revision?{entryId:revision.knowledgeEntryId,revisionId:revision.id,version:revision.version,title:revision.title,answer:revision.answer,language:revision.language,current:revision.knowledgeEntry.status==="ACTIVE"&&revision.knowledgeEntry.currentRevisionId===revision.id}:null;
 let stale=false;try{const c=await loadClassificationContext(run.classificationId,db);const snapshot=run.context as {classificationRevision:number;draft:{id:string;reviewRevision:number}|null};
  const draft=await db.draft.findFirst({where:{classificationId:c.id,status:"GENERATED"},orderBy:[{createdAt:"desc"},{id:"desc"}],select:{id:true,reviewRevision:true}});
  stale=c.revision!==snapshot.classificationRevision||JSON.stringify(draft)!==JSON.stringify(snapshot.draft)||(!!source&&(!evidence||!evidence.current));
 }catch{stale=true;}
 return {id:run.id,status:run.status,revision:run.revision,leaseActive:!!run.leaseUntil&&run.leaseUntil>new Date(),preview,stale:run.status==="COMMITTED"?false:stale,evidence,draftId:receipt?.draftId??null};
}
export async function persistUiPreview(runId:string,input:unknown,db:PrismaClient){
 const preview=previewSchema.parse(input);
 if(!preview.proposal||preview.proposal.runId!==runId)throw new Error("Preview belongs to another run");
 await db.agentAdmission.updateMany({where:{id:runId,status:"WAITING_FOR_HUMAN",fence:preview.proposal?.fence},data:{preview}});
}
export function uiCommand(run:{id:string;revision:number;fence:number;context:unknown},action:string){return {contractVersion:"agent-v1",action,runId:run.id,commandId:randomUUID(),expectedRunRevision:run.revision,fence:Math.max(1,run.fence),context:run.context,graphVersion:"agent-graph-v1",policyVersion:"agent-policy-v1",promptVersion:"agent-prompt-v1",traceId:randomUUID()};}
