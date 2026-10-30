import { searchActiveKnowledge } from "@/lib/knowledge/search";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { PrismaClient, Prisma } from "@/generated/prisma/client";
import { contextSchema, proposalSchema, validateContract } from "@/contracts/agent/schema";
import { AUTOMATIC_CLASSIFICATION_CONFIDENCE } from "@/lib/classification/service";
import { classificationResultSchema, draftResultSchema } from "@/lib/ai/provider";
import { canonical } from "@/lib/evaluation/benchmark/schemas";
import { loadClassificationContext, isTerminalProcessing, knowledgeFingerprint } from "@/lib/workflow/context";
import { WorkflowConflictError, workflowTransaction } from "@/lib/workflow/transaction";
import { captureApprovedKnowledgeInTransaction, sameKnowledgeFacts } from "@/lib/knowledge/revisions";
import { captureDraftInput } from "@/lib/processing/evidence";
import { persistGroundedDraft } from "@/lib/processing/commit-grounded-draft";
export const sourceHash = (entry: {id:string;title:string;answer:string;language:string}, revisionId:string) => createHash("sha256").update(JSON.stringify([entry.id,revisionId,entry.title,entry.answer,entry.language])).digest("hex");
const uuid = z.string().uuid();
const leaseInput = z.strictObject({ runId:uuid, owner:uuid, fence:z.number().int().positive() });
const claimInput = z.strictObject({ runId:uuid, owner:uuid, commandId:uuid, expectedRevision:z.number().int().nonnegative() });
const commitInput = leaseInput.extend({commandId:uuid, proposal:proposalSchema, classification:classificationResultSchema,
 model:z.string().min(1).max(100), provider:z.enum(["mock","gemini"]), promptVersion:z.literal("agent-prompt-v1"),retrievalQuery:z.string().min(2).max(500).nullable()});
