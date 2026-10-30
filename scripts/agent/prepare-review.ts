import { readFileSync,writeFileSync,mkdirSync,existsSync } from "node:fs";
import { createHash } from "node:crypto";
const raw=readFileSync("contracts/agent/dataset.json","utf8");
const digest=createHash("sha256").update(raw).digest("hex");
if(digest!==readFileSync("contracts/agent/dataset.sha256","utf8").trim())throw new Error("Corpus integrity mismatch");
const data=JSON.parse(raw);
mkdirSync("data/agent-runs/a4-preflight",{recursive:true});
if(!existsSync("data/agent-runs/a4-preflight/label-review.json"))writeFileSync("data/agent-runs/a4-preflight/label-review.json",JSON.stringify({version:1,datasetHash:digest,
 rubricVersion:"agent-human-v1",reviewerId:null,completedAt:null,
 cases:data.cases.map((c:Record<string,unknown>)=>({...c,labelCorrect:null,frenchAcceptable:null,notes:null})),
 knowledge:data.knowledge},null,2),{mode:0o600});
console.log("Calibration packet available; existing human edits are preserved.");

const packet=JSON.parse(readFileSync("data/agent-runs/a4-preflight/label-review.json","utf8"));
const lines=["# A4 人工标签与法语校准", "请审核全部100项；在相邻JSON填写 reviewerId/completedAt 与各项 labelCorrect/frenchAcceptable/notes。评分与确认不自动填写。"];
for(const c of packet.cases){
 lines.push(`\n## ${c.id}`,`语言：${c.language}；预期路由：${c.expectedRoute}`,`\n> ${c.body}`,"\n参考知识：");
 for(const k of packet.knowledge.filter((k:{family:string})=>k.family===c.family))lines.push(`- ${k.status} · ${k.id}：${k.answer}`);
 lines.push("\n- [ ] 标签正确", "- [ ] 法语可接受（英文项可注明不适用）",`意见：${c.notes??'未填写'}`);
}
writeFileSync("data/agent-runs/a4-preflight/label-review.md",lines.join("\n")+"\n",{mode:0o600});
