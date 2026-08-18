import { describe, expect, it } from "vitest";

import {
  buildSyntheticScenarioEml,
  evaluateSyntheticOutcome,
  syntheticInboxScenarios,
} from "@/lib/evaluation/synthetic-inbox-scenarios";
import { parseEml } from "@/lib/email/parser";

describe("synthetic inbox evaluation scenarios", () => {
  it("contains 12 safe scenarios across all required cohorts", () => {
    expect(syntheticInboxScenarios).toHaveLength(12);
    expect(new Set(syntheticInboxScenarios.map((scenario) => scenario.cohort))).toEqual(
      new Set(["KNOWN", "UNKNOWN", "TECHNICAL", "LOW_CONFIDENCE", "HIGH_RISK"]),
    );
  });

  it("builds valid synthetic inbound EML content", async () => {
    for (const [index, scenario] of syntheticInboxScenarios.entries()) {
      const parsed = await parseEml(
        buildSyntheticScenarioEml(scenario, index),
        `${scenario.id}.eml`,
      );
      expect(parsed.status).toBe("success");
      if (parsed.status !== "success") continue;
      expect(parsed.email.subject).toBe(scenario.subject);
      expect(parsed.email.cleanBody).toContain(scenario.body);
      expect(parsed.email.participants).toEqual(expect.arrayContaining([
        expect.objectContaining({ normalizedAddress: "support@example.test", type: "TO" }),
      ]));
    }
  });

  it("evaluates expected status, grounding, and draft behavior together", () => {
    const known = syntheticInboxScenarios[0];
    expect(evaluateSyntheticOutcome(known, {
      processingStatus: "DRAFT_READY",
      knowledgeMatchCount: 1,
      draftCount: 1,
    })).toBe(true);
    expect(evaluateSyntheticOutcome(known, {
      processingStatus: "DRAFT_READY",
      knowledgeMatchCount: 0,
      draftCount: 1,
    })).toBe(false);
  });
});
