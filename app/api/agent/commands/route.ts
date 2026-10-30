import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { StaleAgentContext, admitAgentRun, claimAgentRun, controlAgentRun, cancelAgentRun, commitAgentProposal } from "@/lib/agent/admission";
export async function POST(request: Request) {
 const secret=process.env.AGENT_BRIDGE_TOKEN;
 if(process.env.AGENT_RUNTIME_ENABLED!=="true"||!secret||secret.length<32)return NextResponse.json({code:"DISABLED"},{status:404});
 const token=request.headers.get("authorization")??""; const expected=`Bearer ${secret}`;
 if(request.headers.get("origin")||Buffer.byteLength(token)!==Buffer.byteLength(expected)||!timingSafeEqual(Buffer.from(token),Buffer.from(expected)))return NextResponse.json({code:"UNAUTHORIZED"},{status:403});
 try{
  const raw=await request.text();if(Buffer.byteLength(raw)>50000)throw new Error();
  const command=z.strictObject({op:z.enum(["ADMIT","CLAIM","CONTROL","CANCEL","STATUS","COMMIT"]),data:z.unknown()}).parse(JSON.parse(raw));
  const db=getDb();let result;
  switch(command.op){
   case "ADMIT":result=await admitAgentRun(command.data,db);break;
   case "CLAIM":result=await claimAgentRun(command.data,db);break;
   case "CONTROL":result=await controlAgentRun(command.data,db);break;
   case "CANCEL":result=await cancelAgentRun(command.data,db);break;
   case "COMMIT":result=await commitAgentProposal(command.data,db);break;
   case "STATUS":{const args=z.strictObject({runId:z.string().uuid()}).parse(command.data);result=await db.agentAdmission.findUniqueOrThrow({where:{id:args.runId},include:{receipts:{select:{commandId:true,result:true}}}});break;}
  }
  return NextResponse.json(result);
 }catch(error){return NextResponse.json({code:error instanceof StaleAgentContext?"STALE":"CONFLICT"},{status:409});}
}
