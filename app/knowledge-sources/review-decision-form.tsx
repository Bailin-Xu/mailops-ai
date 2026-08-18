"use client";

import { useActionState } from "react";

import {
  reviewKnowledgeSourceAction,
} from "@/app/knowledge-sources/actions";
import type { KnowledgeReviewStatus } from "@/lib/knowledge/review-source";

const initialReviewActionState: Awaited<
  ReturnType<typeof reviewKnowledgeSourceAction>
> = {
  status: "idle",
  message: "",
};

type ReviewDecisionFormProps = {
  canApprove: boolean;
  messageId: string;
  note: string | null;
  reviewedAt: string | null;
  status: KnowledgeReviewStatus;
};

export function ReviewDecisionForm({
  canApprove,
  messageId,
  note,
  reviewedAt,
  status,
}: ReviewDecisionFormProps) {
  const [state, formAction, pending] = useActionState(
    reviewKnowledgeSourceAction,
    initialReviewActionState,
  );

  return (
    <form action={formAction} className="human-review-card">
      <input name="messageId" type="hidden" value={messageId} />
      <div className="human-review-heading">
        <div>
          <p>Human decision</p>
          <h3>{status === "PENDING" ? "Review this source" : humanStatusLabel(status)}</h3>
        </div>
        <span className={`human-review-state state-${status.toLowerCase()}`}>
          {humanStatusLabel(status)}
        </span>
      </div>

      <label className="human-review-note">
        <span>Review note <em>optional</em></span>
        <textarea
          defaultValue={note ?? ""}
          disabled={pending}
          maxLength={1000}
          name="note"
          placeholder="Why is this reusable, uncertain, or unsuitable?"
          rows={3}
        />
      </label>

      <div className="human-review-actions">
        <button className="decision-approve" disabled={pending || !canApprove} name="decision" type="submit" value="APPROVED">
          Approve source
        </button>
        <button className="decision-follow-up" disabled={pending} name="decision" type="submit" value="NEEDS_FOLLOW_UP">
          Needs follow-up
        </button>
        <button className="decision-reject" disabled={pending} name="decision" type="submit" value="REJECTED">
          Reject source
        </button>
      </div>

      {!canApprove ? (
        <p className="human-review-constraint">
          Only an outbound message with a substantive reply can be approved as a source.
        </p>
      ) : null}

      <div className="human-review-feedback" aria-live="polite">
        {pending ? <span>Saving decision…</span> : null}
        {!pending && state.message ? (
          <span className={`is-${state.status}`}>{state.message}</span>
        ) : null}
        {!pending && !state.message && reviewedAt ? (
          <span>Last reviewed {reviewedAt}</span>
        ) : null}
        {!pending && !state.message && !reviewedAt ? (
          <span>Approval creates permission for the future candidate step—not trusted knowledge.</span>
        ) : null}
      </div>
    </form>
  );
}

function humanStatusLabel(status: KnowledgeReviewStatus) {
  const labels: Record<KnowledgeReviewStatus, string> = {
    PENDING: "Pending review",
    APPROVED: "Approved source",
    NEEDS_FOLLOW_UP: "Needs follow-up",
    REJECTED: "Rejected source",
  };
  return labels[status];
}
