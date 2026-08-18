import { describe, expect, it } from "vitest";

import { parseWebsiteKnowledgeReview } from "@/lib/knowledge/website-review";

describe("website knowledge review", () => {
  const reviewItemId = "7fd2c66c-75df-4523-8ca7-9b6c8bf85cf0";

  it("requires a confirmed owner answer before confirmation", () => {
    expect(() =>
      parseWebsiteKnowledgeReview({
        reviewItemId,
        decision: "CONFIRMED",
        confirmedAnswer: "   ",
        note: "",
      }),
    ).toThrow("Paste Dorian's confirmed policy");
  });

  it("normalizes optional fields for a follow-up decision", () => {
    expect(
      parseWebsiteKnowledgeReview({
        reviewItemId,
        decision: "NEEDS_FOLLOW_UP",
        confirmedAnswer: " partial answer ",
        note: "   ",
      }),
    ).toEqual({
      reviewItemId,
      decision: "NEEDS_FOLLOW_UP",
      confirmedAnswer: "partial answer",
      note: null,
    });
  });
});
