"use client";

import { useActionState } from "react";

import { reviewCandidateAction } from "@/app/knowledge-candidates/actions";
type CandidateStatus = "DRAFT" | "PENDING_REVIEW" | "APPROVED" | "REJECTED";

const initialState: Awaited<ReturnType<typeof reviewCandidateAction>> = {
  status: "idle",
  message: "",
};

type CandidateReviewFormProps = {
  candidate: {
    id: string;
    title: string;
    canonicalQuestion: string;
    proposedAnswer: string;
    category: string;
    language: string;
    status: CandidateStatus;
    reviewedTitle: string | null;
    reviewedQuestion: string | null;
    reviewedAnswer: string | null;
    reviewedCategory: string | null;
    reviewedLanguage: string | null;
    reviewNote: string | null;
  };
};

export function CandidateReviewForm({ candidate }: CandidateReviewFormProps) {
  const [state, action, pending] = useActionState(reviewCandidateAction, initialState);
  return (
    <form action={action} className="candidate-editor">
      <input name="candidateId" type="hidden" value={candidate.id} />
      <div className="candidate-editor-heading">
        <div><p>Human-reviewed version</p><h3>Edit before promoting</h3></div>
        <span>{candidateStatusLabel(candidate.status)}</span>
      </div>
      <div className="candidate-editor-grid">
        <label className="candidate-field candidate-field-wide"><span>Knowledge title</span><input defaultValue={candidate.reviewedTitle ?? candidate.title} disabled={pending} maxLength={200} name="title" required /></label>
        <label className="candidate-field"><span>Category</span><input defaultValue={candidate.reviewedCategory ?? candidate.category} disabled={pending} maxLength={100} name="category" required /></label>
        <label className="candidate-field"><span>Answer language</span><select defaultValue={normalizeLanguage(candidate.reviewedLanguage ?? candidate.language)} disabled={pending} name="language"><option value="fr">French</option><option value="en">English</option></select></label>
        <label className="candidate-field candidate-field-wide"><span>Canonical customer question</span><textarea defaultValue={candidate.reviewedQuestion ?? candidate.canonicalQuestion} disabled={pending} maxLength={2000} name="canonicalQuestion" required rows={3} /></label>
        <label className="candidate-field candidate-field-wide"><span>Approved answer</span><textarea defaultValue={candidate.reviewedAnswer ?? candidate.proposedAnswer} disabled={pending} maxLength={10000} name="answer" required rows={7} /></label>
        <label className="candidate-field candidate-field-wide"><span>Review note <em>optional</em></span><textarea defaultValue={candidate.reviewNote ?? ""} disabled={pending} maxLength={1000} name="note" placeholder="What did you verify or change?" rows={2} /></label>
      </div>
      <div className="candidate-editor-actions">
        <button disabled={pending} name="decision" type="submit" value="APPROVED">Approve &amp; activate</button>
        <button disabled={pending} name="decision" type="submit" value="REJECTED">Reject candidate</button>
      </div>
      <p className={`candidate-form-feedback is-${state.status}`} aria-live="polite">{pending ? "Saving review…" : state.message || "Approval creates or updates one ACTIVE knowledge entry."}</p>
    </form>
  );
}

function normalizeLanguage(language: string) {
  return language === "en" ? "en" : "fr";
}

function candidateStatusLabel(status: CandidateStatus) {
  return { DRAFT: "Draft", PENDING_REVIEW: "Pending review", APPROVED: "Active knowledge", REJECTED: "Rejected" }[status];
}