export class StaleAgentContext extends WorkflowConflictError {}
function digest(value:unknown){return createHash("sha256").update(canonical(value)).digest("hex");}
async function snapshot(classificationId:string, tx:Prisma.TransactionClient){
 const c=await loadClassificationContext(classificationId,tx);
 if(isTerminalProcessing(c.processingStatus))throw new StaleAgentContext();
 const draft=await tx.draft.findFirst({where:{classificationId,status:"GENERATED"},orderBy:[{createdAt:"desc"},{id:"desc"}],select:{id:true,reviewRevision:true}});
 return {c,context:{threadId:c.threadId,contextHash:c.sourceContextHash!,classificationRevision:c.revision,draft}};
}
async function current(run:{classificationId:string;context:unknown}, tx:Prisma.TransactionClient){
 try { const state=await snapshot(run.classificationId,tx);
 if(digest(state.context)!==digest(contextSchema.parse(run.context)))throw new StaleAgentContext();return state;
 }catch{throw new StaleAgentContext();}
}
function live(run:{status:string;owner:string|null;fence:number;leaseUntil:Date|null},lease:z.infer<typeof leaseInput>){
 if(run.status!=="RUNNING"||run.owner!==lease.owner||run.fence!==lease.fence||!run.leaseUntil||run.leaseUntil<=new Date())throw new WorkflowConflictError();
}
export async function admitAgentRun(input:unknown,db:PrismaClient){
 const args=z.strictObject({runId:uuid,classificationId:uuid}).parse(input);
 return workflowTransaction(db,async tx=>{
  const existing=await tx.agentAdmission.findUnique({where:{id:args.runId}});
  if(existing){if(existing.classificationId!==args.classificationId)throw new WorkflowConflictError();return existing;}
  const {context}=await snapshot(args.classificationId,tx);
  return tx.agentAdmission.create({data:{id:args.runId,classificationId:args.classificationId,context}});
 });
}
export async function claimAgentRun(input:unknown,db:PrismaClient){
 const args=claimInput.parse(input);
 try { return await workflowTransaction(db,async tx=>{
  const run=await tx.agentAdmission.findUniqueOrThrow({where:{id:args.runId}});
  if(run.claimId===args.commandId){
   if(run.claimHash!==digest(args))throw new WorkflowConflictError();
   live(run,{...args,fence:run.fence});return run;
  }
  if(!["READY","WAITING_FOR_HUMAN","RUNNING","FAILED"].includes(run.status)||run.revision!==args.expectedRevision||(run.status==="RUNNING"&&run.leaseUntil&&run.leaseUntil>new Date()))throw new WorkflowConflictError();
  await current(run,tx);
  return tx.agentAdmission.update({where:{id:run.id,revision:run.revision},data:{status:"RUNNING",owner:args.owner,claimId:args.commandId,claimHash:digest(args),fence:{increment:1},revision:{increment:1},leaseUntil:new Date(Date.now()+30000)}});
 }); } catch(error){
  if(error instanceof StaleAgentContext)await db.agentAdmission.updateMany({where:{id:args.runId,revision:args.expectedRevision,status:{notIn:["COMMITTED","CANCELLED"]}},data:{status:"STALE",revision:{increment:1},fence:{increment:1},leaseUntil:null}});
  throw error;
 }
}
export async function controlAgentRun(input:unknown,db:PrismaClient){
 const args=leaseInput.extend({action:z.enum(["HEARTBEAT","PAUSE","FAIL","CANCEL","STALE"])}).parse(input);
 return workflowTransaction(db,async tx=>{
  const run=await tx.agentAdmission.findUniqueOrThrow({where:{id:args.runId}});
  if(args.action==="CANCEL"&&run.status==="CANCELLED")return run;
  live(run,args);
  if(args.action==="HEARTBEAT")return tx.agentAdmission.update({where:{id:run.id,fence:args.fence},data:{leaseUntil:new Date(Date.now()+30000)}});
  if(args.action!=="STALE")await current(run,tx);
  return tx.agentAdmission.update({where:{id:run.id,fence:args.fence},data:{status:args.action==="STALE"?"STALE":args.action==="PAUSE"?"WAITING_FOR_HUMAN":args.action==="CANCEL"?"CANCELLED":"FAILED",revision:{increment:1},leaseUntil:null,...(args.action==="CANCEL"?{fence:{increment:1}}:{})}});
 });
}
export async function cancelAgentRun(input:unknown,db:PrismaClient){
 const args=z.strictObject({runId:uuid,expectedRevision:z.number().int().nonnegative()}).parse(input);
 return workflowTransaction(db,async tx=>{
  const run=await tx.agentAdmission.findUniqueOrThrow({where:{id:args.runId}});
  if(run.status==="CANCELLED")return run;
  if(run.status==="COMMITTED"||run.revision!==args.expectedRevision)throw new WorkflowConflictError();
  return tx.agentAdmission.update({where:{id:run.id,revision:args.expectedRevision},data:{status:"CANCELLED",revision:{increment:1},fence:{increment:1},leaseUntil:null}});
 });
}
export async function commitAgentProposal(input:unknown,db:PrismaClient){
 const startedAt=performance.now();
 const args=commitInput.parse(input);validateContract("proposal",args.proposal);
 // Execution fences change after a crash. Semantic replay binds the proposal's
 // original content/context/command, but excludes renewed lease ownership/fence.
 const hash=digest({...args,owner:undefined,fence:undefined,proposal:{...args.proposal,fence:undefined}});
 return workflowTransaction(db,async tx=>{
  const receipt=await tx.agentCommitReceipt.findUnique({where:{runId_commandId:{runId:args.runId,commandId:args.commandId}}});
  if(receipt){if(receipt.payloadHash!==hash)throw new WorkflowConflictError();return receipt.result;}
  const run=await tx.agentAdmission.findUniqueOrThrow({where:{id:args.runId}});live(run,args);
  if(args.proposal.runId!==run.id||args.proposal.commandId!==args.commandId||args.proposal.fence!==args.fence||digest(args.proposal.context)!==digest(run.context))throw new WorkflowConflictError();
  const {c:context}=await current(run,tx);
  const category=context.reviewedCategory??context.aiCategory;
  let result:Prisma.InputJsonObject;
  if(args.proposal.outcome==="DRAFT"){
   if(context.reviewStatus==="PENDING"||!["KNOWN_QUESTION","UNKNOWN_QUESTION"].includes(category)||args.classification.confidence<AUTOMATIC_CLASSIFICATION_CONFIDENCE||args.classification.requiresHumanReview||args.classification.category!==category||args.classification.language!==context.aiLanguage||args.proposal.language!==context.aiLanguage||!args.proposal.source)throw new WorkflowConflictError();
   const captured=await captureApprovedKnowledgeInTransaction(args.proposal.source.entryId,tx).catch(error=>{if(error instanceof WorkflowConflictError)throw new StaleAgentContext();throw error;});
   const {entry:knowledge,revision:knowledgeRevision}=captured;
   if(knowledgeRevision.id!==args.proposal.source.revisionId||sourceHash(knowledge,knowledgeRevision.id)!==args.proposal.source.contentHash||!sameKnowledgeFacts(knowledge,knowledgeRevision))throw new StaleAgentContext();
   if(!args.retrievalQuery)throw new WorkflowConflictError();
   const matches=await searchActiveKnowledge({q:args.retrievalQuery,language:args.proposal.language,limit:8},tx);
   const match=matches.find(item=>item.id===knowledge.id);if(!match)throw new StaleAgentContext();
   const draft=await persistGroundedDraft({context,reviewToken:args.proposal.context.draft,knowledge,knowledgeRevision,fingerprint:knowledgeFingerprint(knowledge),inputSnapshot:captureDraftInput(context,[knowledgeRevision.id]),
    validated:draftResultSchema.parse({subject:args.proposal.subject!,body:args.proposal.body!,language:args.proposal.language,knowledgeSourceIds:[knowledge.id],requiresHumanReview:true}),provider:{id:args.provider,model:args.model,draftPromptVersion:args.promptVersion},query:args.retrievalQuery,relevanceScore:match.score,latencyMs:Math.max(0,Math.round(performance.now()-startedAt)),extraMetadata:{agentRunId:run.id,latencyScope:"BUSINESS_VALIDATION_ONLY",relevanceScoreMeasured:true,classificationProposal:args.classification}},tx);
   result={draftId:draft.id,status:"DRAFT_READY"};
  }else{
   const pending=context.reviewStatus==="PENDING";
   await tx.classification.update({where:{id:context.id,revision:context.revision},data:{revision:{increment:1},route:pending?"MANUAL_REVIEW":"HUMAN_ANSWER_QUEUE",processingStatus:pending?"WAITING_FOR_REVIEW":"AWAITING_HUMAN_ANSWER",routingReason:"Agent requested human handling."}});
   result={status:"HUMAN_REVIEW"};
  }
  await tx.agentAdmission.update({where:{id:run.id,fence:args.fence},data:{status:"COMMITTED",revision:{increment:1},leaseUntil:null}});
  await tx.agentCommitReceipt.create({data:{runId:run.id,commandId:args.commandId,payloadHash:hash,result}});
  return result;
 });
}
