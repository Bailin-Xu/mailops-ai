import { describe, expect, it } from "vitest";

import {
  assertEligibleHistoricalKnowledgeSource,
  isEligibleHistoricalKnowledgeSource,
} from "@/lib/knowledge/source-eligibility";

describe("historical knowledge source eligibility", () => {
  it("allows only outbound email that passed prescreening", () => {
    expect(isEligibleHistoricalKnowledgeSource("OUTBOUND", "READY_FOR_REVIEW")).toBe(
      true,
    );
    expect(isEligibleHistoricalKnowledgeSource("OUTBOUND", "EXCLUDED")).toBe(false);
    expect(isEligibleHistoricalKnowledgeSource("OUTBOUND", "NEEDS_REVIEW")).toBe(
      false,
    );
    expect(isEligibleHistoricalKnowledgeSource("INBOUND", "READY_FOR_REVIEW")).toBe(
      false,
    );
    expect(isEligibleHistoricalKnowledgeSource("SELF", "READY_FOR_REVIEW")).toBe(
      false,
    );
    expect(isEligibleHistoricalKnowledgeSource("UNKNOWN", "UNASSESSED")).toBe(false);
  });

  it("blocks an ineligible source before candidate creation", () => {
    expect(() =>
      assertEligibleHistoricalKnowledgeSource("INBOUND", "EXCLUDED"),
    ).toThrow(
      "Only outbound email that passed prescreening may be used as a historical knowledge source.",
    );
  });
});
