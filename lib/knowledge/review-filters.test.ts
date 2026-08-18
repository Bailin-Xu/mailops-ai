import { describe, expect, it } from "vitest";

import {
  parseReviewFilters,
  reviewHref,
} from "@/lib/knowledge/review-filters";

describe("knowledge source review filters", () => {
  it("uses a useful default queue and validates external query input", () => {
    expect(parseReviewFilters({})).toEqual({
      status: "READY_FOR_REVIEW",
      direction: "ALL",
      reason: "ALL",
      reviewStatus: "ALL",
      q: "",
      page: 1,
      selected: undefined,
    });

    expect(
      parseReviewFilters({
        status: "invalid",
        reviewStatus: "invalid",
        page: "-2",
        selected: "bad-id",
      }),
    ).toMatchObject({
      status: "READY_FOR_REVIEW",
      reviewStatus: "ALL",
      page: 1,
      selected: undefined,
    });
  });

  it("builds stable links and omits default parameters", () => {
    const filters = parseReviewFilters({ q: "registration", page: "2" });

    expect(reviewHref(filters, { page: 1, selected: undefined })).toBe(
      "/knowledge-sources?q=registration",
    );
    expect(reviewHref(filters, { status: "EXCLUDED", page: 1 })).toContain(
      "status=EXCLUDED",
    );
    expect(reviewHref(filters, { reviewStatus: "APPROVED" })).toContain(
      "reviewStatus=APPROVED",
    );
  });
});
