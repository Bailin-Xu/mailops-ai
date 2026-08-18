import type {
  KnowledgeExclusionReason,
  KnowledgeSourceStatus,
} from "@/lib/knowledge/historical-source-assessment";
import type { KnowledgeReviewStatus } from "@/lib/knowledge/review-source";

export const statusLabels: Record<KnowledgeSourceStatus, string> = {
  UNASSESSED: "Unassessed",
  READY_FOR_REVIEW: "Ready for review",
  NEEDS_REVIEW: "Needs review",
  EXCLUDED: "Excluded",
};

export const reasonLabels: Record<KnowledgeExclusionReason, string> = {
  DIRECTION_NOT_OUTBOUND: "Not outbound",
  MISSING_ANSWER: "No answer",
  ANSWER_TOO_SHORT: "Answer too short",
  MISSING_CONTEXT: "No quoted context",
  CONTEXT_TOO_SHORT: "Context too short",
  FORWARDED_MESSAGE: "Forwarded message",
  LINK_ONLY_ANSWER: "Link-only answer",
  NON_SUBSTANTIVE_CONTEXT: "Non-substantive context",
  SCHEDULING_OR_MEETING: "Scheduling or meeting",
  POTENTIALLY_ONE_OFF_OR_PRIVATE: "Potentially private or one-off",
  CLARIFICATION_REQUEST: "Clarification request",
};

export const directionLabels = {
  INBOUND: "Inbound",
  OUTBOUND: "Outbound",
  SELF: "Self",
  UNKNOWN: "Unknown",
} as const;

export const humanReviewLabels: Record<KnowledgeReviewStatus, string> = {
  PENDING: "Pending review",
  APPROVED: "Approved source",
  NEEDS_FOLLOW_UP: "Needs follow-up",
  REJECTED: "Rejected source",
};
