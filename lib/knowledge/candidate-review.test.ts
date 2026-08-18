import { describe, expect, it } from "vitest";

import {
  parseBulkCandidateApproval,
  parseCandidateReview,
} from "@/lib/knowledge/candidate-review";

describe("parseCandidateReview", () => {
  const valid = {
    candidateId: "4beedb6b-7ff3-4d3c-b97f-cb9f0ca5acbf",
    decision: "APPROVED",
    title: "Gallery visits",
    canonicalQuestion: "Faut-il réserver avant de visiter la galerie ?",
    answer: "Non, une visite libre ne nécessite pas de rendez-vous.",
    category: "GALLERY_VISIT",
    language: "fr",
    note: "Verified against the public page.",
  };

  it("accepts a complete human review", () => {
    expect(parseCandidateReview(valid)).toMatchObject({ decision: "APPROVED", language: "fr" });
  });

  it("rejects an underspecified answer and unsupported language", () => {
    expect(() => parseCandidateReview({ ...valid, answer: "Non.", language: "de" })).toThrow();
  });

  it("requires an explicit human confirmation for bulk approval", () => {
    expect(() =>
      parseBulkCandidateApproval({ source: "ALL", q: "", confirmed: null }),
    ).toThrow("Confirm that you want");
    expect(
      parseBulkCandidateApproval({ source: "WEBSITE", q: "gallery", confirmed: "on" }),
    ).toMatchObject({ source: "WEBSITE", q: "gallery" });
  });
});
