import { createHash } from "node:crypto";
import { z } from "zod";
import data from "../../../contracts/agent/dataset.json";
export const hash=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const ratingSchema=z.strictObject({id:z.string().uuid(),resultHash:z.string().length(64),reviewerId:z.string().trim().min(1).max(100),
 support:z.boolean(),citations:z.boolean(),completeness:z.boolean(),language:z.boolean(),safety:z.boolean(),reason:z.string().trim().min(1).max(2000)});
export type Rating=z.infer<typeof ratingSchema>;
export type EvaluationResult={caseId:string;system:"baseline"|"agent";repetition:number;status:"COMPLETED"|"EXECUTION_FAILED";
 route:string|null;body:string|null;sourceIds:string[];firstRetrievedIds:string[];allRetrievedIds:string[];
 latencyMs:number;inputTokens:number|null;outputTokens:number|null;traceId:string;error:string|null};
export function blindPack(results:EvaluationResult[]){
 const rows=results.map(result=>({id:crypto.randomUUID(),resultHash:hash(result),caseId:result.caseId,repetition:result.repetition,
 input:data.cases.find(c=>c.id===result.caseId),output:{status:result.status,route:result.route,body:result.body,sourceIds:result.sourceIds},
 sources:data.knowledge.filter(k=>result.sourceIds.includes(k.id)),rating:null}));
 // Stable hash order prevents presentation order disclosing alternating system labels.
 rows.sort((a,b)=>a.resultHash.localeCompare(b.resultHash));
 return {version:1,rows};
}
export function score(results:EvaluationResult[],ratings:Rating[]){
 if(new Set(ratings.map(r=>r.resultHash)).size!==ratings.length)throw new Error("Duplicate ratings");
 for(const rating of ratings){ratingSchema.parse(rating);if(!results.some(r=>hash(r)===rating.resultHash))throw new Error("Rating belongs to another result");}
 const rate=(values:boolean[])=>values.length?values.filter(Boolean).length/values.length:null;
 const recall=(ids:string[],expected:string[])=>expected.filter(id=>ids.includes(id)).length/expected.length;
 return ["baseline","agent"].map(system=>{
  const subset=results.filter(r=>r.system===system);const drafts=subset.filter(r=>r.body!==null);
  const human=subset.map(r=>ratings.find(s=>s.resultHash===hash(r))).filter((r):r is Rating=>!!r);
  const relevant=subset.flatMap(r=>{const c=data.cases.find(c=>c.id===r.caseId)!;return c.relevantSourceIds.length?[{r,c}]:[];});
  const sum=(key:"inputTokens"|"outputTokens")=>subset.every(r=>r[key]!==null)?subset.reduce((a,r)=>a+r[key]!,0):null;
  return {system,cases:subset.length,executionFailures:subset.filter(r=>r.status!=="COMPLETED").length,
   routing:rate(subset.map(r=>r.status==="COMPLETED"&&r.route===data.cases.find(c=>c.id===r.caseId)?.expectedRoute)),
   firstSearchRecallAt8:relevant.length?relevant.reduce((s,{r,c})=>s+recall(r.firstRetrievedIds.slice(0,8),c.relevantSourceIds),0)/relevant.length:null,
   evidenceUnionRecall:relevant.length?relevant.reduce((s,{r,c})=>s+recall(r.allRetrievedIds,c.relevantSourceIds),0)/relevant.length:null,
   humanReviewed:human.length,humanComplete:human.length===subset.length&&subset.length>0,
   supportedDrafts:drafts.length&&drafts.every(r=>ratings.some(s=>s.resultHash===hash(r)))?rate(drafts.map(r=>ratings.find(s=>s.resultHash===hash(r))!.support)):null,
   inputTokens:sum("inputTokens"),outputTokens:sum("outputTokens"),qualityPassed:null};
 });
}
