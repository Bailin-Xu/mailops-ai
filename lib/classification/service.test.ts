import { describe, expect, it } from "vitest";

import { parseClassificationReview } from "@/lib/classification/service";

describe("parseClassificationReview", () => {
  it("accepts a human-reviewed classification", () => {
    expect(
      parseClassificationReview({
        classificationId: "4beedb6b-7ff3-4d3c-b97f-cb9f0ca5acbf",
        category: "TECHNICAL_ISSUE",
        note: "Confirmed from the message.",
      }),
    ).toMatchObject({ category: "TECHNICAL_ISSUE" });
  });

  it("rejects unsupported categories", () => {
    expect(() =>
      parseClassificationReview({
        classificationId: "4beedb6b-7ff3-4d3c-b97f-cb9f0ca5acbf",
        category: "OTHER",
      }),
    ).toThrow();
  });
});
