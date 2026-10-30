"use client";

import { useActionState, useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { reviewCandidateAction } from "./actions";

type Candidate = {
  id: string; revision: number; title: string; canonicalQuestion: string; proposedAnswer: string;
  category: string; language: string; status: string;
  reviewedTitle: string | null; reviewedQuestion: string | null; reviewedAnswer: string | null;
  reviewedCategory: string | null; reviewedLanguage: string | null; reviewNote: string | null;
};
function reviewedValues(candidate: Candidate) {
  return { title: candidate.reviewedTitle ?? candidate.title, canonicalQuestion: candidate.reviewedQuestion ?? candidate.canonicalQuestion,
    answer: candidate.reviewedAnswer ?? candidate.proposedAnswer, category: candidate.reviewedCategory ?? candidate.category,
    language: (candidate.reviewedLanguage ?? candidate.language) === "en" ? "en" : "fr", note: candidate.reviewNote ?? "" };
}
// Server-rendered controlled fields must stay read-only until React owns their values.
const subscribe = () => () => {};
const clientReady = () => true;
const serverReady = () => false;
const initialState: Awaited<ReturnType<typeof reviewCandidateAction>> = { status: "idle", message: "" };
export function CandidateReviewForm({ candidate }: { candidate: Candidate }) {
  const ready = useSyncExternalStore(subscribe, clientReady, serverReady);
  const router = useRouter();
  const [refreshing, refresh] = useTransition();
  const [values, setValues] = useState(() => reviewedValues(candidate));
  const [revision, setRevision] = useState(candidate.revision);
  const [state, action, pending] = useActionState(async (previous: typeof initialState, form: FormData) => {
    const result = await reviewCandidateAction(previous, form);
    if (result.status === "success" && result.revision !== undefined) setRevision(result.revision);
    return result;
  }, initialState);
  const latest = reviewedValues(candidate);
  const changedElsewhere = candidate.revision !== revision;
  const labels = { title: "Title", canonicalQuestion: "Canonical question", answer: "Approved answer", category: "Category", language: "Language", note: "Review note" };
  const update = (key: keyof typeof values, value: string) => setValues((current) => ({ ...current, [key]: value }));
  return <form action={action} className="candidate-editor" aria-label="Knowledge review" aria-busy={!ready || pending}>
    <input name="candidateId" type="hidden" value={candidate.id} />
    <input name="expectedRevision" type="hidden" value={revision} />
    <div className="candidate-editor-heading"><div><p>Human-reviewed version</p><h3>Review and publish knowledge</h3></div><span>{candidate.status}</span></div>
    {(state.conflict || changedElsewhere) && <section className="review-conflict" role="alert">
      <h4>This version changed. Your proposed text is kept.</h4>
      <p>Load the latest record, compare it with your proposal below, then explicitly choose the revision to review.</p>
      <button disabled={!ready || refreshing || pending} onClick={() => refresh(() => router.refresh())} type="button">{refreshing ? "Loading latest…" : "Compare with latest saved version"}</button>
      {changedElsewhere && <>
        <button disabled={!ready || pending} onClick={() => setRevision(candidate.revision)} type="button">Keep my proposal against latest revision</button>
        <button disabled={!ready || pending} onClick={() => { setValues(latest); setRevision(candidate.revision); }} type="button">Replace my proposal with latest saved text</button>
      </>}
    </section>}
    <div className="candidate-editor-grid">
      <label className="candidate-field candidate-field-wide"><span>Knowledge title</span><input name="title" value={values.title} onChange={(e) => update("title", e.target.value)} disabled={!ready || pending} maxLength={200} required /></label>
      <label className="candidate-field"><span>Category</span><input name="category" value={values.category} onChange={(e) => update("category", e.target.value)} disabled={!ready || pending} maxLength={100} required /></label>
      <label className="candidate-field"><span>Answer language</span><select name="language" value={values.language} onChange={(e) => update("language", e.target.value)} disabled={!ready || pending}><option value="fr">French</option><option value="en">English</option></select></label>
      <label className="candidate-field candidate-field-wide"><span>Canonical customer question</span><textarea name="canonicalQuestion" value={values.canonicalQuestion} onChange={(e) => update("canonicalQuestion", e.target.value)} disabled={!ready || pending} maxLength={2000} required rows={3} /></label>
      <label className="candidate-field candidate-field-wide"><span>Approved answer</span><textarea name="answer" value={values.answer} onChange={(e) => update("answer", e.target.value)} disabled={!ready || pending} maxLength={10000} required rows={7} /></label>
      <label className="candidate-field candidate-field-wide"><span>Review note (optional)</span><textarea name="note" value={values.note} onChange={(e) => update("note", e.target.value)} disabled={!ready || pending} maxLength={1000} rows={2} /></label>
    </div>
    <details className="review-comparison" open={changedElsewhere || undefined}>
      <summary>Compare saved text with my proposal</summary>
      <div className="review-diff-grid"><div><h4>Latest saved text · revision {candidate.revision}</h4>{Object.entries(latest).map(([key, value]) => <p key={key}><b>{labels[key as keyof typeof labels]}</b><span>{value || "—"}</span></p>)}</div>
        <div><h4>My proposed text · based on revision {revision}</h4>{Object.entries(values).map(([key, value]) => <p className={value !== latest[key as keyof typeof latest] ? "is-changed" : ""} key={key}><b>{labels[key as keyof typeof labels]}{value !== latest[key as keyof typeof latest] ? " — changed" : ""}</b><span>{value || "—"}</span></p>)}</div></div>
    </details>
    <div className="candidate-editor-actions"><button disabled={!ready || pending || changedElsewhere} name="decision" type="submit" value="APPROVED">{pending ? "Saving review…" : "Approve & activate"}</button><button disabled={!ready || pending || changedElsewhere} name="decision" type="submit" value="REJECTED">Reject candidate</button></div>
    <p className={`candidate-form-feedback is-${state.status}`} role={state.status === "error" ? "alert" : "status"}>{!ready ? "Loading review controls…" : state.message || "Approval publishes an immutable knowledge version. Rejection removes it from active retrieval."}</p>
  </form>;
}
