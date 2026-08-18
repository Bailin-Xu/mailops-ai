"use client";

import { useActionState } from "react";

import { bulkApproveCandidatesAction } from "@/app/knowledge-candidates/actions";

const initialState: Awaited<ReturnType<typeof bulkApproveCandidatesAction>> = {
  status: "idle",
  message: "",
};

type BulkApprovalFormProps = {
  eligibleCount: number;
  q: string;
  source: "ALL" | "EMAIL" | "WEBSITE";
};

export function BulkApprovalForm({ eligibleCount, q, source }: BulkApprovalFormProps) {
  const [state, action, pending] = useActionState(
    bulkApproveCandidatesAction,
    initialState,
  );
  if (eligibleCount === 0 && state.status !== "success") return null;

  return (
    <form action={action} className="candidate-bulk-approval">
      <input name="q" type="hidden" value={q} />
      <input name="source" type="hidden" value={source} />
      <div className="candidate-bulk-count">
        <span>Bulk promotion</span>
        <strong>{eligibleCount}</strong>
        <p>pending candidate{eligibleCount === 1 ? "" : "s"} in this filtered view</p>
      </div>
      <div className="candidate-bulk-confirmation">
        <h2>Activate the proposed versions as they are</h2>
        <p>
          This copies each proposal into active knowledge and records one human
          review event per candidate. You can edit or deactivate entries later.
        </p>
        <label>
          <input disabled={pending || eligibleCount === 0} name="confirmed" required type="checkbox" />
          <span>I confirm that every pending candidate in this view may be activated.</span>
        </label>
      </div>
      <button disabled={pending || eligibleCount === 0} type="submit">
        {pending ? "Activating…" : `Approve & activate ${eligibleCount}`}
      </button>
      <p className={`candidate-bulk-feedback is-${state.status}`} aria-live="polite">
        {state.message}
      </p>
    </form>
  );
}
