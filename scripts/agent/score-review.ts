import { createHash } from "node:crypto";
import { readFileSync,writeFileSync } from "node:fs";
import { z } from "zod";
import { score,ratingSchema,hash,type EvaluationResult } from "../../lib/evaluation/agent/review";
const runId=z.string().uuid().parse(process.argv[2]);const dir=`data/agent-runs/${runId}`;
const results=JSON.parse(readFileSync(`${dir}/results.json`,'utf8')) as EvaluationResult[];
const original=JSON.parse(readFileSync(`${dir}/review-original.json`,'utf8'));
const edited=JSON.parse(readFileSync(`${dir}/review-pack.json`,'utf8'));
if(new Set(edited.rows.map((r:{id:string})=>r.id)).size!==edited.rows.length||edited.rows.length!==original.rows.length)throw new Error('Review rows changed');
const manifest=JSON.parse(readFileSync(`${dir}/manifest.json`,'utf8'));
if(hash(results)!==manifest.resultsHash||hash(original)!==manifest.reviewHash)throw new Error('Immutable evaluation artifacts changed');
if(createHash('sha256').update(readFileSync('contracts/agent/dataset.json')).digest('hex')!==manifest.datasetHash)throw new Error('Scoring corpus changed; use the original frozen version');
const ratings=[];
for(const row of edited.rows){
 const frozen=original.rows.find((r:{id:string})=>r.id===row.id);
 if(!frozen||JSON.stringify({...row,rating:null})!==JSON.stringify(frozen))throw new Error('Only rating fields may be edited');
 if(row.rating!==null)ratings.push(ratingSchema.parse({...row.rating,id:row.id,resultHash:row.resultHash}));
}
const report=score(results,ratings);
writeFileSync(`${dir}/human-scorecard.json`,JSON.stringify(report,null,2),{mode:0o600});
console.log(`Imported ${ratings.length}/${results.length} human ratings; mock rehearsal is not live model-quality evidence.`);
