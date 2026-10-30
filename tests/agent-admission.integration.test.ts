import { saveCandidateReview } from "../lib/knowledge/candidate-review";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it } from "vitest";
import { syntheticFixtures } from "./support/review-fixtures";
import { admitAgentRun, claimAgentRun, commitAgentProposal, controlAgentRun, cancelAgentRun, sourceHash } from "../lib/agent/admission";
import { contextSchema } from "../contracts/agent/schema";
import { MockAIProvider } from "../lib/ai/mock-provider";
import { runThreadClassification, reviewClassification } from "../lib/classification/service";
import { runAutomaticProcessing, saveDraftEdits, confirmAndSimulateSend } from "../lib/processing/service";
let f:ReturnType<typeof syntheticFixtures>;
beforeEach(()=>{f=syntheticFixtures();});afterEach(async()=>{await f.cleanup();});
async function prepared(preGenerate=false){
 const item=await f.create({preGenerate,label:"Policy"});
 const c=preGenerate?await f.db.classification.findFirstOrThrow({where:{threadId:item.threadId}}):await runThreadClassification(item.threadId,new MockAIProvider(),f.db);
 const runId=randomUUID(),owner=randomUUID(),commandId=randomUUID();
 const admission=await admitAgentRun({runId,classificationId:c.id},f.db);
 const claim=await claimAgentRun({runId,owner,commandId,expectedRevision:0},f.db);
 const entry=await f.db.knowledgeEntry.findUniqueOrThrow({where:{id:item.entryId}});
 const args={runId,owner,fence:claim.fence,commandId,proposal:{contractVersion:"agent-v1" as const,runId,commandId,fence:claim.fence,context:contextSchema.parse(admission.context),outcome:"DRAFT" as const,subject:item.title,body:item.answer,language:"en" as const,
 source:{entryId:entry.id,revisionId:entry.currentRevisionId!,contentHash:sourceHash(entry,entry.currentRevisionId!)},reason:"SUPPORTED" as const},classification:{category:"KNOWN_QUESTION",language:"en",confidence:.99,requiresHumanReview:false},retrievalQuery:item.marker,provider:"mock",model:"mock-agent-v1",promptVersion:"agent-prompt-v1"};
 return {item,c,args,claim};
}
it("commits a grounded draft atomically and replays only identical semantic payloads",async()=>{
 const {args,c}=await prepared();const first=await commitAgentProposal(args,f.db);
 expect(await commitAgentProposal(args,f.db)).toEqual(first);
 expect(await f.db.draft.count({where:{classificationId:c.id}})).toBe(1);
 await expect(commitAgentProposal({...args,proposal:{...args.proposal,body:"changed"}},f.db)).rejects.toThrow();
 const draft=await f.db.draft.findFirstOrThrow({where:{classificationId:c.id}});
 expect(draft.status).toBe("GENERATED");expect(draft.inputSnapshot).toMatchObject({kind:"GROUNDED"});
 expect(await f.db.agentCommitReceipt.count({where:{runId:args.runId}})).toBe(1);
});
it.each(["inbound","review","retire","revision","classification","reconstruction"])("rejects stale %s while preserving earlier output",async(kind)=>{
 const {item,args,c}=await prepared(true);const old=await f.db.draft.findFirstOrThrow({where:{classificationId:c.id}});
 if(kind==="inbound")await f.db.emailMessage.updateMany({where:{threadId:item.threadId},data:{cleanBody:"Changed inbound"}});
 if(kind==="review")await saveDraftEdits({draftId:old.id,expectedReviewRevision:old.reviewRevision,subject:old.subject,body:"Human edit",language:"en"},f.db);
 if(kind==="retire")await f.db.knowledgeEntry.update({where:{id:item.entryId},data:{status:"INACTIVE"}});
 if(kind==="revision"){
  const candidate=await f.db.knowledgeCandidate.findUniqueOrThrow({where:{id:item.candidateId}});
  await saveCandidateReview({candidateId:item.candidateId,expectedRevision:candidate.revision,decision:"APPROVED",title:item.title,canonicalQuestion:item.question,answer:item.answer+" Updated policy.",category:"SHIPPING",language:"en",note:"Synthetic human revision."},f.db);
 }
 if(kind==="classification")await reviewClassification({classificationId:c.id,expectedRevision:c.revision,category:"MANUAL_REVIEW"},f.db);
 if(kind==="reconstruction"){const other=await f.create();await f.reconstruct({parentThreadId:other.threadId,childThreadId:item.threadId});}
 const afterReview=await f.db.draft.findUniqueOrThrow({where:{id:old.id}});
 await expect(commitAgentProposal(args,f.db)).rejects.toThrow();
 expect(await f.db.draft.findUniqueOrThrow({where:{id:old.id}})).toEqual(afterReview);
 expect(await f.db.agentCommitReceipt.count({where:{runId:args.runId}})).toBe(0);
});
it("fences expired executors and blocks cancel-late results",async()=>{
 const {args,claim}=await prepared();
 await f.db.agentAdmission.update({where:{id:args.runId},data:{leaseUntil:new Date(0)}});
 await expect(commitAgentProposal(args,f.db)).rejects.toThrow();
 const next=await claimAgentRun({runId:args.runId,owner:randomUUID(),commandId:randomUUID(),expectedRevision:claim.revision},f.db);
 expect(next.fence).toBeGreaterThan(args.fence);
 await expect(controlAgentRun({runId:args.runId,owner:args.owner,fence:args.fence,action:"HEARTBEAT"},f.db)).rejects.toThrow();
 await cancelAgentRun({runId:args.runId,expectedRevision:next.revision},f.db);
 await expect(commitAgentProposal({...args,owner:next.owner!,fence:next.fence,proposal:{...args.proposal,fence:next.fence}},f.db)).rejects.toThrow();
});
it("rejects concurrent claims and duplicate resume mutations",async()=>{
 const {args,claim}=await prepared();
 await expect(claimAgentRun({runId:args.runId,owner:randomUUID(),commandId:randomUUID(),expectedRevision:claim.revision},f.db)).rejects.toThrow();
 const paused=await controlAgentRun({runId:args.runId,owner:args.owner,fence:args.fence,action:"PAUSE"},f.db);
 const resume={runId:args.runId,owner:randomUUID(),commandId:randomUUID(),expectedRevision:paused.revision};
 const restored=await claimAgentRun(resume,f.db);expect(await claimAgentRun(resume,f.db)).toEqual(restored);
 await expect(claimAgentRun({...resume,owner:randomUUID()},f.db)).rejects.toThrow();
});
it("two no-draft runs cannot both publish",async()=>{
 const {args,c}=await prepared();const id=randomUUID(),owner=randomUUID(),commandId=randomUUID();
 const admission=await admitAgentRun({runId:id,classificationId:c.id},f.db);const claim=await claimAgentRun({runId:id,owner,commandId,expectedRevision:0},f.db);
 const second={...args,runId:id,owner,commandId,fence:claim.fence,proposal:{...args.proposal,runId:id,commandId,fence:claim.fence,context:contextSchema.parse(admission.context)}};
 const outcomes=await Promise.allSettled([commitAgentProposal(args,f.db),commitAgentProposal(second,f.db)]);
 expect(outcomes.filter(r=>r.status==="fulfilled")).toHaveLength(1);expect(await f.db.draft.count({where:{classificationId:c.id}})).toBe(1);
});
it("agent and legacy generation race through the same context revision",async()=>{
 const {args,c}=await prepared();let release!:()=>void;let reached!:()=>void;
 const ready=new Promise<void>(resolve=>{reached=resolve;});const gate=new Promise<void>(resolve=>{release=resolve;});
 class Slow extends MockAIProvider {override async generateDraft(input:Parameters<MockAIProvider["generateDraft"]>[0]){reached();await gate;return super.generateDraft(input);}}
 const legacy=runAutomaticProcessing(c.id,new Slow(),f.db);await ready;
 await commitAgentProposal(args,f.db);release();await expect(legacy).rejects.toThrow();
 expect(await f.db.draft.count({where:{classificationId:c.id,status:"GENERATED"}})).toBe(1);
});
it("rolls back business mutation if receipt persistence fails",async()=>{
 const {args,c}=await prepared(true);const before=await f.db.draft.findFirstOrThrow({where:{classificationId:c.id}});
 const injected=f.db.$extends({query:{agentCommitReceipt:{async create(){throw new Error("Injected receipt write failure");}}}}) as unknown as typeof f.db;
 await expect(commitAgentProposal(args,injected)).rejects.toThrow("Injected receipt write failure");
 expect(await f.db.draft.findUniqueOrThrow({where:{id:before.id}})).toEqual(before);
 expect((await f.db.classification.findUniqueOrThrow({where:{id:c.id}})).revision).toBe(c.revision);
 expect(await f.db.agentCommitReceipt.count({where:{runId:args.runId}})).toBe(0);
 await expect(commitAgentProposal(args,f.db)).resolves.toMatchObject({status:"DRAFT_READY"});
});
it("low confidence cannot approve a classification or create a draft",async()=>{
 const {args,c}=await prepared();
 await expect(commitAgentProposal({...args,classification:{...args.classification,confidence:.1}},f.db)).rejects.toThrow();
 expect(await f.db.draft.count({where:{classificationId:c.id}})).toBe(0);
 expect((await f.db.classification.findUniqueOrThrow({where:{id:c.id}})).reviewStatus).toBe(c.reviewStatus);
});

it("confirmed history remains immutable when a late Agent proposal arrives",async()=>{
 const {args,c}=await prepared(true);const draft=await f.db.draft.findFirstOrThrow({where:{classificationId:c.id}});
 await confirmAndSimulateSend({draftId:draft.id,expectedReviewRevision:draft.reviewRevision,subject:draft.subject,body:draft.body,language:draft.language},f.db);
 const confirmed=await f.db.draft.findUniqueOrThrow({where:{id:draft.id}});
 await expect(commitAgentProposal(args,f.db)).rejects.toThrow();
 expect(await f.db.draft.findUniqueOrThrow({where:{id:draft.id}})).toEqual(confirmed);
});
