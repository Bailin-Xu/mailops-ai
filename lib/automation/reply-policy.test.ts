import { describe, expect, it } from "vitest";

import { evaluateAutoReplyPolicy } from "@/lib/automation/reply-policy";

const safeKnown = {
  category: "KNOWN_QUESTION" as const,
  confidence: 0.95,
  reviewStatus: "AUTO_ROUTED" as const,
  processingStatus: "DRAFT_READY" as const,
  knowledgeMatchCount: 1,
  cleanBody: "How should framed artwork be prepared for delivery?",
};

describe("automatic reply policy", () => {
  it("permits only a high-confidence, single-source, low-risk known answer", () => {
    expect(evaluateAutoReplyPolicy(safeKnown)).toEqual({ eligible: true, reasons: [] });
  });

  it("always blocks sensitive subjects from automatic reply", () => {
    expect(evaluateAutoReplyPolicy({
      ...safeKnown,
      cleanBody: "Can you refund my payment and delete my account?",
    })).toMatchObject({ eligible: false, reasons: ["HIGH_RISK_CONTENT"] });
  });

  it("blocks weak grounding and non-known categories", () => {
    const result = evaluateAutoReplyPolicy({
      ...safeKnown,
      category: "PAYMENT_ADMINISTRATIVE",
      knowledgeMatchCount: 3,
    });
    expect(result.eligible).toBe(false);
    expect(result.reasons).toEqual(expect.arrayContaining([
      "CATEGORY_NOT_KNOWN",
      "EXACTLY_ONE_GROUNDING_SOURCE_REQUIRED",
    ]));
  });
});
