import { randomUUID } from "node:crypto";
import { mkdtempSync,cpSync,readdirSync,writeFileSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join,resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { Client } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";
import { resolveTestDatabaseUrl } from "../../tests/support/database-target.mjs";
import { runThreadClassification } from "../../lib/classification/service";
import { MockAIProvider } from "../../lib/ai/mock-provider";
import { admitAgentRun } from "../../lib/agent/admission";
async function main(){
 const base=resolveTestDatabaseUrl(process.env);const admin=new Client({connectionString:base});await admin.connect();
 const name=`mailops_a3_upgrade_${randomUUID().replaceAll('-','')}`;const url=new URL(base);url.pathname='/'+name;
 const root=mkdtempSync(join(tmpdir(),'mailops-a3-upgrade-'));const old=join(root,'migrations');
 let db:PrismaClient|undefined;
 function migrate(path:string){
  const config=join(root,'prisma.config.ts');writeFileSync(config,`export default ${JSON.stringify({schema:resolve('prisma/schema.prisma'),migrations:{path},datasource:{url:url.toString()}})}`);
  const child=spawnSync(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy','--config',config],{encoding:'utf8'});
  if(child.status!==0)throw new Error('Scratch migration verification failed');
 }
 try{
  await admin.query(`CREATE DATABASE "${name}"`);
  for(const entry of readdirSync('prisma/migrations'))if(entry!=='20261030160000_add_agent_admission')cpSync(join('prisma/migrations',entry),join(old,entry),{recursive:true});
  migrate(old);db=new PrismaClient({adapter:new PrismaPg({connectionString:url.toString()})});
  const thread=await db.emailThread.create({data:{subject:'Synthetic upgrade à Montréal',normalizedSubject:'upgrade',messages:{create:{subject:'Synthetic upgrade à Montréal',normalizedBody:'Synthetic tracked shipping delivery à Montréal.',cleanBody:'Synthetic tracked shipping delivery à Montréal.',direction:'INBOUND',fingerprint:randomUUID(),sourceFileName:'synthetic-upgrade.eml'}}}});
  const classification=await runThreadClassification(thread.id,new MockAIProvider(),db);
  const before=JSON.stringify(await db.emailThread.findUnique({where:{id:thread.id},include:{messages:true,classifications:true}}));
  migrate(resolve('prisma/migrations'));
  const after=JSON.stringify(await db.emailThread.findUnique({where:{id:thread.id},include:{messages:true,classifications:true}}));
  if(before!==after)throw new Error('Legacy data changed during upgrade');
  await admitAgentRun({runId:randomUUID(),classificationId:classification.id},db);
  console.log('A3 previous-schema upgrade passed; legacy French/message/classification state unchanged; admission usable');
 }finally{await db?.$disconnect();await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);await admin.end();rmSync(root,{recursive:true,force:true});}
}
void main().catch(()=>{console.error('A3 scratch upgrade check failed');process.exitCode=1;});
