import { describe, expect, it } from "vitest";

import { parseEml } from "@/lib/email/parser";
import {
  buildSyntheticHoldoutEml,
  evaluateSyntheticHoldoutOutcome,
  syntheticHoldoutScenarios,
} from "@/lib/evaluation/synthetic-holdout-scenarios";

describe("synthetic holdout scenarios", () => {
  it("contains eight unseen scenarios across the required cohorts", () => {
    expect(syntheticHoldoutScenarios).toHaveLength(8);
    expect(new Set(syntheticHoldoutScenarios.map((scenario) => scenario.cohort))).toEqual(
      new Set(["KNOWN", "UNKNOWN", "TECHNICAL", "LOW_CONFIDENCE", "HIGH_RISK"]),
    );
  });

  it("builds parseable synthetic messages without real identities", async () => {
    for (const [index, scenario] of syntheticHoldoutScenarios.entries()) {
      const result = await parseEml(
        buildSyntheticHoldoutEml(scenario, index),
        `${scenario.id}.eml`,
      );
      expect(result.status).toBe("success");
      if (result.status !== "success") continue;
      expect(result.email.subject).toBe(scenario.subject);
      expect(result.email.participants.every((participant) => (
        participant.normalizedAddress.endsWith("@example.test")
      ))).toBe(true);
    }
  });

  it("fails a known scenario when no grounded draft was created", () => {
    expect(evaluateSyntheticHoldoutOutcome(syntheticHoldoutScenarios[0], {
      processingStatus: "NO_KNOWLEDGE",
      knowledgeMatchCount: 0,
      draftCount: 0,
    })).toBe(false);
  });
});
