"use client";
import Link from "next/link";
import { useEffect,useRef,useState } from "react";
import { useRouter } from "next/navigation";
import type { AgentUiView } from "@/lib/agent/ui-contract";
const labels:Record<string,string>={READY:"Ready to run",RUNNING:"Working",WAITING_FOR_HUMAN:"Paused for review",COMMITTED:"Review handoff saved",CANCELLED:"Cancelled",STALE:"Evidence changed",FAILED:"Run failed"};
export function AgentPanel({threadId}:{threadId:string}){
 const [run,setRun]=useState<AgentUiView|null>(null);const [loading,setLoading]=useState(true);const [busy,setBusy]=useState(false);const [cancelling,setCancelling]=useState(false);const [error,setError]=useState("");
 const latest=useRef<AgentUiView|null>(null);const router=useRouter();
 function update(next:AgentUiView|null){const before=latest.current;if(next?.id===before?.id&&next&&before&&next.revision<before.revision)return;latest.current=next;setRun(next);if(next?.status==="COMMITTED"&&before?.status!=="COMMITTED")router.refresh();}
 useEffect(()=>{
  let active=true;let pending=false;
  async function poll(){if(pending)return;pending=true;const observed=latest.current?.id;try{const res=await fetch(`/api/agent/ui?threadId=${threadId}`,{cache:"no-store"});if(!res.ok)throw new Error();const data=await res.json();if(active){if(latest.current?.id===observed)update(data.run);setLoading(false);}}catch{if(active){setLoading(false);setError("Agent status is unavailable. Your saved work is preserved.");}}finally{pending=false;}}
  void poll();const timer=setInterval(()=>{void poll();},1500);return()=>{active=false;clearInterval(timer);};
 // The selected thread defines the subscription. Polling never executes a run.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[threadId]);
 async function post(op:string,id:string,revision?:number){
  const response=await fetch("/api/agent/ui",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({op,threadId,runId:id,...(revision===undefined?{}:{expectedRevision:revision})})});
  if(!response.ok)throw new Error(response.status===409?"This run changed. Refresh its status and start a refreshed run if needed.":"Agent service is unavailable or the run changed. Your saved work is preserved.");
  const data=await response.json();update(data.run);return data.run as AgentUiView;
 }
 async function execute(current:AgentUiView){setBusy(true);setError("");try{await post(current.status==="WAITING_FOR_HUMAN"&&!current.preview?"SYNC":"EXECUTE",current.id,current.revision);}catch(e){if(latest.current?.status!=="CANCELLED")setError((e as Error).message);}finally{setBusy(false);}}
 async function start(){setBusy(true);setError("");try{
  const previous=latest.current;if(previous&&!["CANCELLED","COMMITTED"].includes(previous.status))await post("CANCEL",previous.id,previous.revision);
  const created=await post("CREATE",crypto.randomUUID());await execute(created);
 }catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 async function cancel(){const current=latest.current;if(!current)return;setCancelling(true);setError("");try{await post("CANCEL",current.id,current.revision);}catch(e){setError((e as Error).message);}finally{setCancelling(false);}}
 const stale=run?.stale||run?.status==="STALE";
 const continuable=run?.status==="WAITING_FOR_HUMAN"&&!!run.preview?.proposal&&!stale;
 const recoverable=(run?.status==="WAITING_FOR_HUMAN"&&!run.preview)||run?.status==="READY"||run?.status==="FAILED"||(run?.status==="RUNNING"&&!run.leaseActive);
 return <section className="agent-review-panel" role="region" aria-label="Mock Agent review">
  <h2>Mock Agent review</h2><p>Experimental mock workflow. No paid models or real email sending. All reply suggestions need human review.</p>
  {loading?<p role="status">Loading Agent status…</p>:<>
   <p role="status">{run?labels[run.status]??"Status unavailable":"No Agent run yet"}</p>
   {stale&&<p role="alert">Knowledge or conversation changed. This suggestion cannot continue. Start a refreshed run to use current evidence.</p>}
   {run?.status==="FAILED"&&<p>The run stopped. Inspect saved evidence, recover if possible, or start a refreshed run.</p>}
   {run?.preview?.steps.length?<p>Activities before review: {run.preview.steps.map(s=>s==="Search"?"searched approved knowledge":"inspected a knowledge version").join("; ")}.</p>:null}
   {run?.preview?.proposal&&<div className="agent-suggestion"><h3>AI suggestion · not approved</h3>{run.preview.proposal.outcome==="DRAFT"?<><strong>{run.preview.proposal.subject}</strong><p lang={run.preview.proposal.language}>{run.preview.proposal.body}</p></>:<p>Human answer needed: {run.preview.proposal.reason.toLowerCase().replaceAll("_"," ")}</p>}</div>}
   {run?.evidence&&<div className="agent-evidence" role="region" aria-label="Agent evidence"><h3>Evidence</h3><Link href={`/knowledge/${run.evidence.entryId}`}>{run.evidence.title} · Version {run.evidence.version}</Link><p>{run.evidence.current?"Current approved knowledge":"Historical evidence · changed or retired"}</p><p lang={run.evidence.language}>{run.evidence.answer}</p></div>}
   <div className="agent-controls">
    {!run&&<button disabled={busy} onClick={()=>void start()}>Start mock Agent</button>}
    {continuable&&<button disabled={busy||cancelling} onClick={()=>void execute(run)}>Continue & create review handoff</button>}
    {recoverable&&run&&!stale&&<button disabled={busy||cancelling} onClick={()=>void execute(run)}>{run.status==="WAITING_FOR_HUMAN"?"Recover saved preview":run.status==="READY"?"Run mock Agent":"Recover run"}</button>}
    {run&&(stale||["CANCELLED","FAILED"].includes(run.status))&&<button disabled={busy||cancelling} onClick={()=>void start()}>Start refreshed run</button>}
    {run&&!["COMMITTED","CANCELLED"].includes(run.status)&&<button disabled={cancelling} onClick={()=>void cancel()}>{cancelling?"Cancelling…":"Cancel run"}</button>}
   </div>
   {busy&&<p>Working with mock tools…</p>}
   {run?.status==="COMMITTED"&&<p>{run.draftId?"Handoff saved. Use the normal review controls below to edit or reject the draft and confirm simulated sending.":"Human handling saved. Continue in the normal classification review or human-answer queue below."}</p>}
  </>}
  {error&&<p role="alert">{error}</p>}
 </section>;
}
