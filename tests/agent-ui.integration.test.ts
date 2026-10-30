import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, it, expect } from "vitest";
import { syntheticFixtures } from "./support/review-fixtures";
import { createUiRun, readUiRun, persistUiPreview } from "../lib/agent/ui-service";
import { claimAgentRun, controlAgentRun, cancelAgentRun, sourceHash } from "../lib/agent/admission";
import { contextSchema } from "../contracts/agent/schema";
let f: ReturnType<typeof syntheticFixtures>;
beforeEach(() => { f = syntheticFixtures(); });
afterEach(async () => { await f.cleanup(); });
async function paused() {
  const item = await f.create();
  const run = (await createUiRun(item.threadId, randomUUID(), f.db))!;
  const claim = await claimAgentRun({runId:run.id, expectedRevision:run.revision, owner:randomUUID(), commandId:randomUUID()}, f.db);
  await controlAgentRun({runId:run.id, owner:claim.owner!, fence:claim.fence, action:"PAUSE"}, f.db);
  const entry = await f.db.knowledgeEntry.findUniqueOrThrow({where:{id:item.entryId}});
  const preview = {proposal:{contractVersion:"agent-v1", runId:run.id, commandId:randomUUID(), fence:claim.fence,
    context:contextSchema.parse(claim.context), outcome:"DRAFT",subject:item.title,body:item.answer,language:"en",
    source:{entryId:entry.id,revisionId:entry.currentRevisionId!,contentHash:sourceHash(entry,entry.currentRevisionId!)},reason:"SUPPORTED"},
    modelCalls:4,toolCalls:4,steps:["Search","Inspect"],code:"OK"};
  return {item,run,preview};
}
it("persists bounded evidence across reads and scopes run IDs to their thread", async () => {
  const {item,run,preview}=await paused();
  await persistUiPreview(run.id,preview,f.db);
  const view=await readUiRun(item.threadId,f.db);
  expect(view).toMatchObject({id:run.id,status:"WAITING_FOR_HUMAN",stale:false,evidence:{version:1,current:true,answer:item.answer},preview:{modelCalls:4}});
  const other=await f.create();
  expect(await readUiRun(other.threadId,f.db,run.id)).toBeNull();
  expect(await f.db.draft.count({where:{threadId:item.threadId}})).toBe(0);
});
it("ignores late and wrong-fence previews after cancellation", async () => {
  const {item,run,preview}=await paused();
  await persistUiPreview(run.id,{...preview,proposal:{...preview.proposal,fence:preview.proposal.fence+1}},f.db);
  expect((await readUiRun(item.threadId,f.db))?.preview).toBeNull();
  const state=await readUiRun(item.threadId,f.db);
  await cancelAgentRun({runId:run.id,expectedRevision:state!.revision},f.db);
  await persistUiPreview(run.id,preview,f.db);
  expect(await readUiRun(item.threadId,f.db)).toMatchObject({status:"CANCELLED",preview:null});
});
it("shows immutable historical evidence and blocks retired knowledge", async () => {
  const {item,run,preview}=await paused();
  await persistUiPreview(run.id,preview,f.db);
  await f.db.knowledgeEntry.update({where:{id:item.entryId},data:{status:"INACTIVE"}});
  expect(await readUiRun(item.threadId,f.db)).toMatchObject({stale:true,evidence:{current:false,answer:item.answer}});
});
it("no-evidence proposals remain resumable until the inbound context changes", async () => {
  const {item,run,preview}=await paused();
  await persistUiPreview(run.id,{...preview,proposal:{...preview.proposal,outcome:"ESCALATE",subject:null,body:null,source:null,reason:"NO_EVIDENCE"}},f.db);
  expect((await readUiRun(item.threadId,f.db))?.stale).toBe(false);
  await f.db.emailMessage.updateMany({where:{threadId:item.threadId},data:{cleanBody:"Changed synthetic inbound content"}});
  expect((await readUiRun(item.threadId,f.db))?.stale).toBe(true);
});
