"use client";

import { useActionState } from "react";

import { reviewWebsiteKnowledgeAction } from "@/app/website-knowledge/actions";
import type { WebsiteReviewStatus } from "@/lib/knowledge/website-review";

const initialState: Awaited<ReturnType<typeof reviewWebsiteKnowledgeAction>> = {
  status: "idle",
  message: "",
};

type WebsiteReviewFormProps = {
  answer: string | null;
  itemId: string;
  note: string | null;
  reviewedAt: string | null;
  status: WebsiteReviewStatus;
};

export function WebsiteReviewForm({
  answer,
  itemId,
  note,
  reviewedAt,
  status,
}: WebsiteReviewFormProps) {
  const [state, formAction, pending] = useActionState(
    reviewWebsiteKnowledgeAction,
    initialState,
  );

  return (
    <form action={formAction} className="web-decision-card">
      <input name="reviewItemId" type="hidden" value={itemId} />
      <div className="web-decision-heading">
        <div>
          <p>Owner-confirmed policy</p>
          <h3>{statusLabel(status)}</h3>
        </div>
        <WebsiteStatusBadge status={status} />
      </div>

      <label className="web-answer-field">
        <span>Confirmed answer from Dorian</span>
        <textarea
          defaultValue={answer ?? ""}
          disabled={pending}
          maxLength={5000}
          name="confirmedAnswer"
          placeholder="Paste Dorian's answer here. Keep the exact conditions, exceptions, prices, and dates he confirms."
          rows={7}
        />
      </label>

      <label className="web-note-field">
        <span>Internal review note <em>optional</em></span>
        <textarea
          defaultValue={note ?? ""}
          disabled={pending}
          maxLength={1000}
          name="note"
          placeholder="Record what changed, what still needs checking, or who confirmed it."
          rows={3}
        />
      </label>

      <div className="web-decision-actions">
        <button disabled={pending} name="decision" type="submit" value="CONFIRMED">
          Confirm policy
        </button>
        <button disabled={pending} name="decision" type="submit" value="NEEDS_FOLLOW_UP">
          Needs follow-up
        </button>
        <button disabled={pending} name="decision" type="submit" value="REJECTED">
          Reject item
        </button>
      </div>

      <div className="web-decision-feedback" aria-live="polite">
        {pending ? <span>Saving decision…</span> : null}
        {!pending && state.message ? (
          <span className={`is-${state.status}`}>{state.message}</span>
        ) : null}
        {!pending && !state.message && reviewedAt ? (
          <span>Last reviewed {reviewedAt}</span>
        ) : null}
        {!pending && !state.message && !reviewedAt ? (
          <span>
            Confirmation resolves the source conflict. It does not publish trusted
            knowledge yet.
          </span>
        ) : null}
      </div>
    </form>
  );
}

export function WebsiteStatusBadge({ status }: { status: WebsiteReviewStatus }) {
  return (
    <span className={`web-status-badge state-${status.toLowerCase()}`}>
      {statusLabel(status)}
    </span>
  );
}

function statusLabel(status: WebsiteReviewStatus) {
  const labels: Record<WebsiteReviewStatus, string> = {
    PENDING: "Waiting for Dorian",
    CONFIRMED: "Policy confirmed",
    NEEDS_FOLLOW_UP: "Needs follow-up",
    REJECTED: "Rejected",
  };
  return labels[status];
}
