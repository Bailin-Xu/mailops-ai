import { describe, expect, it } from "vitest";

import { parseClassificationReview } from "@/lib/classification/service";

describe("parseClassificationReview", () => {
  it.each([undefined, null, "", "-1", 0.5, "1.5"])("requires a valid displayed revision: %j", (expectedRevision) => {
    expect(() => parseClassificationReview({
      classificationId: "4beedb6b-7ff3-4d3c-b97f-cb9f0ca5acbf", category: "KNOWN_QUESTION", expectedRevision,
    })).toThrow();
  });
  it("accepts a human-reviewed classification", () => {
    expect(
      parseClassificationReview({
        classificationId: "4beedb6b-7ff3-4d3c-b97f-cb9f0ca5acbf",
        expectedRevision: 0,
        category: "TECHNICAL_ISSUE",
        note: "Confirmed from the message.",
      }),
    ).toMatchObject({ category: "TECHNICAL_ISSUE" });
  });

  it("rejects unsupported categories", () => {
    expect(() =>
      parseClassificationReview({
        classificationId: "4beedb6b-7ff3-4d3c-b97f-cb9f0ca5acbf",
        expectedRevision: 0,
        category: "OTHER",
      }),
    ).toThrow();
  });
});
