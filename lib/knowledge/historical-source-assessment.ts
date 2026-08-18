import type { EmailDirection } from "@/lib/email/schemas";

export const knowledgeSourceStatusValues = [
  "UNASSESSED",
  "READY_FOR_REVIEW",
  "NEEDS_REVIEW",
  "EXCLUDED",
] as const;

export type KnowledgeSourceStatus =
  (typeof knowledgeSourceStatusValues)[number];

export const knowledgeExclusionReasonValues = [
  "DIRECTION_NOT_OUTBOUND",
  "MISSING_ANSWER",
  "ANSWER_TOO_SHORT",
  "MISSING_CONTEXT",
  "CONTEXT_TOO_SHORT",
  "FORWARDED_MESSAGE",
  "LINK_ONLY_ANSWER",
  "NON_SUBSTANTIVE_CONTEXT",
  "SCHEDULING_OR_MEETING",
  "POTENTIALLY_ONE_OFF_OR_PRIVATE",
  "CLARIFICATION_REQUEST",
] as const;

export type KnowledgeExclusionReason =
  (typeof knowledgeExclusionReasonValues)[number];

export type HistoricalSourceAssessment = {
  status: Exclude<KnowledgeSourceStatus, "UNASSESSED">;
  exclusionReasons: KnowledgeExclusionReason[];
};

type HistoricalSourceInput = {
  direction: EmailDirection;
  subject: string;
  cleanBody: string;
  quotedContext: string | null;
};

const MIN_ANSWER_CHARACTERS = 40;
const MIN_CONTEXT_CHARACTERS = 40;

export function assessHistoricalKnowledgeSource(
  input: HistoricalSourceInput,
): HistoricalSourceAssessment {
  const reasons = new Set<KnowledgeExclusionReason>();
  const answer = compact(input.cleanBody);
  const context = compact(input.quotedContext ?? "");

  if (input.direction !== "OUTBOUND") {
    reasons.add("DIRECTION_NOT_OUTBOUND");
  }

  if (!answer) {
    reasons.add("MISSING_ANSWER");
  } else {
    if (answer.length < MIN_ANSWER_CHARACTERS) {
      reasons.add("ANSWER_TOO_SHORT");
    }
    if (isLinkOnly(answer)) {
      reasons.add("LINK_ONLY_ANSWER");
    }
  }

  if (!context) {
    reasons.add("MISSING_CONTEXT");
  } else {
    if (context.length < MIN_CONTEXT_CHARACTERS) {
      reasons.add("CONTEXT_TOO_SHORT");
    }
    if (isNonSubstantiveContext(context)) {
      reasons.add("NON_SUBSTANTIVE_CONTEXT");
    }
  }

  if (/^\s*(?:tr|fw|fwd)\s*:/i.test(input.subject)) {
    reasons.add("FORWARDED_MESSAGE");
  }

  const combinedContent = `${input.subject}\n${answer}\n${context}`;
  if (isSchedulingOrMeeting(combinedContent)) {
    reasons.add("SCHEDULING_OR_MEETING");
  }
  if (isPotentiallyOneOffOrPrivate(combinedContent)) {
    reasons.add("POTENTIALLY_ONE_OFF_OR_PRIVATE");
  }
  if (isClarificationRequest(answer)) {
    reasons.add("CLARIFICATION_REQUEST");
  }

  const hasHardExclusion = [...reasons].some(isHardExclusionReason);

  return {
    status:
      reasons.size === 0
        ? "READY_FOR_REVIEW"
        : hasHardExclusion
          ? "EXCLUDED"
          : "NEEDS_REVIEW",
    exclusionReasons: [...reasons],
  };
}

function compact(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function isLinkOnly(value: string): boolean {
  return value
    .replace(/<?https?:\/\/[^\s<>]+>?/gi, "")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .trim().length === 0;
}

function isNonSubstantiveContext(value: string): boolean {
  return /^(?:envoyé avec gmail mobile|sent with gmail mobile|sent from my|envoyé de mon)\b/i.test(
    value,
  );
}

function isSchedulingOrMeeting(value: string): boolean {
  return /\b(?:meeting|appointment|availability|available|schedule|reschedule|next week|tomorrow|rendez-vous|rencontre|disponible|disponibilités|semaine prochaine|demain|planifier|appelle-moi|appelez-moi|appeler rapidement|when are you free|viens discuter|venez discuter|quand tu as un moment|quand vous avez un moment|come by|stop by|call me|give me a call)\b/i.test(
    value,
  );
}

function isClarificationRequest(value: string): boolean {
  return /(?:de quel(?:le)?[^?]{0,80}parles-tu|quel(?:le)?[^?]{0,80}veux-tu dire|peux-tu préciser|pouvez-vous préciser|can you clarify|could you clarify|what do you mean|which[^?]{0,60}do you mean)/i.test(
    value,
  );
}

function isPotentiallyOneOffOrPrivate(value: string): boolean {
  return /\b(?:deleted? (?:my|your|the) account|supprim(?:é|er) (?:mon|votre|le) compte|charge[ -]?back|rétrofacturation|internship|fin de stage|contrat de prestation|marketing form|formulaire marketing)\b/i.test(
    value,
  );
}

function isHardExclusionReason(reason: KnowledgeExclusionReason): boolean {
  return ![
    "MISSING_CONTEXT",
    "CONTEXT_TOO_SHORT",
    "SCHEDULING_OR_MEETING",
    "POTENTIALLY_ONE_OFF_OR_PRIVATE",
    "CLARIFICATION_REQUEST",
  ].includes(reason);
}
