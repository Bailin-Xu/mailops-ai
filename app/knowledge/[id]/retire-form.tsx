"use client";
import { useActionState, useState } from "react";
import { retireKnowledgeAction } from "./actions";
export function RetireForm({ entryId, revisionId }: { entryId: string; revisionId: string }) {
  const [state, action, pending] = useActionState(retireKnowledgeAction, { message: "", error: false });
  const [note, setNote] = useState("");
  return <form action={action} className="review-retire"><input type="hidden" name="knowledgeEntryId" value={entryId} /><input type="hidden" name="expectedRevisionId" value={revisionId} />
    <label>Retirement note<textarea name="note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} disabled={pending} /></label>
    <button type="submit" name="status" value="INACTIVE" disabled={pending}>Deactivate knowledge</button><button type="submit" name="status" value="ARCHIVED" disabled={pending}>Archive knowledge</button>
    <p role={state.error ? "alert" : "status"}>{pending ? "Saving lifecycle decision…" : state.message}</p>
  </form>;
}
