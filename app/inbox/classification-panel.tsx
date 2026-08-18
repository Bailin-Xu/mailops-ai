"use client";

import { useActionState } from "react";

import {
  confirmSimulatedSendAction,
  reviewClassificationAction,
  retryProcessingAction,
  runClassificationAction,
  simulateDiscordForwardAction,
  submitManualAnswerAction,
  type InboxActionState,
} from "@/app/inbox/actions";
import { classificationCategoryValues } from "@/lib/ai/provider";

const initialState: InboxActionState = { status: "idle", message: "" };

type ClassificationView = {
  id: string;
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
    mode: "MOCK_GROUNDED" | "MANUAL";
    status: "GENERATED" | "SUPERSEDED" | "SIMULATED_SENT";
    simulatedSentAt: Date | null;
    knowledgeSources: Array<{
      rank: number;
      relevanceScore: number;
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
}: {
  threadId: string;
  classification: ClassificationView | null;
}) {
  const [runState, runAction, running] = useActionState(runClassificationAction, initialState);
  const [reviewState, reviewAction, reviewing] = useActionState(reviewClassificationAction, initialState);
  const [retryState, retryAction, retrying] = useActionState(retryProcessingAction, initialState);
  const [sendState, sendAction, sending] = useActionState(confirmSimulatedSendAction, initialState);
  const [forwardState, forwardAction, forwarding] = useActionState(simulateDiscordForwardAction, initialState);
  const [answerState, answerAction, answering] = useActionState(submitManualAnswerAction, initialState);
  const draft = classification?.drafts[0] ?? null;
  const effectiveCategory = classification?.reviewedCategory ?? classification?.aiCategory;
  const feedback = [runState, reviewState, retryState, sendState, forwardState, answerState]
    .find((state) => state.status !== "idle") ?? initialState;

  return (
    <section className="inbox-classification-panel">
      <header>
        <div>
          <p>Automatic processing track</p>
          <h3>{classification ? "Classify → Route → Ground → Confirm" : "Ready for automatic processing"}</h3>
        </div>
        <form action={runAction}>
          <input name="threadId" type="hidden" value={threadId} />
          <button disabled={running} type="submit">
            {running ? "Processing…" : classification ? "Run a new mock attempt" : "Run automatic processing"}
          </button>
        </form>
      </header>

      <p className={`inbox-action-feedback is-${feedback.status}`} aria-live="polite">{feedback.message}</p>

      {!classification ? (
        <div className="inbox-classification-empty">
          <strong>Local Mock provider</strong>
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
              action={reviewAction}
              busy={reviewing}
              title={classification.aiConfidence < 0.7
                ? "Low confidence requires a human decision"
                : "This legacy pending result requires a human decision"}
            />
          ) : classification.reviewStatus === "AUTO_ROUTED" ? (
            <details className="inbox-correction-disclosure">
              <summary>Classification looks wrong? Correct it and reroute</summary>
              <ClassificationCorrectionForm classification={classification} action={reviewAction} busy={reviewing} title="Record classification feedback" />
            </details>
          ) : (
            <div className="inbox-reviewed-classification">
              <span>Human feedback recorded · {classification.reviewStatus}</span>
              <strong>{classification.reviewedCategory?.replaceAll("_", " ")}</strong>
              {classification.correctionNote ? <small>{classification.correctionNote}</small> : null}
            </div>
          )}

          {classification.processingStatus === "FAILED" || !classification.processingStatus ? (
            <form action={retryAction} className="inbox-route-action">
              <input name="classificationId" type="hidden" value={classification.id} />
              <div><span>Recoverable processing state</span><p>{classification.processingStatus === "FAILED" ? "Draft generation failed safely." : "Complete routing for this earlier classification record."}</p></div>
              <button disabled={retrying || classification.reviewStatus === "PENDING"} type="submit">{retrying ? "Retrying…" : "Resume automatic processing"}</button>
            </form>
          ) : null}

          {draft?.mode === "MOCK_GROUNDED" ? (
            <section className="inbox-grounded-draft">
              <header><div><span>Dorian style / reference only</span><h4>{draft.subject}</h4></div><strong>{draft.status.replaceAll("_", " ")}</strong></header>
              <div className="inbox-grounding-evidence">
                <p><b>Retrieval query</b>{classification.knowledgeQuery}</p>
                <p><b>Grounding sources</b>{classification.knowledgeMatchCount}</p>
                {draft.knowledgeSources.map(({ knowledgeEntry, relevanceScore, rank }) => (
                  <article key={knowledgeEntry.id}>
                    <span>#{rank} · {knowledgeEntry.language.toUpperCase()} · {knowledgeEntry.category.replaceAll("_", " ")} · score {relevanceScore.toFixed(2)}</span>
                    <strong>{knowledgeEntry.title}</strong>
                    <p>{knowledgeEntry.canonicalQuestion}</p>
                  </article>
                ))}
              </div>
              <pre lang={draft.language}>{draft.body}</pre>
              {draft.status === "GENERATED" ? (
                <form action={sendAction} className="inbox-confirm-send">
                  <input name="draftId" type="hidden" value={draft.id} />
                  <div><strong>Human confirmation required</strong><span>This only records a simulated send. No mailbox is connected.</span></div>
                  <button disabled={sending} type="submit">{sending ? "Confirming…" : "Confirm & simulate send"}</button>
                </form>
              ) : <p className="inbox-complete-note">Human confirmed · Simulated sent · No real email delivered.</p>}
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
            <form action={answerAction} className="inbox-manual-answer">
              <input name="classificationId" type="hidden" value={classification.id} />
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
