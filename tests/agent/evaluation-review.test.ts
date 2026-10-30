import { expect,it } from "vitest";
import { blindPack,score,hash,type EvaluationResult } from "../../lib/evaluation/agent/review";
const result:EvaluationResult={caseId:'holdout-delivery-30-en',system:'agent',repetition:0,status:'COMPLETED',route:'KNOWN_KNOWLEDGE',body:'Synthetic answer',sourceIds:[],firstRetrievedIds:[],allRetrievedIds:[],latencyMs:1,inputTokens:null,outputTokens:null,traceId:'trace',error:null};
it('does not fabricate human scores or missing token usage',()=>{
 const card=score([result],[]).find(c=>c.system==='agent')!;
 expect(card.qualityPassed).toBeNull();expect(card.supportedDrafts).toBeNull();expect(card.inputTokens).toBeNull();expect(card.humanComplete).toBe(false);
});
it('blinds system identity while keeping source evidence available',()=>{
 const pack=blindPack([result]);expect(JSON.stringify(pack)).not.toContain('"system"');expect(pack.rows[0].rating).toBeNull();expect(pack.rows[0].resultHash).toBe(hash(result));
});
it('rejects duplicate and foreign reviews',()=>{
 const r={id:'12345678-1234-4234-8234-123456781234',resultHash:hash(result),reviewerId:'human',support:true,citations:true,completeness:true,language:true,safety:true,reason:'Reviewed'};
 expect(()=>score([result],[r,r])).toThrow();expect(()=>score([result],[{...r,resultHash:'a'.repeat(64)}])).toThrow();
});
it('keeps first-search recall distinct from evidence union recall',async()=>{
 const data=await import('../../contracts/agent/dataset.json');
 const c=data.default.cases.find(c=>c.split==='holdout'&&c.relevantSourceIds.length)!;
 const sample={...result,caseId:c.id,firstRetrievedIds:[],allRetrievedIds:c.relevantSourceIds};
 const card=score([sample],[]).find(c=>c.system==='agent')!;
 expect(card.firstSearchRecallAt8).toBe(0);expect(card.evidenceUnionRecall).toBe(1);
});
it('full-corpus retrieval does not widen the authorized thread identity',async()=>{
 const {snapshotRepository}=await import('../../services/mcp/snapshot-repository');
 const data=await import('../../contracts/agent/dataset.json');
 const item=data.default.cases.find(c=>c.id==='holdout-delivery-30-en')!;
 const expected=data.default.knowledge.find(k=>k.family===item.family&&k.language===item.language)!.id;
 for(const scope of ['family','corpus'] as const){
  const repo=await snapshotRepository('postgresql://mailops_agent_a0@127.0.0.1:5435/mailops_agent_a0',item.id,scope);
  try{expect(repo.threadId).toBe(expected);}finally{await repo.close();}
 }
});
