import { describe, expect, it } from "vitest";

import { parseKnowledgeSourceReview } from "@/lib/knowledge/review-source";

describe("knowledge source human review", () => {
  it("accepts a human decision and normalizes an empty note", () => {
    expect(
      parseKnowledgeSourceReview({
        messageId: "7fd2c66c-75df-4523-8ca7-9b6c8bf85cf0",
        decision: "APPROVED",
        note: "   ",
      }),
    ).toEqual({
      messageId: "7fd2c66c-75df-4523-8ca7-9b6c8bf85cf0",
      decision: "APPROVED",
      note: null,
    });
  });

  it("rejects invalid IDs, pending decisions, and oversized notes", () => {
    expect(() =>
      parseKnowledgeSourceReview({
        messageId: "not-an-id",
        decision: "PENDING",
        note: "x".repeat(1001),
      }),
    ).toThrow();
  });
});
