import { readFileSync,writeFileSync } from "node:fs";
import { z } from "zod";
const id=z.string().uuid().parse(process.argv[2]);const dir=`data/agent-runs/${id}`;
const pack=JSON.parse(readFileSync(`${dir}/review-pack.json`,'utf8'));
const lines=['# MailOps mock 人工评分材料','系统身份已隐藏。请先审核标签和法语材料；mock 结果不构成真实模型质量证据。','请只编辑 review-pack.json 中的 rating；所需字段：reviewerId、support、citations、completeness、language、safety、reason。其他字段保持原样。'];
for(const [i,row] of pack.rows.entries()){
 lines.push(`\n## ${i+1}. ${row.id}`,`用例 ${row.caseId} · 第 ${row.repetition+1} 轮`,`\n> ${row.input.body}`,`\n执行：${row.output.status}；路由：${row.output.route}`,`\n回复：${row.output.body??'无草稿'}`,'\n引用：');
 for(const source of row.sources)lines.push(`- ${source.id} · ${source.status}：${source.answer}`);
 lines.push('\n对照标签校准包的同 caseId 参考知识评估相关性。',`\n人工评分：${row.rating===null?'未填写':JSON.stringify(row.rating)}`);
}
writeFileSync(`${dir}/review-pack.md`,lines.join('\n')+'\n',{mode:0o600});
console.log('Readable packet rendered without modifying ratings.');
