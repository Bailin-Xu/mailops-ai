import { z } from "zod";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { mockAgentUiEnabled } from "@/lib/agent/ui-config";
import { createUiRun,readUiRun } from "@/lib/agent/ui-service";
import { executeUiRun } from "@/lib/agent/ui-launcher";
import { cancelAgentRun } from "@/lib/agent/admission";
const id=z.string().uuid();
function uiOrigin(request:Request){const host=request.headers.get('host')??'';return /^127\.0\.0\.1:[0-9]+$/.test(host)?`http://${host}`:null;}
function allowed(request:Request){const origin=uiOrigin(request);return mockAgentUiEnabled()&&!!origin&&(!request.headers.get('origin')||request.headers.get('origin')===origin);}
export async function GET(request:Request){
 if(!allowed(request))return NextResponse.json({code:"DISABLED"},{status:404});
 try{const threadId=id.parse(new URL(request.url).searchParams.get("threadId"));return NextResponse.json({run:await readUiRun(threadId,getDb())});}
 catch{return NextResponse.json({code:"UNAVAILABLE"},{status:503});}
}
export async function POST(request:Request){
 if(!allowed(request)||request.headers.get("origin")!==uiOrigin(request))return NextResponse.json({code:"DISABLED_OR_CROSS_ORIGIN"},{status:403});
 try{
  const args=z.strictObject({op:z.enum(["CREATE","EXECUTE","CANCEL","SYNC"]),threadId:id,runId:id,expectedRevision:z.number().int().nonnegative().optional()}).parse(await request.json());
  const db=getDb();if(args.op==="CREATE")return NextResponse.json({run:await createUiRun(args.threadId,args.runId,db)});
  const run=await readUiRun(args.threadId,db,args.runId);if(!run||run.revision!==args.expectedRevision)return NextResponse.json({code:"CHANGED"},{status:409});
  if(args.op==="CANCEL"){
   await cancelAgentRun({runId:run.id,expectedRevision:run.revision},db);
   try{await executeUiRun(run.id,"CANCEL",uiOrigin(request)!,db);}catch{/* Business cancellation already fences every late submission. */}
  }else if(args.op==="SYNC"){
   await executeUiRun(run.id,"STATUS",uiOrigin(request)!,db);
  }else{
   if(run.stale||["STALE","CANCELLED","COMMITTED"].includes(run.status))return NextResponse.json({code:"STALE"},{status:409});
   await executeUiRun(run.id,run.status==="READY"?"START":"RESUME",uiOrigin(request)!,db);
  }
  return NextResponse.json({run:await readUiRun(args.threadId,db,args.runId)});
 }catch{return NextResponse.json({code:"UNAVAILABLE_OR_CONFLICT"},{status:503});}
}
