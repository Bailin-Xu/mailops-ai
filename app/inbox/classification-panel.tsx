"use client";

import { useActionState, useEffect, useRef, useState } from "react";

import {
  confirmSimulatedSendAction,
  saveDraftAction,
  rejectDraftAction,
  reviewClassificationAction,
  retryProcessingAction,
  runClassificationAction,
  simulateDiscordForwardAction,
  submitManualAnswerAction,
  type InboxActionState,
} from "@/app/inbox/actions";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { classificationCategoryValues } from "@/lib/ai/provider";

const initialState: InboxActionState = { status: "idle", message: "", completedAt: 0 };

type ClassificationView = {
  id: string;
  revision: number;
  aiCategory: string;
  aiConfidence: number;
  aiLanguage: string;
  requiresHumanReview: boolean;
  reviewedCategory: string | null;
  correctionNote: string | null;
  reviewStatus: "PENDING" | "AUTO_ROUTED" | "ACCEPTED" | "CORRECTED";
  reviewedAt: Date | null;
  route: string | null;
  processingStatus: string | null;
  routingReason: string | null;
  knowledgeQuery: string | null;
  knowledgeMatchCount: number;
  simulatedForwardedAt: Date | null;
  aiExecution: {
    provider: string;
    model: string;
    promptVersion: string;
    latencyMs: number;
    status: "SUCCEEDED" | "FAILED";
  };
  drafts: Array<{
    id: string;
    subject: string;
    body: string;
    language: string;
    style: string;
    mode: "MOCK_GROUNDED" | "AI_GROUNDED" | "MANUAL";
    status: "GENERATED" | "SUPERSEDED" | "SIMULATED_SENT" | "REJECTED";
    reviewRevision: number; editedSubject: string | null; editedBody: string | null; editedLanguage: string | null;
    editedAt: Date | null; rejectedAt: Date | null; reviewNote: string | null;
    approvedSubject: string | null;
    approvedBody: string | null;
    approvedLanguage: string | null;
    simulatedSentAt: Date | null;
    evidenceStatus: "LEGACY_UNVERIFIED" | "CAPTURED" | "HUMAN_AUTHORED";
    knowledgeReviewRequiredAt: Date | null;
    knowledgeReviewReason: string | null;
    knowledgeSources: Array<{
      rank: number;
      relevanceScore: number;
      knowledgeRevision: {
        id: string; version: number; title: string; canonicalQuestion: string;
        answer: string; language: string; category: string;
      } | null;
      knowledgeEntry: {
        id: string;
        title: string;
        canonicalQuestion: string;
        answer: string;
        category: string;
        language: string;
      };
    }>;
  }>;
};

