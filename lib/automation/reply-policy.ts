import type {
  ClassificationCategory,
  ClassificationReviewStatus,
  ProcessingStatus,
} from "@/generated/prisma/client";

const highRiskPattern = /\b(?:refund|remboursement|contract|contrat|payment|paiement|privacy|confidentialit[ée]|delete (?:my )?account|supprimer (?:mon )?compte|legal|juridique|lawsuit|litige|complaint|plainte|harassment|harc[eè]lement)\b/iu;

export const AUTO_REPLY_MIN_CONFIDENCE = 0.9;

export type AutoReplyPolicyInput = {
  category: ClassificationCategory;
  confidence: number;
  reviewStatus: ClassificationReviewStatus;
  processingStatus: ProcessingStatus | null;
  knowledgeMatchCount: number;
  cleanBody: string;
  minimumConfidence?: number;
};

export function evaluateAutoReplyPolicy(input: AutoReplyPolicyInput) {
  const reasons: string[] = [];
  const minimumConfidence = input.minimumConfidence ?? AUTO_REPLY_MIN_CONFIDENCE;

  if (input.category !== "KNOWN_QUESTION") reasons.push("CATEGORY_NOT_KNOWN");
  if (input.confidence < minimumConfidence) reasons.push("CONFIDENCE_BELOW_AUTO_REPLY_THRESHOLD");
  if (input.reviewStatus !== "AUTO_ROUTED") reasons.push("CLASSIFICATION_NOT_AUTO_ROUTED");
  if (input.processingStatus !== "DRAFT_READY") reasons.push("DRAFT_NOT_READY");
  if (input.knowledgeMatchCount !== 1) reasons.push("EXACTLY_ONE_GROUNDING_SOURCE_REQUIRED");
  if (highRiskPattern.test(input.cleanBody)) reasons.push("HIGH_RISK_CONTENT");

  return { eligible: reasons.length === 0, reasons };
}