export function ClassificationPanel({
  threadId,
  classification,
  providerId,
}: {
  threadId: string;
  classification: ClassificationView | null;
  providerId: "mock" | "gemini";
}) {
  const panelRef = useRef<HTMLElement>(null);
  const [runState, runAction, running] = useActionState(runClassificationAction, initialState);
  const [reviewState, reviewAction, reviewing] = useActionState(reviewClassificationAction, initialState);
  const [retryState, retryAction, retrying] = useActionState(retryProcessingAction, initialState);
  const [sendState, sendAction, sending] = useActionState(confirmSimulatedSendAction, initialState);
  const [forwardState, forwardAction, forwarding] = useActionState(simulateDiscordForwardAction, initialState);
  const [answerState, answerAction, answering] = useActionState(submitManualAnswerAction, initialState);
  const draft = classification?.drafts[0] ?? null;
  const effectiveCategory = classification?.reviewedCategory ?? classification?.aiCategory;
  const feedback = [runState, reviewState, retryState, sendState, forwardState, answerState]
    .reduce((latest, state) => state.completedAt > latest.completedAt ? state : latest, initialState);

  useEffect(() => {
    if (feedback.status === "idle") return;
    panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [feedback.completedAt, feedback.status]);

  return (
    <section className="inbox-classification-panel" ref={panelRef}>
      <header>
        <div>
          <p>Automatic processing track</p>
          <h3>{classification ? "Classify → Route → Ground → Confirm" : "Ready for automatic processing"}</h3>
          <span className="inbox-provider-badge">Current provider: {providerId}</span>
        </div>
        <form action={runAction}>
          <input name="threadId" type="hidden" value={threadId} />
          <button disabled={running} type="submit">
            {running ? "Processing…" : classification ? "Run a new AI attempt" : "Run automatic processing"}
          </button>
        </form>
      </header>

      <p className={`inbox-action-feedback is-${feedback.status}`} aria-live="polite">{feedback.message}</p>

      {!classification ? (
        <div className="inbox-classification-empty">
          <strong>Configured AI provider</strong>
          <p>One action classifies and routes the latest inbound message. Known questions also search Active Knowledge and prepare a grounded reference reply.</p>
        </div>
      ) : (
        <>
          <div className="inbox-processing-track" aria-label="Automatic processing status">
            <ProcessingStep label="Classified" value={`${classification.aiCategory.replaceAll("_", " ")} · ${Math.round(classification.aiConfidence * 100)}%`} active />
            <ProcessingStep label="Routed" value={classification.route?.replaceAll("_", " ") ?? "Waiting"} active={Boolean(classification.route)} />
            <ProcessingStep label="Prepared" value={preparationLabel(classification.processingStatus)} active={Boolean(classification.processingStatus)} />
            <ProcessingStep label="Human gate" value={humanGateLabel(classification.processingStatus)} active={["SIMULATED_SENT", "SIMULATED_FORWARDED", "NO_ACTION"].includes(classification.processingStatus ?? "")} />
          </div>

          <ProcessingOutcome status={classification.processingStatus} />

          <div className="inbox-ai-proposal">
            <div className="inbox-ai-meta">
              <span>AI suggestion</span>
              <span>{classification.aiExecution.provider} / {classification.aiExecution.model}</span>
              <span>{classification.aiExecution.latencyMs} ms</span>
              <span>{classification.reviewStatus === "AUTO_ROUTED" ? "Continued automatically" : classification.reviewStatus.replaceAll("_", " ")}</span>
            </div>
            <div className="inbox-ai-grid">
              <div><small>Effective category</small><strong>{effectiveCategory?.replaceAll("_", " ")}</strong></div>
              <div><small>Confidence</small><strong>{Math.round(classification.aiConfidence * 100)}%</strong></div>
              <div><small>Language</small><strong>{classification.aiLanguage.toUpperCase()}</strong></div>
            </div>
            <p>{classification.routingReason ?? "This older classification has not been routed yet."}</p>
            <small>Prompt {classification.aiExecution.promptVersion} · AI output is stored separately from human corrections.</small>
          </div>

          {classification.reviewStatus === "PENDING" ? (
            <ClassificationCorrectionForm
              classification={classification}
              key={`review-${classification.revision}`}
              action={reviewAction}
              busy={reviewing}
              title={classification.aiConfidence < 0.7
                ? "Low confidence requires a human decision"
                : "This legacy pending result requires a human decision"}
            />
          ) : classification.reviewStatus === "AUTO_ROUTED" ? (
            <details className="inbox-correction-disclosure">
              <summary>Classification looks wrong? Correct it and reroute</summary>
              <ClassificationCorrectionForm key={`review-${classification.revision}`} classification={classification} action={reviewAction} busy={reviewing} title="Record classification feedback" />
            </details>
          ) : (
            <div className="inbox-reviewed-classification">
              <span>Human feedback recorded · {classification.reviewStatus}</span>
              <strong>{classification.reviewedCategory?.replaceAll("_", " ")}</strong>
              {classification.correctionNote ? <small>{classification.correctionNote}</small> : null}
            </div>
          )}

          {classification.processingStatus === "DRAFT_REJECTED" || classification.processingStatus === "FAILED" || classification.processingStatus === "DRAFT_READY" || !classification.processingStatus ? (
            <form action={retryAction} className="inbox-route-action">
              <input name="classificationId" type="hidden" value={classification.id} />
              <div><span>Reference reply preparation</span><p>{classification.processingStatus === "DRAFT_READY" ? "A replacement becomes available only after it succeeds. Failed attempts preserve the previous reply." : "Retry processing for the current classification."}</p></div>
              <button disabled={retrying || classification.reviewStatus === "PENDING"} type="submit">{retrying ? "Retrying…" : classification.processingStatus === "DRAFT_READY" ? "Regenerate reference reply" : "Resume automatic processing"}</button>
            </form>
          ) : null}

          {draft?.mode === "MOCK_GROUNDED" || draft?.mode === "AI_GROUNDED" ? (
            <section className="inbox-grounded-draft">
              <header><div><span>Dorian style / reference only</span><h4>{draft.approvedSubject ?? draft.subject}</h4></div><strong>{draft.editedAt && draft.status === "GENERATED" ? "EDITED — awaiting human confirmation" : draft.status.replaceAll("_", " ")}</strong></header>
              <div className="inbox-grounding-evidence">
                <p><b>Retrieval query</b>{classification.knowledgeQuery}</p>
                <p><b>Grounding sources</b>{classification.knowledgeMatchCount}</p>
                {draft.knowledgeSources.map(({ knowledgeEntry, knowledgeRevision, relevanceScore, rank }) => (
                  <article key={knowledgeEntry.id}>
                    {knowledgeRevision ? <>
                      <span>#{rank} · Version {knowledgeRevision.version} · {knowledgeRevision.language.toUpperCase()} · score {relevanceScore.toFixed(2)}</span>
                      <Link href={`/knowledge/${knowledgeEntry.id}`}><strong>{knowledgeRevision.title}</strong> · Review knowledge history</Link>
                      <p>{knowledgeRevision.canonicalQuestion}</p>
                      <p>{knowledgeRevision.answer}</p>
                    </> : <><strong>Legacy source link</strong><p>The historical source text was not captured. Current knowledge is not evidence of what this reply originally used.</p></>}
                  </article>
                ))}
              </div>
              {draft.status === "GENERATED" && draft.knowledgeReviewRequiredAt ? <p role="status">Knowledge changed or historical evidence is missing. Regenerate this reply using current approved knowledge before confirmation.</p> : null}
              {draft.status === "GENERATED" && classification.processingStatus === "DRAFT_READY" && draft.evidenceStatus === "CAPTURED" && !draft.knowledgeReviewRequiredAt ? (
                <>
                  <details className="inbox-original-draft">
                    <summary>View original AI draft</summary>
                    <pre lang={draft.language}>{draft.body}</pre>
                  </details>
                  <DraftConfirmationForm key={draft.id} draft={draft} action={sendAction} sending={sending} />
                </>
              ) : draft.status === "GENERATED" ? (
                <div className="inbox-original-draft">
                  <strong>Previous reference reply preserved</strong>
                  <pre lang={draft.editedLanguage ?? draft.language}>{draft.editedBody ?? draft.body}</pre>
                  <p>Retry processing before confirming this reply. Its context or grounding needs to be checked again.</p>
                  {classification.processingStatus === "DRAFT_READY" && <DraftRejectionForm draft={draft} />}
                </div>
              ) : draft.status === "REJECTED" ? (
                <div className="inbox-original-draft"><strong>Human rejected this reply</strong><pre lang={draft.language}>{draft.editedBody ?? draft.body}</pre><p>{draft.reviewNote ?? "Regenerate a new reply before confirmation."}</p></div>
              ) : (
                <div className="inbox-approved-draft">
                  <span>Human-approved final reply · {(draft.approvedLanguage ?? draft.language).toUpperCase()}</span>
                  <pre lang={draft.approvedLanguage ?? draft.language}>{draft.approvedBody ?? draft.body}</pre>
                  <p>Simulated sent · No real email delivered.</p>
                </div>
              )}
            </section>
          ) : null}

          {classification.processingStatus === "TECHNICAL_QUEUED" ? (
            <form action={forwardAction} className="inbox-route-action">
              <input name="classificationId" type="hidden" value={classification.id} />
              <div><span>Technical queue</span><p>Prepare a local handoff marker for engineering. No Discord connection is used.</p></div>
              <button disabled={forwarding} type="submit">{forwarding ? "Forwarding…" : "Simulate Forward to Discord"}</button>
            </form>
          ) : null}

          {classification.processingStatus === "SIMULATED_FORWARDED" ? <p className="inbox-complete-note">Simulated forwarded to the technical queue · Discord was not contacted.</p> : null}

          {classification.processingStatus === "AWAITING_HUMAN_ANSWER" || classification.processingStatus === "NO_KNOWLEDGE" ? (
            <form action={answerAction} className="inbox-manual-answer" key={`answer-${classification.revision}`}>
              <input name="classificationId" type="hidden" value={classification.id} />
              <input name="expectedRevision" type="hidden" value={classification.revision} />
              <div><span>Human answer queue</span><strong>{classification.processingStatus === "NO_KNOWLEDGE" ? "No grounded answer was found" : "Write the answer manually"}</strong></div>
              <label><span>Reply body</span><textarea disabled={answering} maxLength={20_000} name="body" placeholder="Write the answer that a human has verified…" required rows={7} /></label>
              <label className="inbox-candidate-option"><input disabled={answering} name="createCandidate" type="checkbox" /><span>Create a knowledge candidate from this verified answer</span></label>
              <button disabled={answering} type="submit">{answering ? "Saving…" : "Save answer & simulate send"}</button>
              <small>No real email is sent. A candidate remains untrusted until separately approved.</small>
            </form>
          ) : null}

          {classification.processingStatus === "NO_ACTION" ? <p className="inbox-complete-note">No reply action was created for this likely irrelevant message.</p> : null}
          {classification.processingStatus === "SIMULATED_SENT" && draft?.mode === "MANUAL" ? <p className="inbox-complete-note">Human answer recorded · Simulated sent · No real email delivered.</p> : null}
        </>
      )}
    </section>
  );
}

function DraftConfirmationForm({ draft, action, sending }: { draft: ClassificationView["drafts"][number]; action: (form: FormData) => void; sending: boolean }) {
  const router = useRouter();
  const [subject, setSubject] = useState(draft.editedSubject ?? draft.subject);
  const [body, setBody] = useState(draft.editedBody ?? draft.body);
  const [language, setLanguage] = useState(draft.editedLanguage ?? draft.language);
  const [note, setNote] = useState("");
  const [reviewRevision, setReviewRevision] = useState(draft.reviewRevision);
  const [saveState, saveAction, saving] = useActionState(async (previous: InboxActionState, form: FormData) => {
    const result = await saveDraftAction(previous, form);
    if (result.status === "success" && result.reviewRevision !== undefined) setReviewRevision(result.reviewRevision);
    return result;
  }, initialState);
  const [rejectState, rejectAction, rejecting] = useActionState(rejectDraftAction, initialState);
  const busy = sending || saving || rejecting;
  const changed = draft.reviewRevision > reviewRevision;
  return <form action={action} className="inbox-draft-review">
    <input name="draftId" type="hidden" value={draft.id} />
    <input name="expectedReviewRevision" type="hidden" value={reviewRevision} />
    <div><span>Human review</span><strong>Edit the final reply before confirmation</strong><p>The AI original remains unchanged for audit. Save edits independently or reject this reply.</p></div>
    <label><span>Subject</span><input value={subject} onChange={(e) => setSubject(e.target.value)} disabled={busy} maxLength={500} name="subject" required /></label>
    <label><span>Reply language</span><select value={language} onChange={(e) => setLanguage(e.target.value)} disabled={busy} name="language"><option value="fr">French</option><option value="en">English</option><option value="mixed">Mixed</option><option value="unknown">Unknown</option></select></label>
    <label><span>Final reply</span><textarea value={body} onChange={(e) => setBody(e.target.value)} disabled={busy} maxLength={20_000} name="body" required rows={9} /></label>
    <label><span>Rejection note (optional)</span><textarea value={note} onChange={(e) => setNote(e.target.value)} disabled={busy} maxLength={1000} name="note" rows={2} /></label>
    <button disabled={busy || changed} formAction={saveAction} type="submit">{saving ? "Saving edits…" : "Save human edits"}</button>
    <button disabled={busy || changed} formAction={rejectAction} formNoValidate type="submit">Reject reference reply</button>
    <button disabled={busy || changed} type="submit">{sending ? "Confirming…" : "Approve final text & simulate send"}</button>
    <button disabled={busy} onClick={() => router.refresh()} type="button">Compare latest saved reply</button>
    {changed && <div className="review-conflict" role="alert"><strong>Another reviewer saved this reply. Your proposed text is kept.</strong><pre>{draft.editedBody ?? draft.body}</pre><button onClick={() => setReviewRevision(draft.reviewRevision)} type="button">Keep my final text against latest review</button></div>}
    <p role={saveState.status === "error" || rejectState.status === "error" ? "alert" : "status"}>{saving || rejecting ? "Saving review…" : saveState.completedAt > rejectState.completedAt ? saveState.message : rejectState.message}</p>
    <small>{draft.editedAt ? "Saved human edit is available after refresh. " : ""}No mailbox is connected. Confirmation stores final text and a simulated-send timestamp.</small>
  </form>;
}

function DraftRejectionForm({ draft }: { draft: ClassificationView["drafts"][number] }) {
  const [state, action, pending] = useActionState(rejectDraftAction, initialState);
  const [note, setNote] = useState("");
  const [revision] = useState(draft.reviewRevision);
  return <form action={action}><input name="draftId" type="hidden" value={draft.id} /><input name="expectedReviewRevision" type="hidden" value={revision} />
    <label>Rejection note<textarea name="note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} disabled={pending} /></label>
    <button type="submit" disabled={pending}>Reject outdated reference reply</button><p role={state.status === "error" ? "alert" : "status"}>{state.message}</p></form>;
}

function ClassificationCorrectionForm({
  classification,
  action,
  busy,
  title,
}: {
  classification: ClassificationView;
  action: (payload: FormData) => void;
  busy: boolean;
  title: string;
}) {
  return (
    <form action={action} className="inbox-human-review">
      <input name="classificationId" type="hidden" value={classification.id} />
      <input name="expectedRevision" type="hidden" value={classification.revision} />
      <div className="inbox-human-review-heading"><span>Human decision</span><strong>{title}</strong></div>
      <label><span>Correct category</span><select defaultValue={classification.aiCategory} disabled={busy} name="category">{classificationCategoryValues.map((category) => <option key={category} value={category}>{category.replaceAll("_", " ")}</option>)}</select></label>
      <label><span>Feedback note <em>optional</em></span><textarea disabled={busy} maxLength={2000} name="note" placeholder="What was wrong or what did you verify?" rows={2} /></label>
      <button disabled={busy} type="submit">{busy ? "Saving…" : "Save feedback & reroute"}</button>
    </form>
  );
}

function ProcessingStep({ label, value, active }: { label: string; value: string; active: boolean }) {
  return <div className={active ? "is-active" : ""}><span>{label}</span><strong>{value}</strong></div>;
}

function ProcessingOutcome({ status }: { status: string | null }) {
  const outcome = processingOutcome(status);
  if (!outcome) return null;

  return (
    <div className={`inbox-processing-outcome is-${outcome.tone}`} role="status">
      <strong>{outcome.title}</strong>
      <span>{outcome.detail}</span>
    </div>
  );
}

function processingOutcome(status: string | null) {
  if (status === "WAITING_FOR_REVIEW") return { tone: "attention", title: "No draft generated", detail: "This classification needs a human decision before routing can continue." };
  if (status === "NO_KNOWLEDGE") return { tone: "attention", title: "No grounded draft generated", detail: "No sufficiently relevant Active Knowledge was found. A human answer is required." };
  if (status === "AWAITING_HUMAN_ANSWER") return { tone: "attention", title: "Human answer required", detail: "This route intentionally does not let AI invent an answer." };
  if (status === "TECHNICAL_QUEUED") return { tone: "info", title: "Technical handoff ready", detail: "No email draft is created for this route. You can simulate forwarding it to Discord below." };
  if (status === "DRAFT_READY") return { tone: "success", title: "Grounded reference draft ready", detail: "Review the retrieved evidence and draft below, then confirm a simulated send." };
  if (status === "SIMULATED_SENT") return { tone: "success", title: "Simulated send complete", detail: "The human gate was confirmed. No real email was delivered." };
  if (status === "SIMULATED_FORWARDED") return { tone: "success", title: "Simulated technical handoff complete", detail: "Discord was not contacted." };
  if (status === "NO_ACTION") return { tone: "info", title: "No reply needed", detail: "Automatic routing determined that no response action should be created." };
  if (status === "DRAFT_REJECTED") return { tone: "attention", title: "Human rejected the reference reply", detail: "The rejected text remains in history. Regenerate before another confirmation." };
  if (status === "FAILED") return { tone: "error", title: "Processing stopped safely", detail: "Use the retry action below after checking the provider configuration." };
  return null;
}

function preparationLabel(status: string | null) {
  if (status === "DRAFT_READY" || status === "SIMULATED_SENT") return "Reply ready";
  if (status === "TECHNICAL_QUEUED" || status === "SIMULATED_FORWARDED") return "Technical handoff";
  if (status === "AWAITING_HUMAN_ANSWER" || status === "NO_KNOWLEDGE") return "Human answer";
  if (status === "WAITING_FOR_REVIEW") return "Classification review";
  if (status === "NO_ACTION") return "No reply";
  return status?.replaceAll("_", " ") ?? "Waiting";
}

function humanGateLabel(status: string | null) {
  if (status === "SIMULATED_SENT") return "Confirmed";
  if (status === "SIMULATED_FORWARDED") return "Forwarded";
  if (status === "NO_ACTION") return "Complete";
  return "Required";
}
